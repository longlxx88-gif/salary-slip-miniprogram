const storage = require('../../utils/storage')
const salary = require('../../utils/salary')
const formats = require('../../utils/formats')

// 趋势图可选项目：只列出当前记录里至少一个月不为 0 的字段；实发、应发排在最前，其余按金额合计从大到小
function chartOptionsFor(records, template, format) {
  const names = []
  salary.templateGroups(format).forEach(group => {
    ;(template[group] || []).forEach(name => {
      if (names.indexOf(name) < 0) names.push(name)
    })
  })
  records.forEach(record => {
    Object.keys(record.items || {}).forEach(name => {
      if (names.indexOf(name) < 0) names.push(name)
    })
  })

  const totals = {}
  names.forEach(name => {
    totals[name] = records.reduce((sum, record) => sum + Math.abs(Number(record.items[name]) || 0), 0)
  })
  const keys = salary.keyFieldNames(template, format)
  const rank = name => (name === keys.net ? 0 : name === keys.gross ? 1 : 2)
  return names
    .filter(name => totals[name] > 0)
    .sort((a, b) => rank(a) - rank(b) || totals[b] - totals[a])
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
    formatOptions: [],
    symbol: '฿',
    accent: '#0f766e',
    range: 'all',
    chartOptions: [],
    chartIndex: 0,
    chartName: '',
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
    // 有记录的公司排在前面；首次进入默认第一家有记录的公司
    const withRecords = id => allRecords.some(record => record.format === id)
    const formatOptions = formats.formatList()
      .filter(config => withRecords(config.id) || !config.builtin)
      .concat(formats.formatList().filter(config => config.builtin && !withRecords(config.id)))
    const current = formatOptions.some(config => config.id === this.data.format) ? this.data.format : ''
    const format = current || (formatOptions.find(config => withRecords(config.id)) || formatOptions[0] || { id: 'thai' }).id
    const config = formats.getFormat(format)
    const template = storage.getTemplate(format)
    const records = this.filterRecords(allRecords.filter(record => record.format === format), this.data.range)
    const summary = salary.summarize(records, template, format)
    const chartOptions = chartOptionsFor(records, template, format)
    // 切换时间范围后尽量保持当前项目，没有数据了才回到第一项
    const kept = chartOptions.indexOf(this.data.chartName)
    const chartIndex = kept >= 0 ? kept : 0
    this.setData({
      format,
      formatOptions,
      symbol: config.symbol,
      accent: config.colorFrom,
      chartOptions,
      chartIndex,
      chartName: chartOptions[chartIndex] || '',
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
    this.setData({ format, chartIndex: 0, chartName: '', selectedPointText: '' }, () => this.load())
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
    const fieldName = this.data.chartName
    const values = fieldName ? records.map(record => Number(record.items[fieldName] || 0)) : []
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
