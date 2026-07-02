const storage = require('../../utils/storage')
const salary = require('../../utils/salary')

Page({
  data: {
    imagePath: '',
    draft: {
      month: '',
      items: []
    },
    sections: [],
    validation: {
      ok: true,
      message: ''
    },
    pendingCount: 0,
    canSave: false
  },

  onLoad(options) {
    if (options.id) {
      this.loadExisting(options.id)
      return
    }

    if (options.manual) {
      const pending = getApp().globalData.pendingReview || {}
      this.loadManualDraft(pending.imagePath || '', pending.replaceId || '')
      return
    }

    const pending = getApp().globalData.pendingReview
    if (!pending) {
      wx.showToast({ title: '暂无识别数据', icon: 'none' })
      wx.navigateBack()
      return
    }

    const draft = salary.buildDraft(pending.ocrResult, storage.getTemplate(), storage.getSettings())
    draft.id = pending.replaceId || ''
    draft.imagePath = pending.imagePath || ''
    this.setData({ imagePath: draft.imagePath, draft }, () => this.refreshState())
  },

  loadManualDraft(imagePath, replaceId) {
    const template = storage.getTemplate()
    const items = salary.completeTemplateItems([], template)
    const draft = {
      id: replaceId || '',
      month: salary.currentMonth(),
      items,
      template,
      imagePath: imagePath || ''
    }
    this.setData({ imagePath: imagePath || '', draft }, () => this.refreshState())
  },

  loadExisting(id) {
    const record = storage.getRecords().find(item => item.id === id)
    const template = storage.getTemplate()
    if (!record) {
      wx.navigateBack()
      return
    }
    const items = []
    salary.templateGroups().forEach(group => {
      ;(template[group] || []).forEach(name => {
        items.push({
          id: `${group}_${name}`,
          name,
          group,
          amount: record.items[name] === undefined ? '' : record.items[name],
          pending: false,
          confirmed: true
        })
      })
    })
    const sortedItems = salary.completeTemplateItems(items, template)
    this.setData({
      imagePath: record.imagePath || '',
      draft: {
        id: record.id,
        month: record.month,
        items: sortedItems,
        template,
        imagePath: record.imagePath || '',
        createdAt: record.createdAt || Date.now()
      }
    }, () => this.refreshState())
  },

  refreshState() {
    const draft = this.data.draft
    const items = salary.completeTemplateItems(draft.items, draft.template || storage.getTemplate())
    const validation = salary.validateItems(items)
    const pendingCount = items.filter(item => item.pending && !item.confirmed).length
    const sections = [
      { group: 'income', title: '收入项目', items: items.filter(item => item.group === 'income') },
      { group: 'deduct', title: '扣除项目', items: items.filter(item => item.group === 'deduct') },
      { group: 'total', title: '实发工资', items: items.filter(item => item.group === 'total') },
      { group: 'annual', title: '年度累计', items: items.filter(item => item.group === 'annual') }
    ]

    this.setData({
      sections,
      'draft.items': items,
      validation,
      pendingCount,
      canSave: pendingCount === 0 && /^20\d{2}-(0[1-9]|1[0-2])$/.test(draft.month)
    })
  },

  updateMonth(event) {
    const draft = Object.assign({}, this.data.draft, { month: event.detail.value })
    this.setData({ draft }, () => this.refreshState())
  },

  updateName(event) {
    this.updateItem(event.currentTarget.dataset.id, { name: event.detail.value })
  },

  updateAmount(event) {
    const value = event.detail.value
    this.updateItem(event.currentTarget.dataset.id, { amount: value })
  },

  confirmItem(event) {
    this.updateItem(event.currentTarget.dataset.id, { confirmed: true })
  },

  updateItem(id, patch) {
    const draft = Object.assign({}, this.data.draft)
    draft.items = draft.items.map(item => item.id === id ? Object.assign({}, item, patch) : item)
    this.setData({ draft }, () => this.refreshState())
  },

  chooseCamera() {
    this.chooseImage(['camera'])
  },

  chooseAlbum() {
    this.chooseImage(['album'])
  },

  chooseImage(sourceType) {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType,
      success: result => this.setReviewImage(result.tempFiles[0].tempFilePath),
      fail: () => {
        wx.chooseImage({
          count: 1,
          sourceType,
          success: result => this.setReviewImage(result.tempFilePaths[0])
        })
      }
    })
  },

  setReviewImage(path) {
    const draft = Object.assign({}, this.data.draft, { imagePath: path })
    this.setData({ imagePath: path, draft })
  },

  removeImage() {
    this.setReviewImage('')
  },

  previewImage() {
    if (!this.data.imagePath) return
    wx.previewImage({
      current: this.data.imagePath,
      urls: [this.data.imagePath]
    })
  },

  addIncome() {
    this.addItem('income', '新收入项目')
  },

  addDeduct() {
    this.addItem('deduct', '新扣除项目')
  },

  addItem(group, name) {
    const draft = Object.assign({}, this.data.draft)
    draft.items = draft.items.concat({
      id: `${group}_${Date.now()}`,
      group,
      name,
      amount: '',
      pending: false,
      confirmed: true
    })
    this.setData({ draft }, () => this.refreshState())
  },

  saveRecord() {
    if (!this.data.canSave) return
    const draft = this.data.draft
    const template = {
      income: [],
      deduct: [],
      total: [],
      annual: []
    }

    salary.sortItems(draft.items).forEach(item => {
      if (item.name.indexOf('工号') >= 0 || item.name.indexOf('税前') >= 0) return
      if (item.name.indexOf('应发') >= 0 && item.group !== 'income') {
        if (template.income.indexOf(item.name) < 0) template.income.push(item.name)
        return
      }
      if (template[item.group].indexOf(item.name) < 0) template[item.group].push(item.name)
    })

    if (!template.income.some(name => name.indexOf('应发') >= 0)) template.income.push('应发工资')
    if (!template.total.some(name => name.indexOf('实发') >= 0)) template.total.push('实发工资')

    this.resolveDuplicateMonth(draft)
      .then(resolvedDraft => this.persistReviewImage(resolvedDraft.imagePath || this.data.imagePath)
        .then(imagePath => {
          const recordDraft = Object.assign({}, resolvedDraft, { imagePath })
          storage.saveTemplate(template)
          storage.upsertRecord(salary.recordFromDraft(recordDraft))
          wx.showToast({ title: '已保存' })
          setTimeout(() => wx.navigateBack({ delta: 1 }), 400)
        }))
      .catch(error => {
        if (error && error.cancel) return
        console.error('persist salary image failed', error)
        wx.showToast({ title: error.message || '保存失败', icon: 'none' })
      })
  },

  resolveDuplicateMonth(draft) {
    const records = storage.getRecords()
    const duplicate = records.find(record => record.month === draft.month && record.id !== draft.id)
    if (!duplicate) return Promise.resolve(draft)

    return new Promise((resolve, reject) => {
      wx.showModal({
        title: '月份已存在',
        content: `${draft.month} 已有工资记录。是否覆盖已有记录？选择“取消”将自动生成新的月份。`,
        confirmText: '覆盖',
        cancelText: '新月份',
        success: result => {
          if (result.confirm) {
            resolve(Object.assign({}, draft, {
              id: duplicate.id,
              createdAt: duplicate.createdAt || draft.createdAt
            }))
            return
          }

          const nextMonth = this.nextAvailableMonth(draft.month, records)
          wx.showModal({
            title: '使用新月份',
            content: `将保存为 ${nextMonth}，是否继续？`,
            confirmText: '保存',
            cancelText: '返回修改',
            success: nextResult => {
              if (nextResult.confirm) {
                resolve(Object.assign({}, draft, {
                  id: '',
                  month: nextMonth
                }))
              } else {
                reject({ cancel: true })
              }
            },
            fail: () => reject({ cancel: true })
          })
        },
        fail: () => reject({ cancel: true })
      })
    })
  },

  nextAvailableMonth(month, records) {
    const used = records.map(record => record.month)
    let current = month
    do {
      current = this.addMonth(current)
    } while (used.indexOf(current) >= 0)
    return current
  },

  addMonth(month) {
    const parts = String(month || '').split('-')
    let year = Number(parts[0] || new Date().getFullYear())
    let value = Number(parts[1] || 1) + 1
    if (value > 12) {
      year += 1
      value = 1
    }
    return `${year}-${String(value).padStart(2, '0')}`
  },

  persistReviewImage(imagePath) {
    if (!imagePath) return Promise.resolve('')
    if (imagePath.indexOf(wx.env.USER_DATA_PATH) === 0) return Promise.resolve(imagePath)
    if (/^cloud:\/\//.test(imagePath) || /^https?:\/\//.test(imagePath)) return Promise.resolve(imagePath)

    return new Promise((resolve, reject) => {
      const fs = wx.getFileSystemManager()
      const suffixMatch = String(imagePath).match(/\.(jpg|jpeg|png|webp)$/i)
      const suffix = suffixMatch ? suffixMatch[0] : '.jpg'
      const targetPath = `${wx.env.USER_DATA_PATH}/salary-slip-${Date.now()}-${Math.floor(Math.random() * 100000)}${suffix}`
      fs.copyFile({
        srcPath: imagePath,
        destPath: targetPath,
        success: () => resolve(targetPath),
        fail: reject
      })
    })
  }
})
