const storage = require('../../utils/storage')
const salary = require('../../utils/salary')
const formats = require('../../utils/formats')
const cards = require('../../utils/cards')

function nextMonth(month) {
  const parts = month.split('-')
  let year = Number(parts[0])
  let value = Number(parts[1]) + 1
  if (value > 12) {
    year += 1
    value = 1
  }
  return `${year}-${String(value).padStart(2, '0')}`
}

Page({
  data: {
    format: '',
    card: {},
    summary: {},
    rows: [],
    yearOptions: ['全部'],
    selectedYear: '全部',
    selectedYearText: '全部年份'
  },

  onLoad(options) {
    this.setData({ format: options.format || formats.DEFAULT_FORMAT })
  },

  onShow() {
    this.load()
  },

  load() {
    const format = this.data.format
    const config = formats.getFormat(format)
    wx.setNavigationBarTitle({ title: config.name })

    const allRecords = storage.getRecords()
    const records = allRecords.filter(record => record.format === format)
    const years = Array.from(new Set(records.map(record => record.month.slice(0, 4)))).sort((a, b) => b.localeCompare(a))
    const yearOptions = ['全部'].concat(years)
    const selectedYear = yearOptions.indexOf(this.data.selectedYear) >= 0 ? this.data.selectedYear : '全部'
    const visible = selectedYear === '全部' ? records : records.filter(record => record.month.indexOf(selectedYear) === 0)
    const template = storage.getTemplate(format)
    const summary = salary.summarize(visible, template, format)

    this.setData({
      card: cards.cardFace(config, records),
      summary: {
        netText: cards.money(summary.net),
        avgNetText: cards.money(summary.avgNet),
        count: summary.count
      },
      rows: this.buildRows(visible, allRecords, template, config, selectedYear),
      yearOptions,
      selectedYear,
      selectedYearText: selectedYear === '全部' ? '全部年份' : `${selectedYear} 年`
    })
  },

  // 月度记录（新 → 旧）；从本公司第一条记录起、到所有公司最近一个月之间缺少的月份显示为“未录入”
  buildRows(visible, allRecords, template, config, selectedYear) {
    const byMonth = {}
    visible.forEach(record => {
      byMonth[record.month] = record
    })
    const ownMonths = allRecords.filter(record => record.format === config.id).map(record => record.month).sort()
    const months = Object.keys(byMonth)
    if (ownMonths.length) {
      const latest = allRecords.map(record => record.month).sort().pop()
      for (let month = ownMonths[0]; month <= latest; month = nextMonth(month)) {
        if (selectedYear !== '全部' && month.indexOf(selectedYear) !== 0) continue
        if (months.indexOf(month) < 0) months.push(month)
      }
    }

    return months
      .sort((a, b) => b.localeCompare(a))
      .map(month => {
        const record = byMonth[month]
        if (!record) return { month, missing: true, monthNo: month.slice(5), year: month.slice(0, 4) }
        const totals = salary.recordTotals(record, template)
        return {
          month,
          id: record.id,
          monthNo: month.slice(5),
          year: month.slice(0, 4),
          netText: cards.money(totals.net),
          grossText: cards.money(totals.gross),
          deductText: cards.money(totals.deduct)
        }
      })
  },

  changeYear(event) {
    const selectedYear = this.data.yearOptions[event.detail.value]
    this.setData({ selectedYear }, () => this.load())
  },

  goScan() {
    wx.navigateTo({ url: `/pages/scan/scan?format=${this.data.format}` })
  },

  openRow(event) {
    const { id } = event.currentTarget.dataset
    if (!id) {
      this.goScan()
      return
    }
    wx.navigateTo({ url: `/pages/review/review?id=${id}` })
  },

  // 长按：重拍覆盖 / 删除
  rowActions(event) {
    const { id, month } = event.currentTarget.dataset
    if (!id) return
    wx.showActionSheet({
      itemList: ['编辑', '重拍覆盖', '删除'],
      itemColor: '#172033',
      success: result => {
        if (result.tapIndex === 0) wx.navigateTo({ url: `/pages/review/review?id=${id}` })
        if (result.tapIndex === 1) wx.navigateTo({ url: `/pages/scan/scan?replaceId=${id}` })
        if (result.tapIndex === 2) this.deleteRecord(id, month)
      }
    })
  },

  deleteRecord(id, month) {
    wx.showModal({
      title: '删除记录',
      content: `确认删除 ${month} 的工资记录吗？删除后不可恢复。`,
      confirmText: '确认删除',
      cancelText: '取消',
      confirmColor: '#d14343',
      success: result => {
        if (result.confirm) {
          storage.deleteRecord(id)
          this.load()
        }
      }
    })
  }
})
