// 首页卡包与卡片详情页共用的卡面数据：累计实发 + 记录月份（范围与月数）
const storage = require('./storage')
const salary = require('./salary')

function money(value) {
  return Number(value || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function cardFace(config, records) {
  const template = storage.getTemplate(config.id)
  const summary = salary.summarize(records, template, config.id)
  const months = records.map(record => record.month).sort()
  return {
    id: config.id,
    name: config.name,
    currency: config.currency,
    symbol: config.symbol,
    colorFrom: config.colorFrom,
    colorTo: config.colorTo,
    count: records.length,
    netText: money(summary.net),
    avgNetText: money(summary.avgNet),
    firstMonth: months[0] || '',
    lastMonth: months[months.length - 1] || '',
    monthsText: months.length
      ? `${months[0]} ~ ${months[months.length - 1]} · ${months.length} 个月`
      : '暂无记录'
  }
}

module.exports = {
  money,
  cardFace
}
