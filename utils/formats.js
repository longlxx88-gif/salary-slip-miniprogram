// 工资条格式：thai 为原有泰国公司工资条（旧记录没有 format 字段，一律视为 thai）
const FORMATS = {
  thai: {
    id: 'thai',
    name: '泰国公司',
    currency: 'THB',
    symbol: '฿',
    multiImage: false
  },
  cn: {
    id: 'cn',
    name: '国内公司',
    currency: 'CNY',
    symbol: '¥',
    multiImage: true
  }
}

const FORMAT_IDS = ['thai', 'cn']
const DEFAULT_FORMAT = 'thai'

function normalizeFormat(format) {
  return FORMATS[format] ? format : DEFAULT_FORMAT
}

function getFormat(format) {
  return FORMATS[normalizeFormat(format)]
}

function recordFormat(record) {
  return normalizeFormat(record && record.format)
}

function formatList() {
  return FORMAT_IDS.map(id => FORMATS[id])
}

module.exports = {
  FORMATS,
  FORMAT_IDS,
  DEFAULT_FORMAT,
  normalizeFormat,
  getFormat,
  recordFormat,
  formatList
}
