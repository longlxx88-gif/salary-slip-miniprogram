const storage = require('../../utils/storage')
const salary = require('../../utils/salary')

Page({
  goTemplate() {
    wx.navigateTo({ url: '/pages/template/template' })
  },

  goSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  },

  exportCsv() {
    const records = storage.getRecords()
    if (!records.length) {
      wx.showToast({ title: '暂无可导出数据', icon: 'none' })
      return
    }

    const template = salary.getOrderedTemplate(storage.getTemplate())
    const headers = ['月份'].concat(template.income || [], template.deduct || [], template.total || [], template.annual || [])
    const rows = records.map(record => {
      return headers.map(header => header === '月份' ? record.month : record.items[header] === undefined ? '' : record.items[header])
    })
    const csv = [headers, ...rows].map(row => row.join(',')).join('\n')
    const path = `${wx.env.USER_DATA_PATH}/salary-records.csv`

    wx.getFileSystemManager().writeFile({
      filePath: path,
      data: '\ufeff' + csv,
      encoding: 'utf8',
      success: () => wx.openDocument({ filePath: path, fileType: 'csv' })
    })
  }
})
