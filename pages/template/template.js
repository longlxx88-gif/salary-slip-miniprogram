const storage = require('../../utils/storage')
const salary = require('../../utils/salary')
const formats = require('../../utils/formats')

const SECTION_TITLES = {
  income: '收入项目',
  deduct: '扣除项目',
  total: '实发工资',
  annual: '年度累计',
  tax: '计税项目',
  info: '考勤与参考信息'
}

const DEFAULT_NAMES = {
  income: '新收入项目',
  deduct: '新扣除项目',
  total: '新实发项目',
  annual: '新年度累计项目',
  tax: '新计税项目',
  info: '新参考项目'
}

Page({
  data: {
    format: 'thai',
    formatOptions: formats.formatList(),
    template: {},
    sections: []
  },

  onShow() {
    this.load()
  },

  load() {
    const template = storage.getTemplate(this.data.format)
    this.setData({ template }, () => this.refresh())
  },

  changeFormat(event) {
    this.setData({ format: event.currentTarget.dataset.format }, () => this.load())
  },

  refresh() {
    const template = this.data.template
    this.setData({
      sections: salary.templateGroups(this.data.format).map(group => ({
        group,
        title: SECTION_TITLES[group] || group,
        items: template[group] || []
      }))
    })
  },

  updateName(event) {
    const group = event.currentTarget.dataset.group
    const index = event.currentTarget.dataset.index
    const template = Object.assign({}, this.data.template)
    template[group][index] = event.detail.value
    storage.saveTemplate(template, this.data.format)
    this.setData({ template }, () => this.refresh())
  },

  addField(event) {
    const group = event.currentTarget.dataset.group
    const template = Object.assign({}, this.data.template)
    template[group] = (template[group] || []).concat(DEFAULT_NAMES[group] || '新项目')
    storage.saveTemplate(template, this.data.format)
    this.setData({ template }, () => this.refresh())
  },

  resetTemplate() {
    wx.showModal({
      title: '重置模板',
      content: `将“${formats.getFormat(this.data.format).name}”模板恢复为默认字段，适合工资条版式变化后重新生成。`,
      success: result => {
        if (result.confirm) {
          storage.saveTemplate(salary.getOrderedTemplate({}, this.data.format), this.data.format)
          this.load()
        }
      }
    })
  }
})
