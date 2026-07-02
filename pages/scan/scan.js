Page({
  data: {
    imagePath: '',
    replaceId: '',
    recognizing: false,
    canvasWidth: 320,
    canvasHeight: 320
  },

  onLoad(options) {
    this.setData({ replaceId: options.replaceId || '' })
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
      success: result => {
        this.setData({ imagePath: result.tempFiles[0].tempFilePath })
      },
      fail: () => {
        wx.chooseImage({
          count: 1,
          sourceType,
          success: result => this.setData({ imagePath: result.tempFilePaths[0] })
        })
      }
    })
  },

  recognize() {
    this.setData({ recognizing: true })
    this.prepareImageForUpload(this.data.imagePath)
      .then(uploadPath => this.uploadAndCallOcr(uploadPath))
      .catch(error => {
        console.error('prepare image failed', error)
        this.setData({ recognizing: false })
        wx.showModal({
          title: '图片过大',
          content: error.message || '图片压缩失败，请裁剪后重试。',
          showCancel: false
        })
      })
  },

  uploadAndCallOcr(uploadPath) {
    const cloudPath = `ocr-temp/${Date.now()}-${Math.floor(Math.random() * 100000)}.jpg`
    return wx.cloud.uploadFile({
      cloudPath,
      filePath: uploadPath
    }).then(uploadResult => {
      const fileID = uploadResult.fileID
      return wx.cloud.getTempFileURL({
        fileList: [fileID]
      }).then(urlResult => {
        const item = urlResult.fileList && urlResult.fileList[0]
        const imageUrl = item && item.tempFileURL
        if (!imageUrl) throw new Error('获取临时图片链接失败')

        return this.callOcr({
          imageUrl,
          cleanupFileID: fileID
        })
      }).catch(error => {
        this.cleanupCloudFile(fileID)
        throw error
      })
    }).catch(error => {
      console.warn('upload image url failed, fallback to base64', error)
      return this.readAndCallOcr(uploadPath)
    })
  },

  readAndCallOcr(uploadPath) {
    wx.getFileSystemManager().readFile({
      filePath: uploadPath,
      encoding: 'base64',
      success: file => {
        console.log('ocr upload base64 length', file.data.length)
        if (file.data.length > 380 * 1024) {
          this.setData({ recognizing: false })
          wx.showModal({
            title: '图片仍然过大',
            content: '图片压缩后仍超过云函数调用限制，请裁剪工资条主体后重试。',
            showCancel: false
          })
          return
        }

        this.callOcr({ imageBase64: file.data })
      },
      fail: () => {
        this.setData({ recognizing: false })
        wx.showToast({ title: '读取图片失败', icon: 'none' })
      }
    })
  },

  callOcr(payload) {
    return wx.cloud.callFunction({
      name: 'ocr',
      data: {
        imageUrl: payload.imageUrl || '',
        imageBase64: payload.imageBase64 || '',
        mock: false
      },
      success: result => {
        const ocrResult = result.result || {}
        if (ocrResult.ok === false) {
          wx.showModal({
            title: 'OCR 识别失败',
            content: `${ocrResult.error || '未知错误'}\n\n已载入样例数据，可先验证校对流程。`,
            showCancel: false,
            success: () => this.openMockReview()
          })
          return
        }
        this.resolveOcrResult(ocrResult)
          .then(fullResult => this.openReview(fullResult))
          .catch(error => {
            console.error('load full ocr result failed', error)
            wx.showModal({
              title: '读取 OCR 结果失败',
              content: error.message || '无法从云端读取完整识别结果，请重试。',
              showCancel: false
            })
          })
      },
      fail: error => {
        console.error('ocr cloud function failed', error)
        const message = error && (error.errMsg || error.message) ? (error.errMsg || error.message) : '云函数不可用'
        wx.showModal({
          title: '云函数不可用',
          content: `${message}\n\n已载入样例数据，可先验证校对流程。`,
          showCancel: false,
          success: () => this.openMockReview()
        })
      },
      complete: () => {
        if (payload.cleanupFileID) this.cleanupCloudFile(payload.cleanupFileID)
        this.setData({ recognizing: false })
      }
    })
  },

  resolveOcrResult(ocrResult) {
    if (!ocrResult.truncated || !ocrResult.recordId) return Promise.resolve(ocrResult)

    return wx.cloud.callFunction({
      name: 'ocr',
      data: {
        action: 'getResult',
        recordId: ocrResult.recordId
      }
    }).then(result => {
      const fullResult = result.result || {}
      if (fullResult.ok === false) throw new Error(fullResult.error || '完整 OCR 结果查询失败')
      return fullResult
    })
  },

  openReview(ocrResult) {
    const app = getApp()
    app.globalData.pendingReview = {
      replaceId: this.data.replaceId,
      imagePath: this.data.imagePath,
      ocrResult
    }
    wx.navigateTo({ url: '/pages/review/review' })
  },

  cleanupCloudFile(fileID) {
    if (!fileID) return
    wx.cloud.deleteFile({
      fileList: [fileID],
      fail: error => console.warn('cleanup temp image failed', error)
    })
  },

  prepareImageForUpload(path) {
    return this.getFileSize(path).then(size => {
      if (size <= 4 * 1024 * 1024) return path
      return this.compressByCanvas(path, 4 * 1024 * 1024)
    })
  },

  getFileSize(path) {
    return new Promise((resolve, reject) => {
      wx.getFileInfo({
        filePath: path,
        success: result => resolve(result.size || 0),
        fail: reject
      })
    })
  },

  getImageInfo(path) {
    return new Promise((resolve, reject) => {
      wx.getImageInfo({
        src: path,
        success: resolve,
        fail: reject
      })
    })
  },

  canvasToFile(quality, width, height) {
    return new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvasId: 'compressCanvas',
        fileType: 'jpg',
        quality,
        destWidth: width,
        destHeight: height,
        success: result => resolve(result.tempFilePath),
        fail: reject
      }, this)
    })
  },

  compressByCanvas(path, targetSize) {
    return this.getImageInfo(path).then(info => {
      const plans = [
        { maxSide: 2600, quality: 0.88 },
        { maxSide: 2400, quality: 0.82 },
        { maxSide: 2200, quality: 0.76 },
        { maxSide: 2000, quality: 0.70 },
        { maxSide: 1800, quality: 0.64 }
      ]

      const runPlan = index => {
        if (index >= plans.length) {
          return path
        }

        const plan = plans[index]
        const scale = Math.min(1, plan.maxSide / Math.max(info.width, info.height))
        const width = Math.max(1, Math.round(info.width * scale))
        const height = Math.max(1, Math.round(info.height * scale))

        return new Promise(resolve => {
          this.setData({ canvasWidth: width, canvasHeight: height }, resolve)
        }).then(() => new Promise((resolve, reject) => {
          const ctx = wx.createCanvasContext('compressCanvas', this)
          ctx.drawImage(path, 0, 0, width, height)
          ctx.draw(false, () => {
            this.canvasToFile(plan.quality, width, height)
              .then(filePath => this.getFileSize(filePath).then(size => ({ filePath, size, plan })))
              .then(result => {
                console.log('compressed image size', result.size, result.plan)
                if (result.size <= targetSize) resolve(result.filePath)
                else resolve(runPlan(index + 1))
              })
              .catch(reject)
          })
        }))
      }

      return runPlan(0)
    })
  },

  useMock() {
    this.openMockReview()
  },

  openManualReview() {
    getApp().globalData.pendingReview = {
      replaceId: this.data.replaceId,
      imagePath: this.data.imagePath,
      manual: true
    }
    wx.navigateTo({ url: '/pages/review/review?manual=1' })
  },

  openMockReview() {
    getApp().globalData.pendingReview = {
      replaceId: this.data.replaceId,
      imagePath: this.data.imagePath,
      ocrResult: {
        items: [
          { text: '基本工资', x: 30, y: 80, confidences: [99, 98, 99, 98] },
          { text: '5000.00', x: 420, y: 80, confidences: [98, 98, 97, 96, 99, 99, 99] },
          { text: '绩效奖金', x: 30, y: 130, confidences: [97, 96, 96, 95] },
          { text: '1200.00', x: 420, y: 130, confidences: [94, 95, 96, 96, 95, 94, 95] },
          { text: '养老个人', x: 30, y: 180, confidences: [96, 96, 95, 95] },
          { text: '480.00', x: 420, y: 180, confidences: [96, 95, 93, 94, 94, 94] },
          { text: '公积金个人', x: 30, y: 230, confidences: [95, 95, 94, 94, 94] },
          { text: '400.00', x: 420, y: 230, confidences: [92, 93, 94, 93, 92, 93] },
          { text: '个人所得税', x: 30, y: 280, confidences: [95, 94, 94, 93, 93] },
          { text: '0.00', x: 420, y: 280, confidences: [68, 90, 91, 92] },
          { text: '应发工资', x: 30, y: 340, confidences: [98, 98, 98, 98] },
          { text: '6200.00', x: 420, y: 340, confidences: [98, 98, 98, 98, 98, 98, 98] },
          { text: '实发工资', x: 30, y: 390, confidences: [98, 98, 98, 98] },
          { text: '5320.00', x: 420, y: 390, confidences: [97, 97, 96, 96, 96, 96, 96] }
        ]
      }
    }
    wx.navigateTo({ url: '/pages/review/review' })
  }
})
