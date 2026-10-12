const storage = require('../../utils/storage')
const salary = require('../../utils/salary')
const formats = require('../../utils/formats')

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

    // 各格式字段取并集；“格式/币种”列区分泰国与国内记录
    const fieldNames = []
    formats.FORMAT_IDS.forEach(id => {
      const template = storage.getTemplate(id)
      salary.templateGroups(id).forEach(group => {
        ;(template[group] || []).forEach(name => {
          if (fieldNames.indexOf(name) < 0) fieldNames.push(name)
        })
      })
    })
    const headers = ['月份', '格式', '币种'].concat(fieldNames)
    const rows = records.map(record => {
      const config = formats.getFormat(record.format)
      return [record.month, config.name, config.currency].concat(fieldNames.map(name => {
        return record.items[name] === undefined ? '' : record.items[name]
      }))
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
