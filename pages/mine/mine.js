const storage = require('../../utils/storage')
const salary = require('../../utils/salary')
const formats = require('../../utils/formats')
const xlsx = require('../../utils/xlsx')

// 某家公司的导出表：月份 + 模板字段（按分组顺序）+ 记录里出现过的模板外字段；按月份从早到晚
function companySheet(config, records) {
  const template = storage.getTemplate(config.id)
  const fieldNames = []
  salary.templateGroups(config.id).forEach(group => {
    ;(template[group] || []).forEach(name => {
      if (fieldNames.indexOf(name) < 0) fieldNames.push(name)
    })
  })
  records.forEach(record => {
    Object.keys(record.items || {}).forEach(name => {
      if (fieldNames.indexOf(name) < 0) fieldNames.push(name)
    })
  })
  const rows = records
    .slice()
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(record => [record.month].concat(fieldNames.map(name => {
      const value = record.items[name]
      if (value === undefined || value === '') return ''
      const number = Number(value)
      return Number.isFinite(number) ? number : value
    })))
  return {
    name: `${config.name}（${config.currency}）`,
    rows: [['月份'].concat(fieldNames)].concat(rows)
  }
}

Page({
  goTemplate() {
    wx.navigateTo({ url: '/pages/template/template' })
  },

  goSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  },

  // 导出 Excel：每家公司一个 sheet。
  // wx.openDocument 不支持 csv（原实现点击无反应），改为以文件消息发送到聊天，可发给“文件传输助手”后保存。
  // shareFileMessage 需在点击事件中同步调用，故同步生成并写入文件
  exportData() {
    const records = storage.getRecords()
    if (!records.length) {
      wx.showToast({ title: '暂无可导出数据', icon: 'none' })
      return
    }

    const sheets = formats.allFormats()
      .map(config => ({ config, list: records.filter(record => record.format === config.id) }))
      .filter(entry => entry.list.length)
      .map(entry => companySheet(entry.config, entry.list))
    // 公司配置已删除但仍有记录的，单独放一张表，避免漏导
    const known = formats.allFormats().map(config => config.id)
    const orphans = records.filter(record => known.indexOf(record.format) < 0)
    if (orphans.length) sheets.push(companySheet(formats.getFormat(orphans[0].format), orphans))

    const fileName = `工资台账-${salary.currentMonth()}.xlsx`
    const path = `${wx.env.USER_DATA_PATH}/${fileName}`
    try {
      wx.getFileSystemManager().writeFileSync(path, xlsx.build(sheets))
    } catch (error) {
      wx.showModal({ title: '导出失败', content: `生成文件失败：${error.message || error.errMsg || error}`, showCancel: false })
      return
    }

    if (!wx.shareFileMessage) {
      wx.showModal({ title: '无法导出', content: '当前微信版本不支持发送文件，请升级微信后重试。', showCancel: false })
      return
    }
    wx.shareFileMessage({
      filePath: path,
      fileName,
      success: () => wx.showToast({ title: '已发送' }),
      fail: error => {
        const message = (error && error.errMsg) || ''
        if (/cancel/i.test(message)) return
        wx.showModal({
          title: '导出失败',
          content: `${message || '发送文件失败'}\n\n提示：开发者工具不支持发送文件，请在手机上导出。`,
          showCancel: false
        })
      }
    })
  }
})
