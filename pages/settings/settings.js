const storage = require('../../utils/storage')

Page({
  data: {
    settings: {}
  },

  onShow() {
    this.setData({ settings: storage.getSettings() })
  },

  changeThreshold(event) {
    this.patch({ confidenceThreshold: event.detail.value })
  },

  changePassword(event) {
    this.patch({ privacyPassword: event.detail.value })
  },

  changeBackup(event) {
    this.patch({ cloudBackup: event.detail.value })
  },

  patch(part) {
    this.setData({ settings: Object.assign({}, this.data.settings, part) })
  },

  save() {
    storage.saveSettings(this.data.settings)
    wx.showToast({ title: '已保存' })
  }
})
