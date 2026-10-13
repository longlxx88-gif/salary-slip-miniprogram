const salary = require('./salary')
const formats = require('./formats')

const KEYS = {
  template: 'salary_template_v1',
  templateCn: 'salary_template_v1_cn',
  records: 'salary_records_v1',
  settings: 'salary_settings_v1',
  lastFormat: 'salary_last_format_v1',
  sync: 'salary_sync_v1'
}

const DEFAULT_TEMPLATE = salary.getOrderedTemplate({})

const DEFAULT_SETTINGS = {
  confidenceThreshold: 75,
  cloudBackup: true,
  cloudImageBackup: true,
  privacyPassword: ''
}

let changeListener = null

function get(key, fallback) {
  try {
    const value = wx.getStorageSync(key)
    return value || fallback
  } catch (error) {
    return fallback
  }
}

function set(key, value) {
  wx.setStorageSync(key, value)
}

// 记录/模板/设置变化时通知（用于自动云备份）
function onChange(listener) {
  changeListener = listener
}

function notifyChange() {
  if (changeListener) changeListener()
}

function ensureDefaults() {
  if (!wx.getStorageSync(KEYS.template)) set(KEYS.template, DEFAULT_TEMPLATE)
  if (!wx.getStorageSync(KEYS.records)) set(KEYS.records, [])
  if (!wx.getStorageSync(KEYS.settings)) set(KEYS.settings, DEFAULT_SETTINGS)
}

// 泰国公司沿用原 key；国内公司 salary_template_v1_cn；新增公司 salary_template_v1_<公司 id>
function templateKey(format) {
  if (!format || format === 'thai') return KEYS.template
  if (format === 'cn') return KEYS.templateCn
  return `${KEYS.template}_${format}`
}

function getTemplate(format) {
  const fallback = !format || format === 'thai' ? DEFAULT_TEMPLATE : {}
  return salary.getOrderedTemplate(get(templateKey(format), fallback), format)
}

function saveTemplate(template, format) {
  set(templateKey(format), salary.getOrderedTemplate(template, format))
  notifyChange()
}

// 旧记录没有 format 字段，读取时补为 thai，不改写存储
function getRecords() {
  return get(KEYS.records, []).map(record => record.format ? record : Object.assign({}, record, { format: formats.DEFAULT_FORMAT }))
}

function saveRecords(records) {
  set(KEYS.records, records)
  notifyChange()
}

// 每月每种格式保留一条记录
function upsertRecord(record) {
  const format = formats.recordFormat(record)
  const records = getRecords()
  const next = records.filter(item => item.id !== record.id && !(item.month === record.month && item.format === format))
  next.push(record)
  next.sort((a, b) => b.month.localeCompare(a.month))
  saveRecords(next)
}

function deleteRecord(id) {
  saveRecords(getRecords().filter(item => item.id !== id))
}

function getSettings() {
  return Object.assign({}, DEFAULT_SETTINGS, get(KEYS.settings, DEFAULT_SETTINGS))
}

function saveSettings(settings) {
  set(KEYS.settings, Object.assign({}, DEFAULT_SETTINGS, settings))
  notifyChange()
}

function getLastFormat() {
  return formats.normalizeFormat(get(KEYS.lastFormat, formats.DEFAULT_FORMAT))
}

function setLastFormat(format) {
  set(KEYS.lastFormat, formats.normalizeFormat(format))
}

function getSyncMeta() {
  return get(KEYS.sync, {})
}

function setSyncMeta(patch) {
  set(KEYS.sync, Object.assign({}, getSyncMeta(), patch))
}

// 与云函数 backup / 集合 salary_backups 的 snapshot 结构保持兼容：
// records/settings/template 为原有字段；templates 为其他公司模板（按公司 id）；formats 为公司配置
function getSnapshot() {
  const templates = {}
  formats.allFormats()
    .filter(config => config.id !== 'thai')
    .forEach(config => {
      templates[config.id] = getTemplate(config.id)
    })
  return {
    records: get(KEYS.records, []),
    settings: getSettings(),
    template: getTemplate('thai'),
    templates,
    formats: formats.getStoredConfigs()
  }
}

function applySnapshot(snapshot) {
  if (!snapshot) return
  // 先恢复公司配置，后面的模板才能按正确的公司规则整理
  if (snapshot.formats && typeof snapshot.formats === 'object') formats.applyStoredConfigs(snapshot.formats)
  if (Array.isArray(snapshot.records)) set(KEYS.records, snapshot.records)
  if (snapshot.template && typeof snapshot.template === 'object') {
    set(KEYS.template, salary.getOrderedTemplate(snapshot.template))
  }
  Object.keys(snapshot.templates || {}).forEach(id => {
    if (id === 'thai' || !snapshot.templates[id]) return
    set(templateKey(id), salary.getOrderedTemplate(snapshot.templates[id], id))
  })
  if (snapshot.settings && typeof snapshot.settings === 'object') {
    set(KEYS.settings, Object.assign({}, DEFAULT_SETTINGS, snapshot.settings))
  }
}

// 删除公司时清理其模板
function removeTemplate(format) {
  if (!format || format === 'thai' || format === 'cn') return
  try {
    wx.removeStorageSync(templateKey(format))
  } catch (error) {
    // 忽略：模板不存在
  }
  notifyChange()
}

module.exports = {
  DEFAULT_TEMPLATE,
  DEFAULT_SETTINGS,
  onChange,
  ensureDefaults,
  getTemplate,
  saveTemplate,
  getRecords,
  saveRecords,
  upsertRecord,
  deleteRecord,
  getSettings,
  saveSettings,
  getLastFormat,
  setLastFormat,
  getSyncMeta,
  setSyncMeta,
  getSnapshot,
  applySnapshot,
  removeTemplate
}
