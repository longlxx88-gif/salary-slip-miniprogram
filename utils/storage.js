const salary = require('./salary')

const KEYS = {
  template: 'salary_template_v1',
  records: 'salary_records_v1',
  settings: 'salary_settings_v1'
}

const DEFAULT_TEMPLATE = salary.getOrderedTemplate({})

const DEFAULT_SETTINGS = {
  confidenceThreshold: 75,
  cloudBackup: false,
  privacyPassword: ''
}

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

function ensureDefaults() {
  if (!wx.getStorageSync(KEYS.template)) set(KEYS.template, DEFAULT_TEMPLATE)
  if (!wx.getStorageSync(KEYS.records)) set(KEYS.records, [])
  if (!wx.getStorageSync(KEYS.settings)) set(KEYS.settings, DEFAULT_SETTINGS)
}

function getTemplate() {
  return salary.getOrderedTemplate(get(KEYS.template, DEFAULT_TEMPLATE))
}

function saveTemplate(template) {
  set(KEYS.template, salary.getOrderedTemplate(template))
}

function getRecords() {
  return get(KEYS.records, [])
}

function saveRecords(records) {
  set(KEYS.records, records)
}

function upsertRecord(record) {
  const records = getRecords()
  const next = records.filter(item => item.id !== record.id && item.month !== record.month)
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
}

module.exports = {
  DEFAULT_TEMPLATE,
  DEFAULT_SETTINGS,
  ensureDefaults,
  getTemplate,
  saveTemplate,
  getRecords,
  saveRecords,
  upsertRecord,
  deleteRecord,
  getSettings,
  saveSettings
}
