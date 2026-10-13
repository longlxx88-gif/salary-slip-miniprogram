// 公司（工资条格式）登记：两家内置公司 + 在“模板管理”界面新增的公司。
// 记录通过 format 字段关联公司；旧记录没有 format 字段，一律视为 thai。
// 配置保存在本地 salary_formats_v1 并随云备份 snapshot.formats 同步。
const cnSlip = require('./cnSlip')

const STORAGE_KEY = 'salary_formats_v1'
const DEFAULT_FORMAT = 'thai'

const COLORS = [
  { id: 'teal', name: '青绿', from: '#0f766e', to: '#134e4a', soft: '#e3f3f0' },
  { id: 'orange', name: '砖红', from: '#c2410c', to: '#7c2d12', soft: '#fff0e8' },
  { id: 'indigo', name: '靛蓝', from: '#4f46e5', to: '#312e81', soft: '#eef0ff' },
  { id: 'purple', name: '葡萄紫', from: '#9333ea', to: '#581c87', soft: '#f5edff' },
  { id: 'rose', name: '玫红', from: '#e11d48', to: '#881337', soft: '#ffeef2' },
  { id: 'amber', name: '琥珀', from: '#b45309', to: '#78350f', soft: '#fff6e0' },
  { id: 'slate', name: '墨灰', from: '#334155', to: '#0f172a', soft: '#eef1f5' }
]

// 新增公司可选的币种
const CURRENCIES = [
  { code: 'CNY', symbol: '¥', name: '人民币' },
  { code: 'THB', symbol: '฿', name: '泰铢' },
  { code: 'USD', symbol: '$', name: '美元' },
  { code: 'VND', symbol: '₫', name: '越南盾' }
]

const SCAN_MODES = [
  { id: 'photo', name: '单张拍照', desc: '拍照或选一张图片，表格识别' },
  { id: 'screenshots', name: '多张截图', desc: '一次上传多张截图，通用 + 表格识别并合并' },
  { id: 'manual', name: '仅手动录入', desc: '不识别，直接按模板填写' }
]

const BUILTINS = {
  thai: {
    id: 'thai',
    name: '泰国公司',
    currency: 'THB',
    symbol: '฿',
    color: 'teal',
    scanMode: 'photo',
    engine: 'thai',
    builtin: true
  },
  cn: {
    id: 'cn',
    name: '国内公司',
    currency: 'CNY',
    symbol: '¥',
    color: 'orange',
    scanMode: 'screenshots',
    cleanWatermark: true,
    engine: 'list',
    builtin: true
  }
}
const BUILTIN_IDS = ['thai', 'cn']
// 内置公司在界面上只允许修改这些属性，识别方式与字段规则保持不变
const BUILTIN_EDITABLE = ['name', 'color', 'symbol', 'currency']

// getFormat 在列表渲染中调用频繁，缓存一份，写入时同步更新
let cache = null

function readStored() {
  if (cache) return cache
  try {
    const value = wx.getStorageSync(STORAGE_KEY)
    cache = value && typeof value === 'object' ? value : {}
  } catch (error) {
    cache = {}
  }
  return cache
}

let changeListener = null
function onChange(listener) {
  changeListener = listener
}

function writeStored(stored, silent) {
  wx.setStorageSync(STORAGE_KEY, stored)
  cache = stored
  if (!silent && changeListener) changeListener()
}

function colorOf(id) {
  return COLORS.find(color => color.id === id) || COLORS[0]
}

function decorate(config) {
  const color = colorOf(config.color)
  return Object.assign({}, config, {
    multiImage: config.scanMode === 'screenshots',
    colorFrom: color.from,
    colorTo: color.to,
    colorSoft: color.soft
  })
}

function customList(stored) {
  return Array.isArray(stored.customs) ? stored.customs : []
}

function builtinConfig(id, stored) {
  const override = (stored.overrides && stored.overrides[id]) || {}
  const patch = {}
  BUILTIN_EDITABLE.forEach(key => {
    if (override[key]) patch[key] = override[key]
  })
  return Object.assign({}, BUILTINS[id], patch)
}

function customConfig(raw) {
  return Object.assign({
    currency: 'CNY',
    symbol: '¥',
    color: 'indigo',
    scanMode: 'photo',
    cleanWatermark: false,
    keys: {},
    checks: { income: true, net: true, taxable: true }
  }, raw, { engine: 'list', builtin: false })
}

// 全部公司（含已停用），内置在前
function allFormats() {
  const stored = readStored()
  return BUILTIN_IDS.map(id => builtinConfig(id, stored))
    .concat(customList(stored).map(customConfig))
    .map(decorate)
}

// 可用于录入的公司
function formatList() {
  return allFormats().filter(config => !config.disabled)
}

function exists(format) {
  return Boolean(BUILTINS[format]) || customList(readStored()).some(config => config.id === format)
}

function normalizeFormat(format) {
  return format && exists(format) ? format : DEFAULT_FORMAT
}

// 未知 id（例如公司配置已删除）也返回可用的占位配置，保证记录仍能显示
function getFormat(format) {
  const stored = readStored()
  if (BUILTINS[format]) return decorate(builtinConfig(format, stored))
  const custom = customList(stored).find(config => config.id === format)
  if (custom) return decorate(customConfig(custom))
  if (!format) return decorate(builtinConfig(DEFAULT_FORMAT, stored))
  return decorate(customConfig({ id: format, name: '未知公司', color: 'slate', scanMode: 'manual' }))
}

function recordFormat(record) {
  return (record && record.format) || DEFAULT_FORMAT
}

function isListEngine(format) {
  return getFormat(format).engine === 'list'
}

// 列表引擎（cnSlip）配置：国内公司用内置配置，新增公司按界面配置生成
function engineConfig(format) {
  const config = getFormat(format)
  if (config.id === 'cn') return cnSlip.CN_CONFIG
  const keys = config.keys || {}
  return {
    id: config.id,
    gross: keys.gross || '',
    net: keys.net || '',
    deductTotal: keys.deductTotal || '',
    taxable: keys.taxable || '',
    combinedTax: keys.combinedTax || '',
    checks: Object.assign({ income: true, net: true, taxable: true }, config.checks),
    skipLabels: [],
    // 截图类工资条的标签在左侧、金额带两位小数；拍照的表格不做这两项限制
    labelMaxXRatio: config.scanMode === 'screenshots' ? 0.4 : 1,
    strictDecimals: config.scanMode === 'screenshots',
    // 新增公司的模板一开始不完整，模板外字段按名称猜分组，校对页可改
    guessGroups: true
  }
}

// OCR 云函数模式：截图 → cn（通用 + 表格识别并行）；拍照 → 默认表格识别
function ocrMode(format) {
  return getFormat(format).scanMode === 'screenshots' ? 'cn' : ''
}

function newId() {
  return `c${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
}

// 保存公司配置：内置公司只保存可修改属性，新增公司保存完整配置
function saveFormat(config) {
  const stored = readStored()
  if (BUILTINS[config.id]) {
    const overrides = Object.assign({}, stored.overrides)
    const patch = {}
    BUILTIN_EDITABLE.forEach(key => {
      if (config[key] !== undefined) patch[key] = config[key]
    })
    overrides[config.id] = patch
    writeStored(Object.assign({}, stored, { overrides }))
    return config.id
  }

  const id = config.id || newId()
  const clean = {
    id,
    name: config.name,
    currency: config.currency,
    symbol: config.symbol,
    color: config.color,
    scanMode: config.scanMode,
    cleanWatermark: Boolean(config.cleanWatermark),
    keys: Object.assign({}, config.keys),
    checks: Object.assign({}, config.checks),
    disabled: Boolean(config.disabled),
    createdAt: config.createdAt || Date.now()
  }
  const customs = customList(stored).filter(item => item.id !== id).concat(clean)
  writeStored(Object.assign({}, stored, { customs }))
  return id
}

function removeFormat(id) {
  if (BUILTINS[id]) return
  const stored = readStored()
  writeStored(Object.assign({}, stored, { customs: customList(stored).filter(item => item.id !== id) }))
}

// 云备份：读取 / 恢复原始配置
function getStoredConfigs() {
  return readStored()
}

function applyStoredConfigs(stored) {
  if (stored && typeof stored === 'object') writeStored(stored, true)
}

module.exports = {
  COLORS,
  CURRENCIES,
  SCAN_MODES,
  DEFAULT_FORMAT,
  BUILTIN_IDS,
  onChange,
  allFormats,
  formatList,
  normalizeFormat,
  getFormat,
  recordFormat,
  isListEngine,
  engineConfig,
  ocrMode,
  saveFormat,
  removeFormat,
  getStoredConfigs,
  applyStoredConfigs
}
