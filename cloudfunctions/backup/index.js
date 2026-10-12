const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const COLLECTION = 'salary_backups'

function validSnapshot(snapshot) {
  return snapshot &&
    Array.isArray(snapshot.records) &&
    snapshot.template && typeof snapshot.template === 'object' &&
    snapshot.settings && typeof snapshot.settings === 'object'
}

async function getBackup(openid) {
  const result = await db.collection(COLLECTION)
    .where({ ownerOpenId: openid })
    .orderBy('updatedAt', 'desc')
    .limit(1)
    .get()
  const backup = result.data && result.data[0]
  return {
    ok: true,
    found: Boolean(backup),
    snapshot: backup ? backup.snapshot : null,
    updatedAt: backup ? backup.updatedAt : null
  }
}

function recordCount(snapshot) {
  return snapshot && Array.isArray(snapshot.records) ? snapshot.records.length : 0
}

async function saveBackup(openid, snapshot, allowEmpty) {
  if (!validSnapshot(snapshot)) return { ok: false, error: '备份数据格式不正确' }
  // 与 getBackup 取同一条（最新）文档，避免历史重复文档导致读写不一致
  const current = await db.collection(COLLECTION)
    .where({ ownerOpenId: openid })
    .orderBy('updatedAt', 'desc')
    .limit(1)
    .get()
  const existing = current.data && current.data[0]
  const cloudCount = existing ? recordCount(existing.snapshot) : 0

  // 防止重装后本地为空时把云端数据覆盖成空
  if (existing && !allowEmpty && !recordCount(snapshot) && cloudCount) {
    return { ok: false, code: 'EMPTY_OVERWRITE', cloudCount, error: `云端已有 ${cloudCount} 条记录，已拒绝用空数据覆盖` }
  }

  if (existing) {
    // _.set 整体替换 snapshot，避免 update 对嵌套对象做合并残留旧字段
    await db.collection(COLLECTION).doc(existing._id).update({
      data: { ownerOpenId: openid, snapshot: _.set(snapshot), updatedAt: db.serverDate() }
    })
  } else {
    await db.collection(COLLECTION).add({
      data: { ownerOpenId: openid, snapshot, updatedAt: db.serverDate() }
    })
  }
  return { ok: true, count: recordCount(snapshot) }
}

exports.main = async event => {
  const openid = cloud.getWXContext().OPENID || ''
  if (!openid) return { ok: false, error: '无法确认当前微信用户' }
  try {
    if (event.action === 'get') return getBackup(openid)
    if (event.action === 'save') return saveBackup(openid, event.snapshot, Boolean(event.allowEmpty))
    return { ok: false, error: '不支持的备份操作' }
  } catch (error) {
    console.error('[backup] failed:', error)
    return { ok: false, error: error.message || String(error) }
  }
}
