const storage = require('./utils/storage')
const backup = require('./utils/backup')

App({
  globalData: {
    pendingReview: null
  },

  onLaunch() {
    storage.ensureDefaults()

    if (wx.cloud) {
      wx.cloud.init({
        env: 'cloud1-d0grza2b4af76d2b4',
        traceUser: true
      })
      storage.onChange(() => backup.schedule())
      backup.init()
    }
  }
})
