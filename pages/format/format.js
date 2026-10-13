const storage = require('../../utils/storage')
const salary = require('../../utils/salary')
const formats = require('../../utils/formats')

const GROUP_TITLES = {
  income: '收入项目',
  tax: '计税项目',
  deduct: '扣除项目',
  total: '实发工资',
  annual: '年度累计',
  info: '考勤与参考信息（不计入金额）'
}

const KEY_FIELDS = [
  { key: 'gross', label: '应发合计', required: true },
  { key: 'net', label: '实发合计', required: true },
  { key: 'deductTotal', label: '扣除合计（可选）' },
  { key: 'taxable', label: '计税应发（可选）' },
  { key: 'combinedTax', label: '合并扣税额（可选）' }
]

const CHECKS = [
  { key: 'income', label: '收入各项合计 = 应发合计' },
  { key: 'net', label: '应发 − 扣除 = 实发' },
  { key: 'taxable', label: '应发 + 合并扣税额 = 计税应发' }
]

// 新增公司的初始字段，可在界面上增删改
const STARTER_TEMPLATE = {
  income: ['基本工资', '应发工资合计'],
  tax: [],
  deduct: ['个人所得税'],
  total: ['实发工资合计'],
  info: []
}

const NEW_COMPANY = {
  name: '',
  currency: 'CNY',
  symbol: '¥',
  color: 'indigo',
  scanMode: 'photo',
  cleanWatermark: false,
  disabled: false,
  keys: { gross: '应发工资合计', net: '实发工资合计' },
  checks: { income: true, net: true, taxable: true }
}

function uniqueNames(names) {
  const result = []
  names.forEach(name => {
    const text = String(name || '').trim()
    if (text && result.indexOf(text) < 0) result.push(text)
  })
  return result
}

Page({
  data: {
    isNew: true,
    id: '',
    builtin: false,
    engine: 'list',
    recordCount: 0,
    form: {},
    colors: formats.COLORS,
    currencies: formats.CURRENCIES,
    scanModes: formats.SCAN_MODES,
    checkOptions: CHECKS,
    groups: [],
    keyRows: [],
    previewFrom: '',
    previewTo: ''
  },

  onLoad(options) {
    const id = options.id || ''
    let config
    let template
    if (id) {
      config = formats.getFormat(id)
      template = storage.getTemplate(id)
    } else {
      config = Object.assign({}, NEW_COMPANY, { engine: 'list', builtin: false })
      template = STARTER_TEMPLATE
    }

    // 内置公司的默认字段会被自动补回，不能删除
    const lockedNames = config.builtin ? this.defaultFieldNames(id) : []
    const groupIds = config.engine === 'thai' ? salary.templateGroups('thai') : salary.templateGroups('cn')
    this.lockedNames = lockedNames
    this.setData({
      isNew: !id,
      id,
      builtin: Boolean(config.builtin),
      engine: config.engine,
      recordCount: id ? storage.getRecords().filter(record => record.format === id).length : 0,
      form: {
        name: config.name,
        currency: config.currency,
        symbol: config.symbol,
        color: config.color,
        scanMode: config.scanMode,
        cleanWatermark: Boolean(config.cleanWatermark),
        disabled: Boolean(config.disabled),
        keys: Object.assign({}, config.keys),
        checks: Object.assign({ income: true, net: true, taxable: true }, config.checks)
      },
      groups: groupIds.map(group => ({
        group,
        title: GROUP_TITLES[group] || group,
        fields: (template[group] || []).map(name => ({ name, locked: lockedNames.indexOf(name) >= 0 }))
      }))
    }, () => this.refreshDerived())
    wx.setNavigationBarTitle({ title: id ? `编辑 ${config.name}` : '新增公司' })
  },

  defaultFieldNames(id) {
    const defaults = salary.getOrderedTemplate({}, id)
    return Object.keys(defaults).reduce((list, group) => list.concat(defaults[group] || []), [])
  },

  // 预览颜色、关键字段下拉选项随表单变化
  refreshDerived() {
    const color = formats.COLORS.find(item => item.id === this.data.form.color) || formats.COLORS[0]
    const moneyFields = uniqueNames(this.data.groups
      .filter(group => group.group !== 'info')
      .reduce((list, group) => list.concat(group.fields.map(field => field.name)), []))
    const options = ['（不设置）'].concat(moneyFields)
    const keys = this.data.form.keys || {}
    this.setData({
      previewFrom: color.from,
      previewTo: color.to,
      keyRows: KEY_FIELDS.map(item => {
        const index = keys[item.key] ? options.indexOf(keys[item.key]) : 0
        return Object.assign({}, item, { options, index: index >= 0 ? index : 0, value: index > 0 ? keys[item.key] : '' })
      })
    })
  },

  inputForm(event) {
    this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value })
  },

  // 币种从内置选项中选择，同时确定金额符号
  pickCurrency(event) {
    const currency = formats.CURRENCIES.find(item => item.code === event.currentTarget.dataset.code)
    if (!currency) return
    this.setData({ 'form.currency': currency.code, 'form.symbol': currency.symbol })
  },

  pickColor(event) {
    this.setData({ 'form.color': event.currentTarget.dataset.color }, () => this.refreshDerived())
  },

  pickMode(event) {
    if (this.data.builtin) return
    this.setData({ 'form.scanMode': event.currentTarget.dataset.mode })
  },

  toggleWatermark(event) {
    this.setData({ 'form.cleanWatermark': event.detail.value })
  },

  toggleCheck(event) {
    this.setData({ [`form.checks.${event.currentTarget.dataset.key}`]: event.detail.value })
  },

  pickKey(event) {
    const key = event.currentTarget.dataset.key
    const row = this.data.keyRows.find(item => item.key === key)
    const index = Number(event.detail.value)
    this.setData({ [`form.keys.${key}`]: index > 0 ? row.options[index] : '' }, () => this.refreshDerived())
  },

  inputField(event) {
    const { group, index } = event.currentTarget.dataset
    const groupIndex = this.data.groups.findIndex(item => item.group === group)
    const oldName = this.data.groups[groupIndex].fields[index].name
    const newName = event.detail.value
    const patch = { [`groups[${groupIndex}].fields[${index}].name`]: newName }
    // 改名时同步关键字段
    Object.keys(this.data.form.keys || {}).forEach(key => {
      if (oldName && this.data.form.keys[key] === oldName) patch[`form.keys.${key}`] = newName
    })
    this.setData(patch)
  },

  // 输入结束后再刷新下拉选项，避免每个字都重算
  blurField() {
    this.refreshDerived()
  },

  addField(event) {
    const group = event.currentTarget.dataset.group
    const groupIndex = this.data.groups.findIndex(item => item.group === group)
    const fields = this.data.groups[groupIndex].fields
    this.setData({
      [`groups[${groupIndex}].fields`]: fields.concat({ name: `新字段${fields.length + 1}`, locked: false })
    }, () => this.refreshDerived())
  },

  removeField(event) {
    const { group, index } = event.currentTarget.dataset
    const groupIndex = this.data.groups.findIndex(item => item.group === group)
    const fields = this.data.groups[groupIndex].fields
    const removed = fields[index]
    if (!removed || removed.locked) return
    const patch = { [`groups[${groupIndex}].fields`]: fields.filter((field, current) => current !== index) }
    Object.keys(this.data.form.keys || {}).forEach(key => {
      if (this.data.form.keys[key] === removed.name) patch[`form.keys.${key}`] = ''
    })
    this.setData(patch, () => this.refreshDerived())
  },

  // 各组字段：去掉空名与组内重复
  collectTemplate() {
    const template = {}
    this.data.groups.forEach(group => {
      template[group.group] = uniqueNames(group.fields.map(field => field.name))
    })
    return template
  },

  validate(template) {
    const form = this.data.form
    if (!String(form.name || '').trim()) return '请填写公司名称'
    if (!String(form.symbol || '').trim()) return '请填写币种符号'
    if (this.data.engine !== 'list' || this.data.builtin) return ''
    const allNames = Object.keys(template).reduce((list, group) => list.concat(template[group]), [])
    const keys = form.keys || {}
    const missing = KEY_FIELDS.filter(item => keys[item.key] && allNames.indexOf(keys[item.key]) < 0)
    if (missing.length) return `关键字段“${missing[0].label}”对应的字段已不存在，请重新选择`
    if ((form.checks.income || form.checks.net) && (!keys.gross || !keys.net)) {
      return '启用了金额校验，请先选择“应发合计”和“实发合计”对应的字段'
    }
    return ''
  },

  save() {
    const template = this.collectTemplate()
    const error = this.validate(template)
    if (error) {
      wx.showModal({ title: '无法保存', content: error, showCancel: false })
      return
    }
    const form = this.data.form
    const id = formats.saveFormat(Object.assign({}, form, {
      id: this.data.id,
      name: form.name.trim(),
      currency: String(form.currency || '').trim().toUpperCase(),
      symbol: form.symbol.trim()
    }))
    // 公司配置保存后再保存模板，模板整理依赖公司的引擎类型
    storage.saveTemplate(template, id)
    wx.showToast({ title: '已保存' })
    setTimeout(() => wx.navigateBack(), 400)
  },

  resetFields() {
    wx.showModal({
      title: '恢复默认字段',
      content: '将字段恢复为内置默认值（保存后生效），你自己添加的字段会被移除。',
      success: result => {
        if (!result.confirm) return
        const defaults = salary.getOrderedTemplate({}, this.data.id)
        this.setData({
          groups: this.data.groups.map(group => Object.assign({}, group, {
            fields: (defaults[group.group] || []).map(name => ({ name, locked: true }))
          }))
        }, () => this.refreshDerived())
      }
    })
  },

  toggleDisabled() {
    const disabled = !this.data.form.disabled
    formats.saveFormat(Object.assign({}, formats.getFormat(this.data.id), { disabled }))
    this.setData({ 'form.disabled': disabled })
    wx.showToast({ title: disabled ? '已停用' : '已启用' })
  },

  removeCompany() {
    if (this.data.recordCount) {
      wx.showModal({
        title: '无法删除',
        content: `该公司还有 ${this.data.recordCount} 条工资记录，删除会导致这些记录无法正常显示。可以改为“停用”。`,
        showCancel: false
      })
      return
    }
    wx.showModal({
      title: '删除公司',
      content: `确认删除“${this.data.form.name}”及其模板吗？`,
      confirmText: '删除',
      confirmColor: '#d14343',
      success: result => {
        if (!result.confirm) return
        formats.removeFormat(this.data.id)
        storage.removeTemplate(this.data.id)
        wx.showToast({ title: '已删除' })
        setTimeout(() => wx.navigateBack(), 400)
      }
    })
  }
})
