const storage = require('../../utils/storage')
const salary = require('../../utils/salary')
const formats = require('../../utils/formats')

const CHART_OPTIONS = {
  thai: ['实发工资', '基本工资', '绩效奖金KPI'],
  cn: ['实发工资合计', '出勤基本工资(月薪)', '出勤加班费及补助(月薪)', '餐补']
}

function money(value) {
  return Number(value || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

// 以 K（千）为单位，趋势图点标签保留 2 位小数，坐标轴保留 1 位
function kMoney(value, digits) {
  return `${(Number(value || 0) / 1000).toFixed(digits)}K`
}

Page({
  data: {
    format: '',
    formatOptions: formats.formatList(),
    symbol: '฿',
    accent: '#0f766e',
    range: 'all',
    chartOptions: CHART_OPTIONS.thai,
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
    const allRecords = storage.getRecords()
    // 首次进入：默认泰国；只有国内记录时默认国内
    const format = this.data.format || (allRecords.some(record => record.format === 'thai') || !allRecords.length ? 'thai' : 'cn')
    const template = storage.getTemplate(format)
    const records = this.filterRecords(allRecords.filter(record => record.format === format), this.data.range)
    const summary = salary.summarize(records, template, format)
    const chartOptions = CHART_OPTIONS[format]
    const chartIndex = Math.min(this.data.chartIndex, chartOptions.length - 1)
    this.setData({
      format,
      symbol: formats.getFormat(format).symbol,
      accent: format === 'cn' ? '#c2410c' : '#0f766e',
      chartOptions,
      chartIndex,
      chartName: chartOptions[chartIndex],
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

  changeFormat(event) {
    const format = event.currentTarget.dataset.format
    if (format === this.data.format) return
    this.setData({ format, chartIndex: 0, selectedPointText: '' }, () => this.load())
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
      ctx.setStrokeStyle(this.data.accent)
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

      ctx.setFontSize(10)
      ctx.setTextAlign('center')
      values.forEach((value, index) => {
        const point = points[index]
        ctx.setFillStyle(this.data.accent)
        ctx.beginPath()
        ctx.arc(point.x, point.y, 4, 0, Math.PI * 2)
        ctx.fill()
        // 点较多时上下交错放置标签，避免“45.11K”这类较长文字互相重叠
        const below = values.length > 6 && index % 2 === 1
        const labelY = below ? Math.min(plot.top + plot.height - 4, point.y + 16) : Math.max(12, point.y - 9)
        ctx.setFillStyle('#172033')
        ctx.fillText(kMoney(value, 2), point.x, labelY)
      })
      ctx.setTextAlign('left')
    } else {
      ctx.setFillStyle('#8a93a3')
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
    const selectedPointText = `${point.month} ${point.name}: ${this.data.symbol}${money(point.value)}`
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
    const colors = [this.data.accent, '#e0a33a', '#5b6bd6', '#3f9fb8', '#9a6fd1', '#d1849a']
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
      ctx.setFillStyle('#172033')
      ctx.fillText(`${item.name} ${money(item.value)}`, 222, 54 + index * 24)
      start += angle
    })
    if (!totals.length) {
      ctx.setFillStyle('#8a93a3')
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
      ctx.setFillStyle(item.deduct ? '#d14343' : this.data.accent)
      ctx.fillRect(118, y, width, 14)
      ctx.setFillStyle('#172033')
      ctx.fillText(item.name.slice(0, 6), 18, y + 12)
      ctx.fillText(money(item.value), 318, y + 12)
    })
    if (!values.length) {
      ctx.setFillStyle('#8a93a3')
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
    ctx.setStrokeStyle('#e8ecf1')
    ctx.setLineWidth(1)
    ctx.beginPath()
    ctx.moveTo(plot.left, plot.top)
    ctx.lineTo(plot.left, plot.top + plot.height)
    ctx.lineTo(plot.left + plot.width, plot.top + plot.height)
    ctx.stroke()

    ctx.setFillStyle('#8a93a3')
    ctx.setFontSize(10)
    for (let index = 0; index <= 4; index += 1) {
      const ratio = index / 4
      const value = max * (1 - ratio)
      const y = plot.top + plot.height * ratio
      ctx.setStrokeStyle('#f1f3f6')
      ctx.beginPath()
      ctx.moveTo(plot.left, y)
      ctx.lineTo(plot.left + plot.width, y)
      ctx.stroke()
      ctx.setFillStyle('#8a93a3')
      ctx.fillText(kMoney(value, 1), 8, y + 4)
    }

    const list = records || []
    const step = list.length > 1 ? plot.width / (list.length - 1) : 0
    const labelStep = list.length <= 6 ? 1 : Math.ceil(list.length / 6)
    list.forEach((record, index) => {
      if (index !== 0 && index !== list.length - 1 && index % labelStep !== 0) return
      const x = plot.left + index * step
      const label = String(record.month || '').replace(/^20/, '').replace('-', '/')
      ctx.setFillStyle('#8a93a3')
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
