const storage = require('../../utils/storage')
const salary = require('../../utils/salary')

function money(value) {
  return Number(value || 0).toFixed(2)
}

function deductAmount(record, template) {
  const totalName = (template.deduct || []).find(name => name.indexOf('合计') >= 0)
  if (totalName && record.items[totalName] !== undefined && record.items[totalName] !== '') {
    return Number(record.items[totalName] || 0)
  }

  return (template.deduct || [])
    .filter(name => name.indexOf('合计') < 0)
    .reduce((sum, name) => sum + Number(record.items[name] || 0), 0)
}

Page({
  data: {
    allRecords: [],
    records: [],
    yearOptions: ['全部'],
    selectedYear: '全部',
    selectedYearText: '全部年份',
    summary: {
      count: 0,
      netText: '0.00',
      avgNetText: '0.00'
    }
  },

  onShow() {
    this.loadRecords()
  },

  loadRecords() {
    const template = storage.getTemplate()
    const allRecords = storage.getRecords()
    const years = Array.from(new Set(allRecords.map(item => item.month.slice(0, 4)))).sort((a, b) => b.localeCompare(a))
    const yearOptions = ['全部'].concat(years)
    const selectedYear = yearOptions.indexOf(this.data.selectedYear) >= 0 ? this.data.selectedYear : '全部'
    const records = this.decorateRecords(this.filterRecords(allRecords, selectedYear), template)
    const summary = salary.summarize(records, template)

    this.setData({
      allRecords,
      records,
      yearOptions,
      selectedYear,
      selectedYearText: selectedYear === '全部' ? '全部年份' : `${selectedYear} 年`,
      summary: Object.assign({}, summary, {
        netText: money(summary.net),
        avgNetText: money(summary.avgNet)
      })
    })
  },

  filterRecords(records, year) {
    if (year === '全部') return records
    return records.filter(item => item.month.indexOf(year) === 0)
  },

  decorateRecords(records, template) {
    return records.map(record => {
      const grossName = (template.total || []).concat(template.income || []).find(name => name.indexOf('应发') >= 0)
      const netName = (template.total || []).find(name => name.indexOf('实发') >= 0)
      const deduct = deductAmount(record, template)
      return Object.assign({}, record, {
        grossText: money(grossName ? record.items[grossName] : 0),
        deductText: money(deduct),
        netText: money(netName ? record.items[netName] : 0)
      })
    })
  },

  changeYear(event) {
    const selectedYear = this.data.yearOptions[event.detail.value]
    this.setData({ selectedYear }, () => this.loadRecords())
  },

  goScan() {
    wx.navigateTo({ url: '/pages/scan/scan' })
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
