const storage = require('../../utils/storage')
const formats = require('../../utils/formats')
const cards = require('../../utils/cards')

Page({
  data: {
    cards: []
  },

  onShow() {
    this.loadCards()
  },

  loadCards() {
    const allRecords = storage.getRecords()
    const list = formats.formatList()
      .map(config => cards.cardFace(config, allRecords.filter(record => record.format === config.id)))
      // 像钱包一样叠放：最近有记录的公司放在最下面（完整显示），没有记录的排在最上面
      .sort((a, b) => (a.lastMonth || '').localeCompare(b.lastMonth || ''))
    this.setData({ cards: list })
  },

  openCard(event) {
    wx.navigateTo({ url: `/pages/card/card?format=${event.currentTarget.dataset.format}` })
  },

  goScan() {
    wx.navigateTo({ url: '/pages/scan/scan' })
  }
})
