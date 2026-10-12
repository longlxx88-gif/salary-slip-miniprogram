const storage = require('./storage')

const AUTO_BACKUP_DELAY = 1500

// ready：已确认过云端状态（本地有数据，或已尝试从云端恢复），之后才允许自动备份，
// 避免重装后本地为空时把云端数据覆盖掉
let ready = false
let initPromise = null
let timer = null
let queue = Promise.resolve()

function callBackup(data) {
  return wx.cloud.callFunction({ name: 'backup', data }).then(result => result.result || {})
}

function cloudRecordCount(result) {
  const snapshot = result && result.found && result.snapshot
  return snapshot && Array.isArray(snapshot.records) ? snapshot.records.length : 0
}

function fetchCloud() {
  return callBackup({ action: 'get' }).then(result => {
    if (!result.ok) throw new Error(result.error || '读取云端备份失败')
    return result
  })
}

function refreshCurrentPage() {
  const pages = getCurrentPages()
  const page = pages[pages.length - 1]
  if (page && typeof page.onShow === 'function') page.onShow()
}

function restore(snapshot) {
  storage.applySnapshot(snapshot)
  ready = true
}

// 启动时调用：本地没有记录且云端有备份时自动恢复
function init() {
  if (ready) return Promise.resolve({ restored: false })
  if (initPromise) return initPromise
  if (!wx.cloud) return Promise.resolve({ restored: false })

  const check = storage.getRecords().length
    ? Promise.resolve({ restored: false })
    : fetchCloud().then(result => {
      const count = cloudRecordCount(result)
      if (!count) return { restored: false }
      restore(result.snapshot)
      wx.showToast({ title: `已从云端恢复 ${count} 条记录`, icon: 'none' })
      refreshCurrentPage()
      return { restored: true, count }
    })

  initPromise = check
    .then(result => {
      ready = true
      return result
    })
    .catch(error => {
      console.warn('[backup] init failed', error)
      return { restored: false, error }
    })
    .then(result => {
      initPromise = null
      return result
    })
  return initPromise
}

// 串行执行，避免并发保存在云端产生重复文档
function save(options) {
  const allowEmpty = Boolean(options && options.allowEmpty)
  const run = () => callBackup({ action: 'save', snapshot: storage.getSnapshot(), allowEmpty })
    .then(result => {
      if (!result.ok) throw new Error(result.error || '云备份失败')
      storage.setSyncMeta({ lastBackupAt: Date.now() })
      return result
    })
  queue = queue.then(run, run)
  return queue
}

function schedule() {
  if (!wx.cloud || !storage.getSettings().cloudBackup) return
  clearTimeout(timer)
  timer = setTimeout(() => {
    init().then(() => {
      if (!ready) return null
      return save({ allowEmpty: true }).catch(error => console.warn('[backup] auto save failed', error))
    })
  }, AUTO_BACKUP_DELAY)
}

module.exports = {
  init,
  schedule,
  save,
  fetchCloud,
  restore,
  cloudRecordCount
}
