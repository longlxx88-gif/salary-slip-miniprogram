const crypto = require('crypto')
const https = require('https')
const cloud = require('wx-server-sdk')

const OCR_HOST = 'ocr.tencentcloudapi.com'
const OCR_SERVICE = 'ocr'
const OCR_VERSION = '2018-11-19'
const OCR_ACTION = 'RecognizeTableAccurateOCR'
const AZURE_API_VERSION = process.env.AZURE_DOCUMENT_INTELLIGENCE_API_VERSION || '2024-11-30'
const UPLOAD_URL_MAX_BASE64 = 9 * 1024 * 1024
const OCR_RESULT_COLLECTION = 'ocr_results'
const INLINE_RESULT_MAX_BYTES = 40 * 1024
const INLINE_TABLE_CELLS_MAX = 50

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

function mockResult() {
  return {
    ok: true,
    mock: true,
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

function sha256(message) {
  return crypto.createHash('sha256').update(message, 'utf8').digest('hex')
}

function hmac(key, message, encoding) {
  return crypto.createHmac('sha256', key).update(message, 'utf8').digest(encoding)
}

function formatDate(timestamp) {
  return new Date(timestamp * 1000).toISOString().slice(0, 10)
}

function buildAuthorization({ secretId, secretKey, timestamp, payload }) {
  const algorithm = 'TC3-HMAC-SHA256'
  const date = formatDate(timestamp)
  const credentialScope = `${date}/${OCR_SERVICE}/tc3_request`
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${OCR_HOST}\nx-tc-action:${OCR_ACTION.toLowerCase()}\n`
  const signedHeaders = 'content-type;host;x-tc-action'
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    sha256(payload)
  ].join('\n')
  const stringToSign = [
    algorithm,
    timestamp,
    credentialScope,
    sha256(canonicalRequest)
  ].join('\n')
  const secretDate = hmac(`TC3${secretKey}`, date)
  const secretService = hmac(secretDate, OCR_SERVICE)
  const secretSigning = hmac(secretService, 'tc3_request')
  const signature = hmac(secretSigning, stringToSign, 'hex')

  return `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}

function postTencentOcr({ secretId, secretKey, region, imageBase64, imageUrl }) {
  const payloadBody = imageUrl
    ? { ImageUrl: imageUrl, UseNewModel: false }
    : { ImageBase64: imageBase64, UseNewModel: false }
  const payload = JSON.stringify(payloadBody)
  const timestamp = Math.floor(Date.now() / 1000)
  const authorization = buildAuthorization({ secretId, secretKey, timestamp, payload })

  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: OCR_HOST,
      method: 'POST',
      path: '/',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json; charset=utf-8',
        Host: OCR_HOST,
        'X-TC-Action': OCR_ACTION,
        'X-TC-Version': OCR_VERSION,
        'X-TC-Timestamp': String(timestamp),
        'X-TC-Region': region
      },
      timeout: 20000
    }, response => {
      let data = ''
      response.setEncoding('utf8')
      response.on('data', chunk => {
        data += chunk
      })
      response.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (parsed.Response && parsed.Response.Error) {
            reject(new Error(`${parsed.Response.Error.Code}: ${parsed.Response.Error.Message}`))
            return
          }
          resolve(parsed.Response || parsed)
        } catch (error) {
          reject(new Error(`OCR 返回解析失败: ${data.slice(0, 300)}`))
        }
      })
    })

    request.on('timeout', () => {
      request.destroy(new Error('腾讯云 OCR 请求超时'))
    })
    request.on('error', reject)
    request.write(payload)
    request.end()
  })
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function requestJson(options, body) {
  return new Promise((resolve, reject) => {
    const request = https.request(Object.assign({ timeout: 30000 }, options), response => {
      let data = ''
      response.setEncoding('utf8')
      response.on('data', chunk => {
        data += chunk
      })
      response.on('end', () => {
        let parsed = {}
        if (data) {
          try {
            parsed = JSON.parse(data)
          } catch (error) {
            reject(new Error(`OCR 返回解析失败: ${data.slice(0, 300)}`))
            return
          }
        }
        if (response.statusCode >= 400) {
          const message = (parsed.error && (parsed.error.message || parsed.error.code)) || data.slice(0, 300)
          reject(new Error(`HTTP ${response.statusCode}: ${message}`))
          return
        }
        resolve({ statusCode: response.statusCode, headers: response.headers, data: parsed })
      })
    })

    request.on('timeout', () => {
      request.destroy(new Error('OCR 请求超时'))
    })
    request.on('error', reject)
    if (body) request.write(body)
    request.end()
  })
}

function buildAzureAnalyzeUrl(endpoint) {
  const base = endpoint.replace(/\/+$/, '')
  return new URL(`${base}/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=${AZURE_API_VERSION}`)
}

async function postAzureLayout({ endpoint, key, imageUrl }) {
  if (!imageUrl) throw new Error('Azure Layout OCR 需要图片 URL')

  const analyzeUrl = buildAzureAnalyzeUrl(endpoint)
  const body = JSON.stringify({ urlSource: imageUrl })
  const started = await requestJson({
    hostname: analyzeUrl.hostname,
    method: 'POST',
    path: `${analyzeUrl.pathname}${analyzeUrl.search}`,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Ocp-Apim-Subscription-Key': key
    }
  }, body)

  const operationLocation = started.headers['operation-location']
  if (!operationLocation) throw new Error('Azure Layout OCR 未返回 operation-location')

  const operationUrl = new URL(operationLocation)
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await sleep(attempt < 3 ? 800 : 1200)
    const poll = await requestJson({
      hostname: operationUrl.hostname,
      method: 'GET',
      path: `${operationUrl.pathname}${operationUrl.search}`,
      headers: {
        'Ocp-Apim-Subscription-Key': key
      }
    })

    const status = poll.data.status
    if (status === 'succeeded') return poll.data
    if (status === 'failed') {
      const error = poll.data.error || {}
      throw new Error(`Azure Layout OCR 失败: ${error.message || error.code || 'unknown error'}`)
    }
  }

  throw new Error('Azure Layout OCR 轮询超时')
}

function readPoint(detection, index) {
  const polygon = detection.Polygon || detection.ItemPolygon || {}
  const coords = Array.isArray(polygon)
    ? polygon
    : (polygon.Coordinates || detection.Coord || [])
  if (Array.isArray(coords) && coords.length) {
    return {
      x: Number(coords[0].X || coords[0].x || 0),
      y: Number(coords[0].Y || coords[0].y || index * 24)
    }
  }
  return { x: 0, y: index * 24 }
}

function readBox(detection) {
  const box = detection.ItemPolygon || {}
  return {
    width: Number(box.Width || box.width || 0),
    height: Number(box.Height || box.height || 0)
  }
}

function normalizeWords(words) {
  if (!Array.isArray(words)) return []
  return words.map(word => ({
    text: word.Character || word.DetectedText || word.Text || '',
    confidence: Number(word.Confidence || 0)
  }))
}

function normalizeDetection(detection, index) {
  const point = readPoint(detection, index)
  const confidence = detection.Confidence ? [detection.Confidence] : []
  const box = readBox(detection)
  const words = normalizeWords(detection.Words)

  return {
    text: detection.DetectedText || detection.Text || '',
    x: point.x,
    y: point.y,
    width: box.width,
    height: box.height,
    confidences: words.length ? words.map(word => word.confidence) : confidence,
    words
  }
}

function readCellText(cell) {
  return String(cell.Text || cell.DetectedText || cell.Word || '').trim()
}

function readCellPoint(cell, index) {
  const polygon = cell.Polygon || cell.ItemPolygon || []
  const coords = Array.isArray(polygon)
    ? polygon
    : (polygon.Coordinates || cell.Coord || [])

  if (Array.isArray(coords) && coords.length) {
    return {
      x: Number(coords[0].X || coords[0].x || 0),
      y: Number(coords[0].Y || coords[0].y || index * 24)
    }
  }

  return {
    x: Number(cell.ColTl || cell.Column || cell.Col || 0) * 80,
    y: Number(cell.RowTl || cell.Row || 0) * 28
  }
}

function normalizeCell(cell, index) {
  const point = readCellPoint(cell, index)
  const row = Number(cell.RowTl || cell.Row || 0)
  const col = Number(cell.ColTl || cell.Column || cell.Col || 0)
  const rowSpan = Number(cell.RowBr || row)
  const colSpan = Number(cell.ColBr || col)
  const confidence = Number(cell.Confidence || 0)

  return {
    text: readCellText(cell),
    x: point.x,
    y: point.y,
    width: Math.max(0, colSpan - col + 1) * 80,
    height: Math.max(0, rowSpan - row + 1) * 28,
    row,
    col,
    rowSpan,
    colSpan,
    confidences: confidence ? [confidence] : [],
    confidence
  }
}

function normalizeTableResponse(response) {
  const tables = response.TableDetections || []
  const tableCells = []

  tables.forEach((table, tableIndex) => {
    const cells = table.Cells || []
    cells.forEach((cell, cellIndex) => {
      const normalized = normalizeCell(cell, tableCells.length)
      if (normalized.text) {
        tableCells.push(Object.assign({ tableIndex, cellIndex }, normalized))
      }
    })
  })

  tableCells.sort((a, b) => a.row - b.row || a.col - b.col || a.y - b.y || a.x - b.x)

  return {
    tables: tables.length,
    tableCells,
    items: tableCells.map((cell, index) => ({
      id: `cell_${cell.tableIndex}_${cell.cellIndex}_${index}`,
      text: cell.text,
      x: cell.x,
      y: cell.y,
      width: cell.width,
      height: cell.height,
      wordConfidence: cell.confidences,
      confidences: cell.confidences,
      row: cell.row,
      col: cell.col
    }))
  }
}

function resultSize(result) {
  return Buffer.byteLength(JSON.stringify(result), 'utf8')
}

function shouldReturnInline(result) {
  const totalCells = Array.isArray(result.tableCells) ? result.tableCells.length : 0
  return totalCells <= INLINE_TABLE_CELLS_MAX && resultSize(result) <= INLINE_RESULT_MAX_BYTES
}

function resultSummary(result, recordId, stored, inline) {
  const totalCells = Array.isArray(result.tableCells) ? result.tableCells.length : 0
  return {
    ok: result.ok !== false,
    mock: Boolean(result.mock),
    provider: result.provider || '',
    requestId: result.requestId || '',
    action: result.action || '',
    tables: result.tables || 0,
    totalCells,
    recordId: recordId || '',
    stored: Boolean(stored),
    truncated: !inline,
    message: inline ? '' : 'OCR 结果较大，已保存完整结果，请通过 recordId 查询'
  }
}

async function saveOcrResult(result) {
  const wxContext = cloud.getWXContext()
  const totalCells = Array.isArray(result.tableCells) ? result.tableCells.length : 0
  const addResult = await db.collection(OCR_RESULT_COLLECTION).add({
    data: {
      ownerOpenId: wxContext.OPENID || '',
      provider: result.provider || '',
      requestId: result.requestId || '',
      action: result.action || '',
      tables: result.tables || 0,
      totalCells,
      result,
      createdAt: db.serverDate()
    }
  })

  return addResult._id
}

async function persistAndShapeResult(result) {
  if (result.mock || result.ok === false) return result

  try {
    const recordId = await saveOcrResult(result)
    const inline = shouldReturnInline(result)
    if (inline) {
      return Object.assign({}, result, {
        recordId,
        stored: true,
        truncated: false,
        totalCells: Array.isArray(result.tableCells) ? result.tableCells.length : 0
      })
    }

    return resultSummary(result, recordId, true, false)
  } catch (error) {
    console.warn('[OCR] save result failed:', error)
    return Object.assign({}, result, {
      stored: false,
      truncated: false,
      storeError: error.message || String(error)
    })
  }
}

async function getStoredResult(recordId) {
  if (!recordId) {
    return {
      ok: false,
      error: '缺少 OCR 结果 recordId'
    }
  }

  const record = await db.collection(OCR_RESULT_COLLECTION).doc(recordId).get()
  if (!record || !record.data || !record.data.result) {
    return {
      ok: false,
      error: '未找到 OCR 结果'
    }
  }

  const wxContext = cloud.getWXContext()
  if (record.data.ownerOpenId && record.data.ownerOpenId !== wxContext.OPENID) {
    return {
      ok: false,
      error: '无权读取该 OCR 结果'
    }
  }

  return Object.assign({}, record.data.result, {
    recordId,
    stored: true,
    truncated: false
  })
}

function pointListToBox(polygon) {
  if (!Array.isArray(polygon) || !polygon.length) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }

  const points = typeof polygon[0] === 'number'
    ? polygon.reduce((list, value, index) => {
      if (index % 2 === 0) list.push({ x: Number(value || 0), y: Number(polygon[index + 1] || 0) })
      return list
    }, [])
    : polygon.map(point => ({ x: Number(point.x || 0), y: Number(point.y || 0) }))

  const xs = points.map(point => point.x)
  const ys = points.map(point => point.y)
  const minX = Math.min.apply(null, xs)
  const minY = Math.min.apply(null, ys)
  const maxX = Math.max.apply(null, xs)
  const maxY = Math.max.apply(null, ys)
  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY)
  }
}

function normalizeAzureResponse(response) {
  const result = response.analyzeResult || {}
  const tables = result.tables || []
  const tableCells = []

  tables.forEach((table, tableIndex) => {
    const cells = table.cells || []
    cells.forEach((cell, cellIndex) => {
      const text = String(cell.content || '').trim()
      if (!text) return
      const region = cell.boundingRegions && cell.boundingRegions[0]
      const box = pointListToBox(region && region.polygon)
      tableCells.push({
        tableIndex,
        cellIndex,
        text,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        row: Number(cell.rowIndex || 0),
        col: Number(cell.columnIndex || 0),
        rowSpan: Number(cell.rowSpan || 1),
        colSpan: Number(cell.columnSpan || 1),
        confidences: cell.confidence ? [Number(cell.confidence) * 100] : [],
        confidence: cell.confidence ? Number(cell.confidence) * 100 : 0
      })
    })
  })

  tableCells.sort((a, b) => a.row - b.row || a.col - b.col || a.y - b.y || a.x - b.x)

  return {
    tables: tables.length,
    tableCells,
    items: tableCells.map((cell, index) => ({
      id: `azure_cell_${cell.tableIndex}_${cell.cellIndex}_${index}`,
      text: cell.text,
      x: cell.x,
      y: cell.y,
      width: cell.width,
      height: cell.height,
      wordConfidence: cell.confidences,
      confidences: cell.confidences,
      row: cell.row,
      col: cell.col,
      rowSpan: cell.rowSpan,
      colSpan: cell.colSpan
    }))
  }
}

exports.main = async event => {
  try {
    if (event.action === 'getResult') {
      return getStoredResult(event.recordId)
    }

    const imageBase64 = event.imageBase64
    const imageUrl = event.imageUrl

    if (event.mock || (!imageBase64 && !imageUrl)) return mockResult()

    if (imageBase64 && imageBase64.length > UPLOAD_URL_MAX_BASE64) {
      return {
        ok: false,
        error: '图片体积过大，请压缩或裁剪后重试'
      }
    }

    const azureEndpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT
    const azureKey = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY
    const secretId = process.env.TENCENT_SECRET_ID
    const secretKey = process.env.TENCENT_SECRET_KEY
    const region = process.env.TENCENT_REGION || 'ap-guangzhou'

    console.log('[OCR] azure exists:', Boolean(azureEndpoint && azureKey))
    console.log('[OCR] secretId exists:', Boolean(secretId))
    console.log('[OCR] secretKey exists:', Boolean(secretKey))
    console.log('[OCR] region:', region)

    if (azureEndpoint && azureKey && imageUrl) {
      const response = await postAzureLayout({ endpoint: azureEndpoint, key: azureKey, imageUrl })
      return persistAndShapeResult({
        ok: true,
        mock: false,
        provider: 'azure-layout',
        action: 'prebuilt-layout',
        ...normalizeAzureResponse(response)
      })
    }

    if (!secretId || !secretKey) return mockResult()

    const response = await postTencentOcr({ secretId, secretKey, region, imageBase64, imageUrl })

    return persistAndShapeResult({
      ok: true,
      mock: false,
      provider: 'tencent-table',
      requestId: response.RequestId,
      action: OCR_ACTION,
      ...normalizeTableResponse(response)
    })
  } catch (error) {
    console.error('[OCR] failed:', error)
    return {
      ok: false,
      error: error.message || String(error)
    }
  }
}
