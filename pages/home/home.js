const storage = require('../../utils/storage')
const salary = require('../../utils/salary')
const formats = require('../../utils/formats')

function money(value) {
  return Number(value || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

Page({
  data: {
    allRecords: [],
    groups: [],
    summaries: [],
    yearOptions: ['全部'],
    selectedYear: '全部',
    selectedYearText: '全部年份'
  },

  onShow() {
    this.loadRecords()
  },

  loadRecords() {
    const allRecords = storage.getRecords()
    const years = Array.from(new Set(allRecords.map(item => item.month.slice(0, 4)))).sort((a, b) => b.localeCompare(a))
    const yearOptions = ['全部'].concat(years)
    const selectedYear = yearOptions.indexOf(this.data.selectedYear) >= 0 ? this.data.selectedYear : '全部'
    const records = this.filterRecords(allRecords, selectedYear)
    const templates = {}
    formats.FORMAT_IDS.forEach(id => {
      templates[id] = storage.getTemplate(id)
    })

    // 不同格式币种不同，分开汇总
    const summaries = formats.FORMAT_IDS
      .map(id => {
        const list = records.filter(record => record.format === id)
        if (!list.length) return null
        const summary = salary.summarize(list, templates[id], id)
        const config = formats.getFormat(id)
        return {
          format: id,
          name: config.name,
          currency: config.currency,
          symbol: config.symbol,
          count: summary.count,
          netText: money(summary.net),
          avgNetText: money(summary.avgNet)
        }
      })
      .filter(Boolean)

    this.setData({
      allRecords,
      groups: this.groupByMonth(records, allRecords, templates),
      summaries,
      yearOptions,
      selectedYear,
      selectedYearText: selectedYear === '全部' ? '全部年份' : `${selectedYear} 年`
    })
  },

  filterRecords(records, year) {
    if (year === '全部') return records
    return records.filter(item => item.month.indexOf(year) === 0)
  },

  // 按月分组；某格式开始录入后，之后月份缺少该格式时提示“未录入”
  groupByMonth(records, allRecords, templates) {
    const firstMonth = {}
    allRecords.forEach(record => {
      if (!firstMonth[record.format] || record.month < firstMonth[record.format]) firstMonth[record.format] = record.month
    })

    const months = Array.from(new Set(records.map(record => record.month))).sort((a, b) => b.localeCompare(a))
    return months.map(month => {
      const monthRecords = records
        .filter(record => record.month === month)
        .sort((a, b) => formats.FORMAT_IDS.indexOf(a.format) - formats.FORMAT_IDS.indexOf(b.format))
        .map(record => this.decorateRecord(record, templates[record.format]))
      const missing = formats.FORMAT_IDS
        .filter(id => firstMonth[id] && month >= firstMonth[id] && !monthRecords.some(record => record.format === id))
        .map(id => ({ format: id, name: formats.getFormat(id).name }))
      return { month, records: monthRecords, missing }
    })
  },

  decorateRecord(record, template) {
    const totals = salary.recordTotals(record, template)
    const config = formats.getFormat(record.format)
    return Object.assign({}, record, {
      formatName: config.name,
      symbol: config.symbol,
      grossText: money(totals.gross),
      deductText: money(totals.deduct),
      netText: money(totals.net)
    })
  },

  changeYear(event) {
    const selectedYear = this.data.yearOptions[event.detail.value]
    this.setData({ selectedYear }, () => this.loadRecords())
  },

  goScan() {
    wx.navigateTo({ url: '/pages/scan/scan' })
  },

  goScanFormat(event) {
    wx.navigateTo({ url: `/pages/scan/scan?format=${event.currentTarget.dataset.format}` })
  },

  editRecord(event) {
    wx.navigateTo({ url: `/pages/review/review?id=${event.currentTarget.dataset.id}` })
  },

  rescanRecord(event) {
    wx.navigateTo({ url: `/pages/scan/scan?replaceId=${event.currentTarget.dataset.id}` })
  },

  deleteRecord(event) {
    const id = event.currentTarget.dataset.id
    wx.showModal({
      title: '删除记录',
      content: '确认删除这条工资记录吗？删除后不可恢复。',
      confirmText: '确认删除',
      cancelText: '取消',
      confirmColor: '#bc3b33',
      success: result => {
        if (result.confirm) {
          storage.deleteRecord(id)
          this.loadRecords()
        }
      }
    })
  }
})
