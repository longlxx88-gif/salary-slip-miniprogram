const storage = require('../../utils/storage')
const salary = require('../../utils/salary')
const formats = require('../../utils/formats')
const cnSlip = require('../../utils/cnSlip')

const SECTION_TITLES = {
  income: '收入项目',
  deduct: '扣除项目',
  total: '实发工资',
  annual: '年度累计',
  tax: '计税项目',
  info: '考勤与参考信息（不计入金额）'
}

function isCloudOrRemote(path) {
  return /^cloud:\/\//.test(path) || /^https?:\/\//.test(path)
}

Page({
  data: {
    format: 'thai',
    formatName: '',
    multiImage: false,
    imagePath: '',
    imagePaths: [],
    draft: {
      month: '',
      items: []
    },
    sections: [],
    warnings: [],
    infoCollapsed: true,
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
      this.loadManualDraft(pending)
      return
    }

    const pending = getApp().globalData.pendingReview
    if (!pending) {
      wx.showToast({ title: '暂无识别数据', icon: 'none' })
      wx.navigateBack()
      return
    }

    const format = formats.normalizeFormat(pending.format)
    this.applyFormat(format)
    let draft
    if (format === 'cn') {
      draft = cnSlip.buildDraft(pending.ocrResults || [], storage.getTemplate('cn'))
      draft.imagePaths = (pending.imagePaths || []).slice()
    } else {
      draft = salary.buildDraft(pending.ocrResult, storage.getTemplate(), storage.getSettings())
      draft.imagePath = pending.imagePath || ''
    }
    draft.format = format
    draft.id = pending.replaceId || ''
    this.setDraft(draft)
  },

  applyFormat(format) {
    const config = formats.getFormat(format)
    this.setData({ format: config.id, formatName: config.name, multiImage: config.multiImage })
    wx.setNavigationBarTitle({ title: `${config.name} · 薪资校对` })
  },

  setDraft(draft) {
    this.setData({
      draft,
      imagePath: draft.imagePath || '',
      imagePaths: draft.imagePaths || [],
      warnings: draft.warnings || []
    }, () => this.refreshState())
  },

  loadManualDraft(pending) {
    const format = formats.normalizeFormat(pending.format)
    this.applyFormat(format)
    const template = storage.getTemplate(format)
    this.setDraft({
      id: pending.replaceId || '',
      format,
      month: salary.currentMonth(),
      items: salary.completeTemplateItems([], template, format),
      template,
      imagePath: format === 'cn' ? '' : (pending.imagePath || ''),
      imagePaths: format === 'cn' ? (pending.imagePaths || []).slice() : []
    })
  },

  loadExisting(id) {
    const record = storage.getRecords().find(item => item.id === id)
    if (!record) {
      wx.navigateBack()
      return
    }
    const format = formats.recordFormat(record)
    this.applyFormat(format)
    const template = storage.getTemplate(format)
    const items = []
    salary.templateGroups(format).forEach(group => {
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
    const imagePaths = record.imagePaths || (record.imagePath ? [record.imagePath] : [])
    this.setDraft({
      id: record.id,
      format,
      month: record.month,
      items: salary.completeTemplateItems(items, template, format),
      template,
      imagePath: record.imagePath || '',
      imagePaths: format === 'cn' ? imagePaths : [],
      createdAt: record.createdAt || Date.now()
    })
  },

  refreshState() {
    const draft = this.data.draft
    const format = this.data.format
    const items = salary.completeTemplateItems(draft.items, draft.template || storage.getTemplate(format), format)
    const validation = salary.validateItems(items, format)
    const pendingCount = items.filter(item => item.pending && !item.confirmed).length
    const sections = salary.templateGroups(format).map(group => ({
      group,
      title: SECTION_TITLES[group] || group,
      collapsible: group === 'info',
      items: items.filter(item => item.group === group)
    }))

    // 折叠区里有待确认项时自动展开，否则无法确认导致不能保存
    const infoPending = items.some(item => item.group === 'info' && item.pending && !item.confirmed)

    this.setData({
      sections,
      infoCollapsed: this.data.infoCollapsed && !infoPending,
      'draft.items': items,
      validation,
      pendingCount,
      canSave: pendingCount === 0 && /^20\d{2}-(0[1-9]|1[0-2])$/.test(draft.month)
    })
  },

  toggleInfo(event) {
    if (!event.currentTarget.dataset.collapsible) return
    this.setData({ infoCollapsed: !this.data.infoCollapsed })
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
    const count = this.data.multiImage ? Math.max(1, 9 - this.data.imagePaths.length) : 1
    wx.chooseMedia({
      count,
      mediaType: ['image'],
      sourceType,
      success: result => this.addReviewImages(result.tempFiles.map(file => file.tempFilePath)),
      fail: () => {
        wx.chooseImage({
          count,
          sourceType,
          success: result => this.addReviewImages(result.tempFilePaths)
        })
      }
    })
  },

  addReviewImages(paths) {
    if (!paths || !paths.length) return
    if (this.data.multiImage) {
      this.setReviewImages(this.data.imagePaths.concat(paths).slice(0, 9))
      return
    }
    this.setReviewImage(paths[0])
  },

  setReviewImage(path) {
    const draft = Object.assign({}, this.data.draft, { imagePath: path })
    this.setData({ imagePath: path, draft })
  },

  setReviewImages(paths) {
    const draft = Object.assign({}, this.data.draft, { imagePaths: paths })
    this.setData({ imagePaths: paths, draft })
  },

  removeImage() {
    this.setReviewImage('')
  },

  removeImageAt(event) {
    const index = Number(event.currentTarget.dataset.index)
    this.setReviewImages(this.data.imagePaths.filter((path, current) => current !== index))
  },

  previewImage(event) {
    const urls = this.data.multiImage ? this.data.imagePaths : [this.data.imagePath]
    const index = Number((event && event.currentTarget.dataset.index) || 0)
    if (!urls.length || !urls[0]) return
    wx.previewImage({
      current: urls[index] || urls[0],
      urls
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

  buildTemplate(items) {
    const format = this.data.format
    const template = {}
    salary.templateGroups(format).forEach(group => {
      template[group] = []
    })

    if (format === 'cn') {
      items.forEach(item => {
        if (!item.name || !template[item.group]) return
        if (template[item.group].indexOf(item.name) < 0) template[item.group].push(item.name)
      })
      return template
    }

    salary.sortItems(items).forEach(item => {
      if (item.name.indexOf('工号') >= 0 || item.name.indexOf('税前') >= 0) return
      if (item.name.indexOf('应发') >= 0 && item.group !== 'income') {
        if (template.income.indexOf(item.name) < 0) template.income.push(item.name)
        return
      }
      if (template[item.group].indexOf(item.name) < 0) template[item.group].push(item.name)
    })

    if (!template.income.some(name => name.indexOf('应发') >= 0)) template.income.push('应发工资')
    if (!template.total.some(name => name.indexOf('实发') >= 0)) template.total.push('实发工资')
    return template
  },

  saveRecord() {
    if (!this.data.canSave) return
    this.confirmUnbalanced()
      .then(() => this.persistRecord())
      .catch(error => {
        if (error && error.cancel) return
        console.error('save salary record failed', error)
        wx.showToast({ title: (error && error.message) || '保存失败', icon: 'none' })
      })
  },

  // 国内格式金额不平衡时需要二次确认（泰国格式保持原有行为）
  confirmUnbalanced() {
    if (this.data.format !== 'cn' || this.data.validation.ok) return Promise.resolve()
    return new Promise((resolve, reject) => {
      wx.showModal({
        title: '金额不平衡',
        content: `${this.data.validation.message}\n\n可能有截图漏传或识别错误，仍要保存吗？`,
        confirmText: '仍要保存',
        cancelText: '返回核对',
        success: result => (result.confirm ? resolve() : reject({ cancel: true })),
        fail: () => reject({ cancel: true })
      })
    })
  },

  persistRecord() {
    const draft = this.data.draft
    const format = this.data.format
    const template = this.buildTemplate(draft.items)

    return this.resolveDuplicateMonth(draft).then(resolvedDraft => {
      const sources = format === 'cn'
        ? (this.data.imagePaths || [])
        : [resolvedDraft.imagePath || this.data.imagePath].filter(Boolean)
      return this.persistImages(sources).then(paths => {
        const recordDraft = Object.assign({}, resolvedDraft, {
          format,
          imagePath: paths[0] || '',
          imagePaths: paths
        })
        storage.saveTemplate(template, format)
        storage.upsertRecord(salary.recordFromDraft(recordDraft))
        wx.showToast({ title: '已保存' })
        setTimeout(() => wx.navigateBack({ delta: 1 }), 400)
      })
    })
  },

  resolveDuplicateMonth(draft) {
    const format = this.data.format
    const records = storage.getRecords().filter(record => record.format === format)
    const duplicate = records.find(record => record.month === draft.month && record.id !== draft.id)
    if (!duplicate) return Promise.resolve(draft)

    return new Promise((resolve, reject) => {
      wx.showModal({
        title: '月份已存在',
        content: `${this.data.formatName} ${draft.month} 已有工资记录。是否覆盖已有记录？选择“取消”将自动生成新的月份。`,
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

  persistImages(paths) {
    if (!paths.length) return Promise.resolve([])
    if (paths.length > 1) wx.showLoading({ title: '保存图片中', mask: true })
    return Promise.all(paths.map(path => this.persistReviewImage(path)))
      .then(result => {
        wx.hideLoading()
        return result.filter(Boolean)
      }, error => {
        wx.hideLoading()
        throw error
      })
  },

  // 开启“图片云备份”时上传到云存储 salary-slips/（与已有记录一致），失败则退回本地保存
  persistReviewImage(imagePath) {
    if (!imagePath) return Promise.resolve('')
    if (isCloudOrRemote(imagePath)) return Promise.resolve(imagePath)
    if (wx.cloud && storage.getSettings().cloudImageBackup) {
      return this.uploadReviewImage(imagePath).catch(error => {
        console.warn('upload salary image failed, keep local copy', error)
        return this.copyLocalImage(imagePath)
      })
    }
    return this.copyLocalImage(imagePath)
  },

  imageSuffix(imagePath) {
    const suffixMatch = String(imagePath).match(/\.(jpg|jpeg|png|webp)$/i)
    return suffixMatch ? suffixMatch[0] : '.jpg'
  },

  uploadReviewImage(imagePath) {
    const cloudPath = `salary-slips/${Date.now()}-${Math.floor(Math.random() * 100000)}${this.imageSuffix(imagePath)}`
    return wx.cloud.uploadFile({ cloudPath, filePath: imagePath }).then(result => result.fileID)
  },

  copyLocalImage(imagePath) {
    if (imagePath.indexOf(wx.env.USER_DATA_PATH) === 0) return Promise.resolve(imagePath)

    return new Promise((resolve, reject) => {
      const fs = wx.getFileSystemManager()
      const targetPath = `${wx.env.USER_DATA_PATH}/salary-slip-${Date.now()}-${Math.floor(Math.random() * 100000)}${this.imageSuffix(imagePath)}`
      fs.copyFile({
        srcPath: imagePath,
        destPath: targetPath,
        success: () => resolve(targetPath),
        fail: reject
      })
    })
  }
})
