const storage = require('../../utils/storage')
const formats = require('../../utils/formats')

Page({
  data: {
    companies: []
  },

  onShow() {
    const records = storage.getRecords()
    const companies = formats.allFormats().map(config => {
      const mode = formats.SCAN_MODES.find(item => item.id === config.scanMode) || formats.SCAN_MODES[0]
      return {
        id: config.id,
        name: config.name,
        currency: config.currency,
        colorFrom: config.colorFrom,
        colorTo: config.colorTo,
        builtin: config.builtin,
        disabled: Boolean(config.disabled),
        modeName: mode.name,
        count: records.filter(record => record.format === config.id).length
      }
    })
    this.setData({ companies })
  },

  openCompany(event) {
    wx.navigateTo({ url: `/pages/format/format?id=${event.currentTarget.dataset.id}` })
  },

  addCompany() {
    wx.navigateTo({ url: '/pages/format/format' })
  }
})
