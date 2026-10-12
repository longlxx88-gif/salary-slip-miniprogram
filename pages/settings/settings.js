const storage = require('../../utils/storage')
const backup = require('../../utils/backup')

function formatTime(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function cloudTime(value) {
  if (!value) return ''
  const time = new Date(value.$date || value).getTime()
  return Number.isFinite(time) ? formatTime(time) : ''
}

Page({
  data: {
    settings: {},
    lastBackupText: '',
    working: false
  },

  onShow() {
    this.setData({
      settings: storage.getSettings(),
      lastBackupText: formatTime(storage.getSyncMeta().lastBackupAt)
    })
  },

  changeThreshold(event) {
    this.patch({ confidenceThreshold: event.detail.value })
  },

  changePassword(event) {
    this.patch({ privacyPassword: event.detail.value })
  },

  changeBackup(event) {
    this.patch({ cloudBackup: event.detail.value })
  },

  changeImageBackup(event) {
    this.patch({ cloudImageBackup: event.detail.value })
  },

  patch(part) {
    this.setData({ settings: Object.assign({}, this.data.settings, part) })
  },

  save() {
    storage.saveSettings(this.data.settings)
    wx.showToast({ title: '已保存' })
  },

  backupNow() {
    if (this.data.working || !wx.cloud) return
    this.setData({ working: true })
    backup.init()
      .then(() => backup.fetchCloud())
      .then(cloud => {
        const localCount = storage.getRecords().length
        const cloudCount = backup.cloudRecordCount(cloud)
        if (localCount >= cloudCount) return true
        return new Promise(resolve => {
          wx.showModal({
            title: '确认覆盖云端',
            content: `云端有 ${cloudCount} 条记录，本机只有 ${localCount} 条。备份后云端将被本机数据覆盖，确定继续吗？`,
            confirmText: '覆盖',
            confirmColor: '#bc3b33',
            success: result => resolve(result.confirm),
            fail: () => resolve(false)
          })
        })
      })
      .then(confirmed => {
        if (!confirmed) return null
        return backup.save({ allowEmpty: true }).then(result => {
          wx.showToast({ title: `已备份 ${result.count || 0} 条` })
          this.setData({ lastBackupText: formatTime(storage.getSyncMeta().lastBackupAt) })
        })
      })
      .catch(error => wx.showModal({ title: '备份失败', content: error.message || '未知错误', showCancel: false }))
      .then(() => this.setData({ working: false }))
  },

  restoreFromCloud() {
    if (this.data.working || !wx.cloud) return
    this.setData({ working: true })
    backup.fetchCloud()
      .then(cloud => {
        const cloudCount = backup.cloudRecordCount(cloud)
        if (!cloud.found) {
          wx.showModal({ title: '没有云端备份', content: '当前微信账号在云端还没有备份数据。', showCancel: false })
          return
        }
        wx.showModal({
          title: '从云端恢复',
          content: `云端备份：${cloudCount} 条记录（${cloudTime(cloud.updatedAt) || '时间未知'}）\n本机现有：${storage.getRecords().length} 条记录\n\n恢复后本机记录、模板和设置将被云端备份替换，确定继续吗？`,
          confirmText: '恢复',
          confirmColor: '#bc3b33',
          success: result => {
            if (!result.confirm) return
            backup.restore(cloud.snapshot)
            this.onShow()
            wx.showToast({ title: `已恢复 ${cloudCount} 条` })
          }
        })
      })
      .catch(error => wx.showModal({ title: '读取云端备份失败', content: error.message || '未知错误', showCancel: false }))
      .then(() => this.setData({ working: false }))
  }
})
