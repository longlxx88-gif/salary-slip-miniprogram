const storage = require('../../utils/storage')
const salary = require('../../utils/salary')

Page({
  data: {
    template: {},
    sections: []
  },

  onShow() {
    this.load()
  },

  load() {
    const template = storage.getTemplate()
    this.setData({ template }, () => this.refresh())
  },

  refresh() {
    const template = this.data.template
    this.setData({
      sections: [
        { group: 'income', title: '收入项目', items: template.income || [] },
        { group: 'deduct', title: '扣除项目', items: template.deduct || [] },
        { group: 'total', title: '实发工资', items: template.total || [] },
        { group: 'annual', title: '年度累计', items: template.annual || [] }
      ]
    })
  },

  updateName(event) {
    const group = event.currentTarget.dataset.group
    const index = event.currentTarget.dataset.index
    const template = Object.assign({}, this.data.template)
    template[group][index] = event.detail.value
    storage.saveTemplate(template)
    this.setData({ template }, () => this.refresh())
  },

  addField(event) {
    const group = event.currentTarget.dataset.group
    const template = Object.assign({}, this.data.template)
    const defaultName = group === 'deduct'
      ? '新扣除项目'
      : group === 'annual'
        ? '新年度累计项目'
        : group === 'total'
          ? '新实发项目'
          : '新收入项目'
    template[group] = (template[group] || []).concat(defaultName)
    storage.saveTemplate(template)
    this.setData({ template }, () => this.refresh())
  },

  resetTemplate() {
    wx.showModal({
      title: '重置模板',
      content: '适合更换公司或工资条版式后重新生成。',
      success: result => {
        if (result.confirm) {
          storage.saveTemplate(salary.getOrderedTemplate({}))
          this.load()
        }
      }
    })
  }
})
