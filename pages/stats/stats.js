const storage = require('../../utils/storage')
const salary = require('../../utils/salary')

function money(value) {
  return Number(value || 0).toFixed(2)
}

function shortMoney(value) {
  const number = Number(value || 0)
  if (Math.abs(number) >= 10000) return `${(number / 10000).toFixed(1)}万`
  if (Math.abs(number) >= 1000) return `${Math.round(number / 1000)}k`
  return String(Math.round(number))
}

Page({
  data: {
    range: 'all',
    chartOptions: ['实发工资', '基本工资', '绩效奖金KPI'],
    chartIndex: 0,
    chartName: '实发工资',
    selectedPointText: '',
    linePoints: [],
    records: [],
    template: {},
    summary: {}
  },

  onShow() {
    this.load()
  },

  load() {
    const template = storage.getTemplate()
    const records = this.filterRecords(storage.getRecords(), this.data.range)
    const summary = salary.summarize(records, template)
    this.setData({
      records,
      template,
      summary: Object.assign({}, summary, {
        grossText: money(summary.gross),
        deductText: money(summary.deduct),
        netText: money(summary.net),
        avgGrossText: money(summary.avgGross),
        avgNetText: money(summary.avgNet)
      })
    }, () => this.drawCharts())
  },

  filterRecords(records, range) {
    const sorted = records.slice().sort((a, b) => a.month.localeCompare(b.month))
    if (range === 'all') return sorted
    if (range === 'half') return sorted.slice(-6)
    const year = new Date().getFullYear().toString()
    return sorted.filter(record => record.month.indexOf(year) === 0)
  },

  changeRange(event) {
    this.setData({ range: event.currentTarget.dataset.range }, () => this.load())
  },

  changeChartItem(event) {
    const chartIndex = Number(event.detail.value || 0)
    const chartName = this.data.chartOptions[chartIndex] || this.data.chartOptions[0]
    this.setData({ chartIndex, chartName, selectedPointText: '' }, () => this.drawLine())
  },

  drawCharts() {
    this.drawLine()
    this.drawPie()
    this.drawBar()
  },

  drawLine() {
    const ctx = wx.createCanvasContext('lineChart', this)
    const records = this.data.records
    const fieldName = this.resolveChartFieldName(this.data.chartName)
    const values = records.map(record => Number(record.items[fieldName] || 0))
    const points = []
    const plot = { left: 58, top: 34, width: 286, height: 138 }
    this.clearCanvas(ctx)
    this.drawAxis(ctx, plot, values, records)
    if (values.length) {
      const max = Math.max(...values, 1)
      const step = values.length > 1 ? plot.width / (values.length - 1) : 0
      ctx.setStrokeStyle('#1f7a68')
      ctx.setLineWidth(3)
      ctx.beginPath()
      values.forEach((value, index) => {
        const x = plot.left + index * step
        const y = plot.top + plot.height - value / max * plot.height
        points.push({ x, y, value, month: records[index].month, name: this.data.chartName })
        if (index === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()

      values.forEach((value, index) => {
        const point = points[index]
        ctx.setFillStyle('#1f7a68')
        ctx.beginPath()
        ctx.arc(point.x, point.y, 4, 0, Math.PI * 2)
        ctx.fill()
        ctx.setFillStyle('#20242c')
        ctx.setFontSize(10)
        ctx.fillText(shortMoney(value), point.x - 14, Math.max(12, point.y - 9))
      })
    } else {
      ctx.setFillStyle('#6d7480')
      ctx.fillText('暂无趋势数据', 120, 110)
    }
    ctx.draw(false, () => this.setData({ linePoints: points }))
  },

  resolveChartFieldName(name) {
    if (name.indexOf('实发') >= 0) {
      return (this.data.template.total || []).find(item => item.indexOf('实发') >= 0) || name
    }
    return (this.data.template.income || []).find(item => item === name || item.indexOf(name) >= 0) || name
  },

  tapLineChart(event) {
    const point = this.findNearestPoint(event.detail.x, event.detail.y)
    if (!point) return
    const selectedPointText = `${point.month} ${point.name}: ¥${money(point.value)}`
    this.setData({ selectedPointText })
    wx.showToast({ title: selectedPointText, icon: 'none' })
  },

  findNearestPoint(x, y) {
    const points = this.data.linePoints || []
    if (!points.length) return null
    const nearest = points
      .map(point => Object.assign({}, point, {
        distance: Math.sqrt(Math.pow(point.x - x, 2) + Math.pow(point.y - y, 2))
      }))
      .sort((a, b) => a.distance - b.distance)[0]
    return nearest && nearest.distance <= 28 ? nearest : null
  },

  drawPie() {
    const ctx = wx.createCanvasContext('pieChart', this)
    const records = this.data.records
    const names = (this.data.template.income || []).filter(name => name.indexOf('应发') < 0)
    const totals = names.map(name => ({
      name,
      value: records.reduce((sum, record) => sum + Number(record.items[name] || 0), 0)
    })).filter(item => item.value > 0)
    const sum = totals.reduce((total, item) => total + item.value, 0)
    const colors = ['#1f7a68', '#d49a2a', '#5f6fb2', '#bc3b33', '#5c8a99']
    let start = -Math.PI / 2
    this.clearCanvas(ctx)
    totals.forEach((item, index) => {
      const angle = sum ? item.value / sum * Math.PI * 2 : 0
      ctx.beginPath()
      ctx.moveTo(95, 105)
      ctx.arc(95, 105, 72, start, start + angle)
      ctx.closePath()
      ctx.setFillStyle(colors[index % colors.length])
      ctx.fill()
      ctx.setFillStyle(colors[index % colors.length])
      ctx.fillRect(200, 42 + index * 24, 14, 14)
      ctx.setFillStyle('#20242c')
      ctx.fillText(`${item.name} ${money(item.value)}`, 222, 54 + index * 24)
      start += angle
    })
    if (!totals.length) {
      ctx.setFillStyle('#6d7480')
      ctx.fillText('暂无收入数据', 120, 110)
    }
    ctx.draw()
  },

  drawBar() {
    const ctx = wx.createCanvasContext('barChart', this)
    const records = this.data.records
    const names = (this.data.template.income || [])
      .filter(name => name.indexOf('应发') < 0)
      .concat((this.data.template.deduct || []).filter(name => name.indexOf('合计') < 0))
    const values = names.map(name => ({
      name,
      value: records.reduce((sum, record) => sum + Number(record.items[name] || 0), 0),
      deduct: (this.data.template.deduct || []).indexOf(name) >= 0
    })).filter(item => item.value > 0)
    const max = Math.max(...values.map(item => item.value), 1)
    this.clearCanvas(ctx)
    values.slice(0, 8).forEach((item, index) => {
      const y = 28 + index * 28
      const width = item.value / max * 190
      ctx.setFillStyle(item.deduct ? '#bc3b33' : '#1f7a68')
      ctx.fillRect(118, y, width, 14)
      ctx.setFillStyle('#20242c')
      ctx.fillText(item.name.slice(0, 6), 18, y + 12)
      ctx.fillText(money(item.value), 318, y + 12)
    })
    if (!values.length) {
      ctx.setFillStyle('#6d7480')
      ctx.fillText('暂无对比数据', 120, 120)
    }
    ctx.draw()
  },

  clearCanvas(ctx) {
    ctx.clearRect(0, 0, 380, 260)
    ctx.setFillStyle('#ffffff')
    ctx.fillRect(0, 0, 380, 260)
    ctx.setFontSize(12)
  },

  drawAxis(ctx, plot, values, records) {
    const max = Math.max(...(values || []), 1)
    ctx.setStrokeStyle('#dbe0e7')
    ctx.setLineWidth(1)
    ctx.beginPath()
    ctx.moveTo(plot.left, plot.top)
    ctx.lineTo(plot.left, plot.top + plot.height)
    ctx.lineTo(plot.left + plot.width, plot.top + plot.height)
    ctx.stroke()

    ctx.setFillStyle('#6d7480')
    ctx.setFontSize(10)
    for (let index = 0; index <= 4; index += 1) {
      const ratio = index / 4
      const value = max * (1 - ratio)
      const y = plot.top + plot.height * ratio
      ctx.setStrokeStyle('#edf0f4')
      ctx.beginPath()
      ctx.moveTo(plot.left, y)
      ctx.lineTo(plot.left + plot.width, y)
      ctx.stroke()
      ctx.setFillStyle('#6d7480')
      ctx.fillText(shortMoney(value), 8, y + 4)
    }

    const list = records || []
    const step = list.length > 1 ? plot.width / (list.length - 1) : 0
    const labelStep = list.length <= 6 ? 1 : Math.ceil(list.length / 6)
    list.forEach((record, index) => {
      if (index !== 0 && index !== list.length - 1 && index % labelStep !== 0) return
      const x = plot.left + index * step
      const label = String(record.month || '').replace(/^20/, '').replace('-', '/')
      ctx.setFillStyle('#6d7480')
      ctx.fillText(label, x - 12, plot.top + plot.height + 22)
    })
  },

  saveCharts() {
    wx.canvasToTempFilePath({
      canvasId: 'lineChart',
      success: result => {
        wx.saveImageToPhotosAlbum({
          filePath: result.tempFilePath,
          success: () => wx.showToast({ title: '已保存趋势图' })
        })
      }
    }, this)
  }
})
