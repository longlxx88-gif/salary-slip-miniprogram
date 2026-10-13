const storage = require('../../utils/storage')
const formats = require('../../utils/formats')

const MAX_IMAGES = 9
const OCR_CONCURRENCY = 3
const UPLOAD_ATTEMPTS = 3
const PAGE_ATTEMPTS = 2
// 国内工资截图去水印：实测水印像素亮度 ≥ 153，正文为纯黑。
// 亮度 ≥ 阈值的像素刷白，其余按比例保留灰度（不做硬二值化，避免笔画断裂）
const WATERMARK_LUMINANCE = 150

function markError(error, extra) {
  const result = error instanceof Error ? error : new Error((error && (error.errMsg || error.message)) || String(error))
  return Object.assign(result, extra)
}

Page({
  data: {
    format: 'thai',
    formatOptions: [],
    multiImage: false,
    manualOnly: false,
    scanModeDesc: '',
    imagePath: '',
    imagePaths: [],
    replaceId: '',
    recognizing: false,
    progressText: '',
    canvasWidth: 320,
    canvasHeight: 320
  },

  onLoad(options) {
    const replaceId = options.replaceId || ''
    const record = replaceId ? storage.getRecords().find(item => item.id === replaceId) : null
    const format = formats.normalizeFormat(options.format || (record && record.format) || storage.getLastFormat())
    this.setData({ replaceId, formatOptions: formats.formatList() })
    this.applyFormat(format)
  },

  applyFormat(format) {
    const config = formats.getFormat(format)
    this.config = config
    const mode = formats.SCAN_MODES.find(item => item.id === config.scanMode) || formats.SCAN_MODES[0]
    this.setData({
      format: config.id,
      multiImage: config.multiImage,
      manualOnly: config.scanMode === 'manual',
      scanModeDesc: mode.desc
    })
    const suffix = config.scanMode === 'manual' ? '手动录入' : (config.multiImage ? '截图识别' : '拍照识别')
    wx.setNavigationBarTitle({ title: `${config.name} · ${suffix}` })
  },

  switchFormat(event) {
    if (this.data.recognizing) return
    const format = event.currentTarget.dataset.format
    storage.setLastFormat(format)
    this.applyFormat(format)
  },

  chooseCamera() {
    this.chooseImage(['camera'])
  },

  chooseAlbum() {
    this.chooseImage(['album'])
  },

  chooseImage(sourceType) {
    const count = this.data.multiImage ? MAX_IMAGES - this.data.imagePaths.length : 1
    if (count <= 0) {
      wx.showToast({ title: `最多 ${MAX_IMAGES} 张`, icon: 'none' })
      return
    }
    wx.chooseMedia({
      count,
      mediaType: ['image'],
      sourceType,
      success: result => this.addImages(result.tempFiles.map(file => file.tempFilePath)),
      fail: () => {
        wx.chooseImage({
          count,
          sourceType,
          success: result => this.addImages(result.tempFilePaths)
        })
      }
    })
  },

  addImages(paths) {
    if (!paths || !paths.length) return
    if (this.data.multiImage) {
      this.setData({ imagePaths: this.data.imagePaths.concat(paths).slice(0, MAX_IMAGES) })
    } else {
      this.setData({ imagePath: paths[0] })
    }
  },

  removeImage(event) {
    const index = Number(event.currentTarget.dataset.index)
    this.setData({ imagePaths: this.data.imagePaths.filter((path, current) => current !== index) })
  },

  previewImage(event) {
    const urls = this.data.multiImage ? this.data.imagePaths : [this.data.imagePath]
    const index = Number(event.currentTarget.dataset.index || 0)
    if (!urls.length || !urls[0]) return
    wx.previewImage({ current: urls[index] || urls[0], urls })
  },

  recognize() {
    if (this.data.multiImage) {
      this.recognizePages()
      return
    }

    this.setData({ recognizing: true, progressText: '' })
    this.ocrImage(this.data.imagePath, formats.ocrMode(this.data.format))
      .then(ocrResult => this.openReview({ ocrResult }))
      // 样例数据是泰国工资条，只有泰国公司在识别失败时才回退到样例
      .catch(error => this.showOcrError(error, this.data.format === 'thai'))
      .then(() => this.setData({ recognizing: false }))
  },

  // 多张截图：按配置先去水印，再以 OCR_CONCURRENCY 张并发识别（通用 + 表格），全部完成后合并校对
  recognizePages() {
    const paths = this.data.imagePaths.slice()
    if (!paths.length) return
    const mode = formats.ocrMode(this.data.format)
    const cleanWatermark = Boolean(this.config && this.config.cleanWatermark)
    const results = []
    const uploadedPaths = []
    const failures = []
    const startedAt = Date.now()
    let nextIndex = 0
    let finished = 0

    this.setData({ recognizing: true, progressText: `识别中 0/${paths.length}` })
    const worker = () => {
      if (nextIndex >= paths.length) return Promise.resolve()
      const index = nextIndex
      nextIndex += 1
      const pageStartedAt = Date.now()
      // 整张失败时（上传/识别）从头再试一次
      const attemptPage = attempt => this.ocrImage(uploadedPaths[index], mode).catch(error => {
        if (attempt >= PAGE_ATTEMPTS) throw error
        console.warn(`[ocr] 第 ${index + 1} 张失败，重试`, error)
        return attemptPage(attempt + 1)
      })
      return (cleanWatermark ? this.cleanScreenshot(paths[index]) : Promise.resolve(paths[index]))
        .then(path => {
          uploadedPaths[index] = path
          return attemptPage(1)
        })
        .then(result => {
          results[index] = result
          console.log(`[ocr] 第 ${index + 1} 张完成，用时 ${Date.now() - pageStartedAt}ms`)
        })
        .catch(error => {
          console.error('ocr page failed', index, error)
          failures.push(`第 ${index + 1} 张：${error.message || '识别失败'}`)
        })
        .then(() => {
          finished += 1
          this.setData({ progressText: `识别中 ${finished}/${paths.length}` })
          return worker()
        })
    }

    const workers = []
    for (let count = 0; count < Math.min(OCR_CONCURRENCY, paths.length); count += 1) workers.push(worker())

    Promise.all(workers).then(() => {
      console.log(`[ocr] ${paths.length} 张全部完成，总用时 ${Date.now() - startedAt}ms`)
      this.setData({ recognizing: false, progressText: '' })
      const indexes = paths.map((path, index) => index).filter(index => results[index])
      const ocrResults = indexes.map(index => results[index])
      // 记录里保存压缩后的图片，减少后续云存储上传量
      const imagePaths = indexes.map(index => uploadedPaths[index] || paths[index])
      failures.sort()
      if (!ocrResults.length) {
        wx.showModal({ title: '识别失败', content: failures.join('\n') || '未知错误', showCancel: false })
        return
      }
      if (!failures.length) {
        this.openReview({ ocrResults, imagePaths })
        return
      }
      wx.showModal({
        title: `${failures.length} 张识别失败`,
        content: `${failures.join('\n')}\n\n是否用其余 ${ocrResults.length} 张继续？`,
        confirmText: '继续',
        cancelText: '取消',
        success: result => {
          if (result.confirm) this.openReview({ ocrResults, imagePaths })
        }
      })
    })
  },

  // 去水印后的灰度图文字更清晰、文件更小；处理失败时退回原图
  cleanScreenshot(path) {
    // 共用一个 canvas，必须排队处理
    const task = (this.cleanQueue || Promise.resolve()).then(() => this.removeWatermark(path))
    this.cleanQueue = task.catch(() => null)
    return task.catch(error => {
      console.warn('[ocr] 去水印失败，使用原图', error)
      return path
    })
  },

  getCleanCanvas() {
    if (!this.cleanCanvasPromise) {
      this.cleanCanvasPromise = new Promise((resolve, reject) => {
        wx.createSelectorQuery().in(this).select('#cleanCanvas').fields({ node: true }).exec(result => {
          const canvas = result && result[0] && result[0].node
          if (canvas) resolve(canvas)
          else reject(new Error('canvas 不可用'))
        })
      })
      this.cleanCanvasPromise.catch(() => {
        this.cleanCanvasPromise = null
      })
    }
    return this.cleanCanvasPromise
  },

  removeWatermark(path) {
    const startedAt = Date.now()
    return this.getCleanCanvas().then(canvas => new Promise((resolve, reject) => {
      const image = canvas.createImage()
      image.onerror = reject
      image.onload = () => {
        try {
          const width = image.width
          const height = image.height
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          ctx.drawImage(image, 0, 0, width, height)
          const imageData = ctx.getImageData(0, 0, width, height)
          const pixels = imageData.data
          const scale = 255 / WATERMARK_LUMINANCE
          for (let index = 0; index < pixels.length; index += 4) {
            const luminance = 0.299 * pixels[index] + 0.587 * pixels[index + 1] + 0.114 * pixels[index + 2]
            const value = luminance >= WATERMARK_LUMINANCE ? 255 : Math.round(luminance * scale)
            pixels[index] = value
            pixels[index + 1] = value
            pixels[index + 2] = value
            pixels[index + 3] = 255
          }
          ctx.putImageData(imageData, 0, 0)
          wx.canvasToTempFilePath({
            canvas,
            fileType: 'png',
            destWidth: width,
            destHeight: height,
            success: result => {
              console.log(`[ocr] 去水印 ${width}x${height}，用时 ${Date.now() - startedAt}ms`)
              resolve(result.tempFilePath)
            },
            fail: reject
          })
        } catch (error) {
          reject(error)
        }
      }
      image.src = path
    }))
  },

  ocrImage(path, mode) {
    return this.prepareImageForUpload(path)
      .catch(error => {
        throw markError(error, { title: '图片过大', message: error.message || '图片压缩失败，请裁剪后重试。' })
      })
      .then(uploadPath => this.uploadImage(uploadPath).then(
        uploaded => this.invokeOcr({ imageUrl: uploaded.imageUrl }, mode).then(result => {
          this.cleanupCloudFile(uploaded.fileID)
          return result
        }, error => {
          this.cleanupCloudFile(uploaded.fileID)
          throw error
        }),
        uploadError => {
          console.warn('upload image url failed, fallback to base64', uploadError)
          const reason = (uploadError && (uploadError.errMsg || uploadError.message)) || String(uploadError)
          return this.readBase64(uploadPath)
            .then(imageBase64 => this.invokeOcr({ imageBase64 }, mode))
            .catch(error => {
              // base64 兜底也失败时，真正原因通常是上传失败，一并展示便于排查
              throw markError(error, { message: `上传云存储失败：${reason}\n（兜底也失败：${error.message}）` })
            })
        }
      ))
  },

  // 手机网络下上传偶发失败，间隔重试
  uploadImage(uploadPath, attempt) {
    const current = attempt || 1
    return this.uploadImageOnce(uploadPath).catch(error => {
      if (current >= UPLOAD_ATTEMPTS) throw error
      console.warn(`[ocr] 上传失败，第 ${current} 次重试`, error)
      return new Promise(resolve => setTimeout(resolve, 800 * current))
        .then(() => this.uploadImage(uploadPath, current + 1))
    })
  },

  uploadImageOnce(uploadPath) {
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
        return { imageUrl, fileID }
      }).catch(error => {
        this.cleanupCloudFile(fileID)
        throw error
      })
    })
  },

  readBase64(uploadPath) {
    return new Promise((resolve, reject) => {
      wx.getFileSystemManager().readFile({
        filePath: uploadPath,
        encoding: 'base64',
        success: file => {
          console.log('ocr upload base64 length', file.data.length)
          if (file.data.length > 380 * 1024) {
            reject(markError(new Error('图片压缩后仍超过云函数调用限制，请裁剪工资条主体后重试。'), { title: '图片仍然过大' }))
            return
          }
          resolve(file.data)
        },
        fail: () => reject(markError(new Error('读取图片失败'), { title: '读取图片失败' }))
      })
    })
  },

  invokeOcr(payload, mode) {
    return wx.cloud.callFunction({
      name: 'ocr',
      data: {
        imageUrl: payload.imageUrl || '',
        imageBase64: payload.imageBase64 || '',
        mode: mode || '',
        mock: false
      }
    }).then(result => {
      const ocrResult = result.result || {}
      if (ocrResult.ok === false) {
        throw markError(new Error(ocrResult.error || '未知错误'), { title: 'OCR 识别失败', mockFallback: true })
      }
      return this.resolveOcrResult(ocrResult).catch(error => {
        throw markError(error, { title: '读取 OCR 结果失败', message: error.message || '无法从云端读取完整识别结果，请重试。' })
      })
    }, error => {
      console.error('ocr cloud function failed', error)
      throw markError(error, { title: '云函数不可用', mockFallback: true })
    })
  },

  showOcrError(error, allowMock) {
    const mock = allowMock && error.mockFallback
    const message = error.message || '未知错误'
    wx.showModal({
      title: error.title || '识别失败',
      content: mock ? `${message}\n\n已载入样例数据，可先验证校对流程。` : message,
      showCancel: false,
      success: () => {
        if (mock) this.openMockReview()
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

  openReview(payload) {
    getApp().globalData.pendingReview = Object.assign({
      replaceId: this.data.replaceId,
      format: this.data.format,
      imagePath: this.data.imagePath,
      imagePaths: this.data.imagePaths
    }, payload)
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
      // 压缩共用同一个 canvas，并发识别时必须排队
      const task = (this.canvasQueue || Promise.resolve()).then(() => this.compressByCanvas(path, 4 * 1024 * 1024))
      this.canvasQueue = task.catch(() => null)
      return task
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
      format: this.data.format,
      imagePath: this.data.imagePath,
      imagePaths: this.data.imagePaths,
      manual: true
    }
    wx.navigateTo({ url: '/pages/review/review?manual=1' })
  },

  openMockReview() {
    getApp().globalData.pendingReview = {
      replaceId: this.data.replaceId,
      format: 'thai',
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
