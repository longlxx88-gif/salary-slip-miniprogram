// 列表式工资条解析引擎（国内公司及界面新增的公司共用，由 config 驱动）。
// 国内公司：手机 App“我的薪资”多页截图，左侧标签、右侧数值，满屏斜向水印；
// OCR 走腾讯通用文字识别 + 表格识别（ocr 云函数 mode: 'cn'），按同一行配对标签与数值。

const CN_TEMPLATE_ORDER = {
  income: [
    '出勤基本工资(月薪)',
    '出勤加班费及补助(月薪)',
    '餐补',
    '假日加班工资',
    '超限加班费(月薪)',
    '病假工资',
    '产假工资',
    '工伤工资',
    '职务津贴',
    '特殊津贴',
    '绩效奖金',
    '夜班补贴',
    '行政奖励',
    '女性奖',
    '其它补给',
    '补发(+)补扣(-)',
    '推荐费',
    '入职奖励',
    '其它奖金',
    '盈利奖',
    '出差补贴',
    '利是',
    '应发工资合计'
  ],
  deduct: [
    '扣个人养老保险',
    '扣个人失业保险',
    '扣个人医疗保险',
    '扣个人大病保险',
    '扣个人住房公积金',
    '扣预支',
    '扣水电',
    '扣爱心基金',
    '扣个人用品',
    '其他税后扣除项',
    '扣个人所得税'
  ],
  total: [
    '实发工资合计'
  ],
  // 计税应发工资合计 = 应发工资合计 + 合并扣税额（已领现金，只计税、不从实发中扣）
  tax: [
    '合并扣税额(已领现金，仅扣税)',
    '计税应发工资合计'
  ],
  info: [
    '基本工资标准',
    '加班费及补助标准',
    '餐补标准',
    '应出勤天数',
    '实出勤天数D',
    '平日迟到/早退分钟',
    '假日迟到/早退分钟',
    '假日加班工时H',
    '超限平时加班工时合计H',
    '超限周末加班工时合计H',
    '病假工时H',
    '产假天数D',
    '工伤天数D'
  ]
}

const GROUPS = ['income', 'tax', 'deduct', 'total', 'info']
const GROSS_NAME = '应发工资合计'
const NET_NAME = '实发工资合计'
const MAX_TEXT_ANGLE = 10
// 实测：正常金额置信度多为 95～100（个别 0.00 为 82～83），误读（如 ￥0.00、净含量:）为 57～75
const MIN_VALUE_CONFIDENCE = 80
const BALANCE_TOLERANCE = 0.02

// 引擎配置：
// order          内置字段顺序（各组），总会合并进模板
// gross / net    应发、实发字段名；deductTotal 扣除合计字段名（可选）
// taxable / combinedTax  计税应发、合并扣税额字段名（可选）
// checks         启用的校验公式：income 收入合计 = 应发；net 应发 − 扣除 = 实发；taxable 应发 + 合并扣税额 = 计税应发
// skipLabels     不作为工资项目的标签
// labelMaxXRatio 标签只出现在页面宽度的这个比例以内（列表截图为 0.4，表格为 1）
// strictDecimals 金额必须带两位小数（列表截图用于排除水印数字）
// guessGroups    模板外字段按名称猜分组（新增公司模板还不完整时用）；否则一律归入参考信息
const DEFAULT_CONFIG = {
  id: '',
  order: { income: [], tax: [], deduct: [], total: [], info: [] },
  gross: '',
  net: '',
  deductTotal: '',
  taxable: '',
  combinedTax: '',
  checks: { income: true, net: true, taxable: true },
  skipLabels: [],
  labelMaxXRatio: 1,
  strictDecimals: false,
  guessGroups: false
}

// 按字段名猜分组：实发 → 实发；计税 → 计税；扣款/税/保险/公积金 → 扣除；天数/工时/标准等 → 参考信息；其余 → 收入
function guessGroup(name) {
  if (/实发/.test(name)) return 'total'
  if (/计税|合并扣税/.test(name)) return 'tax'
  if (/^扣|扣款|扣除|扣项|所得税|个税|保险|公积金|社保/.test(name)) return 'deduct'
  if (/天数|工时|小时|分钟|标准|日期|等级|次数/.test(name)) return 'info'
  return 'income'
}

const CN_CONFIG = {
  id: 'cn',
  order: CN_TEMPLATE_ORDER,
  gross: GROSS_NAME,
  net: NET_NAME,
  deductTotal: '',
  taxable: '计税应发工资合计',
  combinedTax: '合并扣税额(已领现金，仅扣税)',
  checks: { income: true, net: true, taxable: true },
  skipLabels: ['期间', '入职日期', '绩效等级', '我的薪资', '上滑翻页'],
  labelMaxXRatio: 0.4,
  strictDecimals: true
}

function resolveConfig(config) {
  const merged = Object.assign({}, DEFAULT_CONFIG, config || CN_CONFIG)
  merged.order = Object.assign({}, DEFAULT_CONFIG.order, merged.order)
  merged.checks = Object.assign({}, DEFAULT_CONFIG.checks, merged.checks)
  return merged
}

function currentMonth() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function isBlankAmount(amount) {
  return amount === '' || amount === null || amount === undefined
}

function round2(value) {
  const result = Number(Number(value).toFixed(2))
  return result === 0 ? 0 : result
}

// 匹配用的规范化：去空白、统一全角括号/逗号、“其他/其它”视为相同
function labelKey(name) {
  return String(name || '')
    .replace(/\s/g, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/，/g, ',')
    .replace(/其他/g, '其它')
    .toUpperCase()
}

function looseKey(name) {
  return labelKey(name).replace(/[HD]$/, '')
}

// 字段名里不含数字；OCR 偶尔把水印 LY514857 的碎片粘到标签上（如“基本工资标准857”）
function cleanLabel(text) {
  return String(text || '').replace(/\s/g, '').replace(/LY/gi, '').replace(/\d+/g, '')
}

function hasChinese(text) {
  return /[一-龥]/.test(text)
}

// OCR 会给孤立的 0.00 前面加上货币符号（￥0.00），先去掉。
// strictDecimals 时金额必须带两位小数：水印碎片（LY514857、514857 等）没有小数点，天然被排除
function parseValue(text, config) {
  const normalized = String(text || '').replace(/\s/g, '').replace(/[，,￥¥$฿₫]/g, '')
  const pattern = config && config.strictDecimals === false ? /^-?\d+(\.\d{1,2})?$/ : /^-?\d+\.\d{2}$/
  if (!pattern.test(normalized)) return null
  return Number(normalized)
}

function parseMonth(text) {
  const match = String(text || '').replace(/\s/g, '').match(/^(20\d{2})[-–—~/.](\d{1,2})$/)
  if (!match) return ''
  const month = Number(match[2])
  if (month < 1 || month > 12) return ''
  return `${match[1]}-${String(month).padStart(2, '0')}`
}

function lineAngle(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 2) return 0
  const x0 = Number(polygon[0].X !== undefined ? polygon[0].X : polygon[0].x)
  const y0 = Number(polygon[0].Y !== undefined ? polygon[0].Y : polygon[0].y)
  const x1 = Number(polygon[1].X !== undefined ? polygon[1].X : polygon[1].x)
  const y1 = Number(polygon[1].Y !== undefined ? polygon[1].Y : polygon[1].y)
  if (![x0, y0, x1, y1].every(Number.isFinite)) return 0
  return Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI
}

// 置信度为 0～100；缺失时视为可信（100）
function averageConfidence(item) {
  const values = (item.confidences || item.wordConfidence || []).map(Number).filter(Number.isFinite)
  if (!values.length) return Number.isFinite(Number(item.confidence)) && item.confidence !== undefined ? Number(item.confidence) : 100
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function normalizeLines(rawResult) {
  const list = (rawResult && (rawResult.lines || rawResult.items)) || []
  return list.map(item => ({
    text: String(item.text || item.DetectedText || '').trim(),
    x: Number(item.x || 0),
    y: Number(item.y || 0),
    width: Number(item.width || 0),
    height: Number(item.height || 0),
    angle: lineAngle(item.polygon),
    confidence: averageConfidence(item)
  }))
    // 斜向的是水印，正文都是水平的
    .filter(line => line.text && Math.abs(line.angle) <= MAX_TEXT_ANGLE)
}

function centerY(line) {
  return line.y + line.height / 2
}

function isSkipped(name, config) {
  return !hasChinese(name) || config.skipLabels.indexOf(name) >= 0
}

// 解析单页：通用识别（文本行）与表格识别（单元格）各自配对，再按字段名合并互补。
// 返回 { month, pairs: [{ name, amount|null, conflict?: [a, b] }] }
function parsePage(rawResult, config) {
  const resolved = resolveConfig(config)
  const general = pairLines(normalizeLines(rawResult), resolved)
  const table = pairTableCells((rawResult && rawResult.tableCells) || [], resolved)
  return {
    month: general.month || table.month,
    pairs: combinePairs(general.pairs, table.pairs)
  }
}

// 一行里可能有多组“标签 | 金额”（如 标签 | 金额 | 标签 | 金额），每个标签取其后、下一个标签前的第一个金额
function pairTableCells(cells, config) {
  const rows = {}
  let month = ''
  cells
    .filter(cell => Number(cell.row) >= 0 && cell.text)
    .forEach(cell => {
      const row = String(cell.row)
      rows[row] = (rows[row] || []).concat(cell)
    })

  const pairs = []
  Object.keys(rows)
    .sort((a, b) => Number(a) - Number(b))
    .forEach(row => {
      const cellsInRow = rows[row].slice().sort((a, b) => Number(a.col) - Number(b.col))
      const texts = cellsInRow.map(cell => String(cell.text).trim())
      texts.forEach(text => {
        if (!month) month = parseMonth(text)
      })
      texts.forEach((text, index) => {
        if (!hasChinese(text)) return
        const name = cleanLabel(text)
        if (isSkipped(name, config)) return
        let valueCell = null
        for (let next = index + 1; next < texts.length; next += 1) {
          if (hasChinese(texts[next])) break
          if (parseValue(texts[next], config) !== null) {
            valueCell = cellsInRow[next]
            break
          }
        }
        pairs.push({
          name,
          amount: valueCell ? parseValue(valueCell.text, config) : null,
          lowConfidence: Boolean(valueCell && averageConfidence(valueCell) < MIN_VALUE_CONFIDENCE)
        })
      })
    })
  return { month, pairs }
}

function combinePairs(primary, secondary) {
  const result = primary.map(pair => Object.assign({}, pair))
  secondary.forEach(pair => {
    const target = result.find(item => labelKey(item.name) === labelKey(pair.name))
    if (!target) {
      result.push(Object.assign({}, pair))
      return
    }
    if (pair.amount === null) return
    if (target.amount === null) {
      target.amount = pair.amount
      target.lowConfidence = pair.lowConfidence
      return
    }
    if (Math.abs(target.amount - pair.amount) > 0.001) {
      target.conflict = [target.amount, pair.amount]
      return
    }
    // 两种识别结果一致时，可以认为可信
    target.lowConfidence = target.lowConfidence && pair.lowConfidence
  })
  return result
}

function pairLines(lines, config) {
  let month = ''
  const values = []
  const labels = []
  // 列表截图的字段名都在左侧；右侧金额列偶尔被 OCR 读成“净含量:”“发票专用章”之类的文字，不能当字段名
  const pageRight = lines.reduce((max, line) => Math.max(max, line.x + line.width), 0)
  const labelMaxX = pageRight * config.labelMaxXRatio

  lines.forEach(line => {
    const lineMonth = parseMonth(line.text)
    if (lineMonth) {
      if (!month) month = lineMonth
      return
    }
    const amount = parseValue(line.text, config)
    if (amount !== null) {
      values.push(Object.assign({ amount, used: false }, line))
      return
    }
    if (hasChinese(line.text) && line.x < labelMaxX) labels.push(line)
  })

  const pairs = []
  labels
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .forEach(label => {
      const name = cleanLabel(label.text)
      if (isSkipped(name, config)) return
      const value = values
        .filter(candidate => !candidate.used && candidate.x > label.x)
        .map(candidate => ({ candidate, diff: Math.abs(centerY(candidate) - centerY(label)), gap: candidate.x - label.x }))
        .filter(entry => entry.diff <= Math.max(label.height, entry.candidate.height, 20) * 0.6)
        .sort((a, b) => a.diff - b.diff || a.gap - b.gap)[0]

      if (value) value.candidate.used = true
      pairs.push({
        name,
        amount: value ? value.candidate.amount : null,
        // OCR 拿不准时会“脑补”出截图上没有的字符（如 ￥0.00），这类金额必须人工确认
        lowConfidence: Boolean(value && value.candidate.confidence < MIN_VALUE_CONFIDENCE)
      })
    })

  return { month, pairs }
}

function templateEntries(template) {
  const entries = []
  GROUPS.forEach(group => {
    ;((template && template[group]) || []).forEach(name => entries.push({ name, group }))
  })
  return entries
}

function matchName(name, template) {
  const entries = templateEntries(template)
  const key = labelKey(name)
  const exact = entries.find(entry => labelKey(entry.name) === key)
  if (exact) return exact
  // OCR 偶尔丢掉末尾单位字母（H/D），只在结果唯一时才认
  const loose = entries.filter(entry => looseKey(entry.name) === looseKey(name))
  if (loose.length === 1) return loose[0]
  // 标签被截断（如“平日迟到/早退”）：唯一前缀匹配时才认，并标记待核对
  if (key.length >= 3) {
    const prefixed = entries.filter(entry => labelKey(entry.name).indexOf(key) === 0)
    if (prefixed.length === 1) return Object.assign({ partial: true }, prefixed[0])
  }
  return null
}

function itemId(group, name) {
  return `${group}_${labelKey(name)}`
}

function mostCommon(list) {
  const counts = {}
  list.forEach(value => {
    counts[value] = (counts[value] || 0) + 1
  })
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || ''
}

function mergePages(pages, template, config) {
  const merged = {}
  const order = []

  pages.forEach(page => {
    const pageKeys = []
    page.pairs.forEach(pair => {
      let match = matchName(pair.name, template)
      let suspect = false
      // 同一页里两个标签匹配到同一字段，说明后一个是 OCR 读错的标签（如“餐补标准”读成“基本工资标准”）
      if (match && pageKeys.indexOf(labelKey(match.name)) >= 0) {
        match = null
        suspect = true
      }
      // 模板外、又没有金额的文字（姓名、部门、页面标题等）没有价值，直接忽略
      if (!match && !suspect && pair.amount === null) return
      const name = match ? match.name : (suspect ? `${pair.name}（待核对）` : pair.name)
      // 模板外字段：新增公司按名称猜分组；国内公司默认归入参考信息，避免误识别的杂项污染收入合计
      const fallbackGroup = config && config.guessGroups ? guessGroup(pair.name) : (pair.name.indexOf('扣') === 0 ? 'deduct' : 'info')
      const group = match ? match.group : fallbackGroup
      const key = labelKey(name)
      pageKeys.push(key)
      const existing = merged[key]

      if (!existing) {
        merged[key] = {
          name,
          group,
          amount: pair.amount,
          unknown: !match && !suspect,
          suspect,
          partial: Boolean(match && match.partial),
          conflict: Boolean(pair.conflict),
          conflictValues: pair.conflict || null,
          lowConfidence: Boolean(pair.lowConfidence)
        }
        order.push(key)
        return
      }
      if (pair.conflict) existing.conflict = true
      if (existing.amount === null) {
        existing.amount = pair.amount
        existing.lowConfidence = Boolean(pair.lowConfidence)
        return
      }
      if (pair.amount !== null && Math.abs(existing.amount - pair.amount) > 0.001) existing.conflict = true
    })
  })

  return order.map(key => {
    const entry = merged[key]
    let note = ''
    if (entry.suspect) note = '字段名识别异常（与本页其他字段重名），请对照截图改成正确的字段名'
    else if (entry.unknown) note = '新字段：请确认字段名、分组和金额，保存后自动加入模板'
    else if (entry.partial) note = `字段名识别不完整，已按“${entry.name}”匹配，请核对`
    else if (entry.conflictValues) note = `两种识别结果不一致（${entry.conflictValues.join(' / ')}），请对照截图核对`
    else if (entry.conflict) note = '多张截图识别结果不一致，请核对'
    else if (entry.amount === null) note = '未识别到金额，请对照截图填写'
    else if (entry.lowConfidence) note = '识别置信度较低，请对照截图核对'
    // 考勤/参考信息不计入金额、也无法用公式验证，未识别或低置信度时只留空/保留，不阻止保存
    const softInfo = entry.group === 'info' && (entry.amount === null || entry.lowConfidence) && !entry.conflict
    const pending = Boolean(note) && !softInfo
    return {
      id: itemId(entry.group, entry.name),
      name: entry.name,
      amount: entry.amount === null ? '' : entry.amount,
      group: entry.group,
      // 金额未识别 / 置信度低：可以由公式校验证明（见 settleByFormula）
      uncertain: entry.amount === null || (entry.lowConfidence && !entry.conflict),
      // 模板外的字段：校对页可以改分组，保存后写入模板
      isNew: entry.unknown || entry.suspect,
      note: pending ? note : '',
      pending,
      confirmed: !pending,
      temporary: false
    }
  })
}

function createBlankItem(group, name) {
  return {
    id: itemId(group, name),
    name,
    amount: '',
    group,
    note: '',
    pending: false,
    confirmed: true,
    temporary: false
  }
}

function uniqueByKey(names) {
  const keys = []
  return (names || []).filter(name => {
    const key = labelKey(name)
    if (!name || keys.indexOf(key) >= 0) return false
    keys.push(key)
    return true
  })
}

function getOrderedTemplate(template, config) {
  const resolved = resolveConfig(config)
  // 内置字段以 order 的分组为准（旧模板里国内计税两项在 info 组，需迁到 tax 组）
  const builtinGroup = {}
  GROUPS.forEach(group => {
    resolved.order[group].forEach(name => {
      builtinGroup[labelKey(name)] = group
    })
  })
  const result = {}
  GROUPS.forEach(group => {
    const saved = ((template && template[group]) || []).filter(name => {
      const owner = builtinGroup[labelKey(name)]
      return !owner || owner === group
    })
    result[group] = uniqueByKey(resolved.order[group].concat(saved))
  })
  return result
}

// 按模板顺序补齐所有字段（未识别的留空），模板外字段排在各组末尾
function completeItems(items, template) {
  const byKey = {}
  const extras = []
  ;(items || []).forEach(item => {
    const key = `${item.group}_${labelKey(item.name)}`
    if (byKey[key]) return
    byKey[key] = item
    extras.push(key)
  })

  const result = []
  GROUPS.forEach(group => {
    ;((template && template[group]) || []).forEach(name => {
      const key = `${group}_${labelKey(name)}`
      result.push(byKey[key] || createBlankItem(group, name))
      delete byKey[key]
    })
    extras
      .filter(key => byKey[key] && byKey[key].group === group)
      .forEach(key => {
        result.push(byKey[key])
        delete byKey[key]
      })
  })
  Object.keys(byKey).forEach(key => result.push(byKey[key]))
  return result
}

function findItem(items, name) {
  if (!name) return null
  const key = labelKey(name)
  return items.find(item => labelKey(item.name) === key) || null
}

function amountOf(items, name) {
  const item = findItem(items, name)
  return item && !isBlankAmount(item.amount) ? Number(item.amount) : null
}

function sumAmounts(items) {
  return items.reduce((sum, item) => sum + Number(item.amount || 0), 0)
}

function sameName(a, b) {
  return Boolean(a && b) && labelKey(a) === labelKey(b)
}

function incomeDetails(items, config) {
  return items.filter(item => item.group === 'income' && !sameName(item.name, config.gross))
}

function deductItems(items, config) {
  return items.filter(item => item.group === 'deduct' && !sameName(item.name, config.deductTotal))
}

// 扣除总额：有“扣除合计”字段时取它，否则由 应发 − 实发 得出
function deductTarget(items, config) {
  const total = amountOf(items, config.deductTotal)
  if (total !== null) return total
  const gross = amountOf(items, config.gross)
  const net = amountOf(items, config.net)
  return gross !== null && net !== null ? gross - net : null
}

function setPending(item, note) {
  item.note = note
  item.pending = true
  item.confirmed = false
}

function clearPending(item) {
  item.note = ''
  item.pending = false
  item.confirmed = true
}

// 用公式处理不确定项（未识别 / 低置信度 / 整页漏传的空白）：
// 1. 不确定项按识别值（空白按 0）计算后公式恰好平衡 → 证明这些值正确，自动采用、无需确认；
// 2. 不平衡且只有一个空白不确定项 → 反推该项，标记待确认；
// 3. 其余情况 → 保持待确认，并提示这些项的合计应为多少。
// 组内有其他异常（重名、两种识别冲突、模板外字段）时不自动采用。
function settleByFormula(items, config) {
  const resolved = resolveConfig(config)
  const gross = amountOf(items, resolved.gross)

  const settle = (list, total, groupName) => {
    const isUncertain = item => item.uncertain || (isBlankAmount(item.amount) && !item.pending)
    const unsure = list.filter(isUncertain)
    if (!unsure.length) return
    const blocked = list.some(item => item.pending && !isUncertain(item))
    const residual = round2(total - sumAmounts(list))

    if (!blocked && Math.abs(residual) <= BALANCE_TOLERANCE) {
      unsure.forEach(item => {
        if (isBlankAmount(item.amount)) item.amount = 0
        clearPending(item)
      })
      return
    }

    const blanks = unsure.filter(item => isBlankAmount(item.amount))
    if (!blocked && unsure.length === 1 && blanks.length === 1) {
      // 反推值也可能是其他项误识别造成的，必须对照截图确认
      blanks[0].amount = residual
      setPending(blanks[0], `由公式反推，请对照截图核对；不一致说明其他${groupName}识别有误`)
      return
    }

    const expected = round2(residual + sumAmounts(unsure))
    unsure.forEach(item => {
      const hint = unsure.length > 1 ? `；按公式，这 ${unsure.length} 项合计应为 ${expected.toFixed(2)}` : `；按公式应为 ${expected.toFixed(2)}`
      setPending(item, `${isBlankAmount(item.amount) ? '未识别到金额，请对照截图填写' : '识别置信度较低，请对照截图核对'}${hint}`)
    })
  }

  if (resolved.checks.income && gross !== null) settle(incomeDetails(items, resolved), gross, '收入项')
  const target = deductTarget(items, resolved)
  if (resolved.checks.net && target !== null) settle(deductItems(items, resolved), target, '扣除项')
  if (resolved.checks.taxable) settleTaxable(items, gross, resolved)
  return items
}

// 计税应发 = 应发 + 合并扣税额：缺一项时反推（标记待确认），三项齐全且平衡时确认不确定项
function settleTaxable(items, gross, config) {
  const taxableItem = findItem(items, config.taxable)
  const combinedItem = findItem(items, config.combinedTax)
  if (!taxableItem || !combinedItem || gross === null) return
  const taxable = amountOf(items, config.taxable)
  const combined = amountOf(items, config.combinedTax)

  if (taxable !== null && combined !== null) {
    if (Math.abs(round2(gross + combined - taxable)) <= BALANCE_TOLERANCE) {
      ;[taxableItem, combinedItem].filter(item => item.uncertain).forEach(clearPending)
    }
    return
  }
  if (taxable !== null && combined === null) {
    combinedItem.amount = round2(taxable - gross)
    setPending(combinedItem, `由“${config.taxable} − ${config.gross}”反推，请对照截图核对`)
  } else if (taxable === null && combined !== null) {
    taxableItem.amount = round2(gross + combined)
    setPending(taxableItem, `由“${config.gross} + ${config.combinedTax}”反推，请对照截图核对`)
  }
}

function validate(items, config) {
  const resolved = resolveConfig(config)
  const gross = amountOf(items, resolved.gross)
  const net = amountOf(items, resolved.net)
  if (gross === null || net === null) {
    return { ok: true, message: '未识别到应发/实发合计，已跳过公式校验' }
  }

  const problems = []
  const passed = []
  if (resolved.checks.income) {
    const incomeDiff = round2(sumAmounts(incomeDetails(items, resolved)) - gross)
    if (Math.abs(incomeDiff) > BALANCE_TOLERANCE) problems.push(`收入各项合计与应发相差 ${incomeDiff.toFixed(2)}`)
    else passed.push('收入合计 = 应发')
  }
  if (resolved.checks.net) {
    const deductTotal = amountOf(items, resolved.deductTotal)
    const deductSum = sumAmounts(deductItems(items, resolved))
    if (deductTotal !== null) {
      const totalDiff = round2(deductSum - deductTotal)
      if (Math.abs(totalDiff) > BALANCE_TOLERANCE) problems.push(`扣除各项合计与扣除合计相差 ${totalDiff.toFixed(2)}`)
    }
    const netDiff = round2(gross - (deductTotal !== null ? deductTotal : deductSum) - net)
    if (Math.abs(netDiff) > BALANCE_TOLERANCE) problems.push(`应发 − 扣除 − 实发 相差 ${netDiff.toFixed(2)}`)
    else passed.push('应发 − 扣除 = 实发')
  }
  if (resolved.checks.taxable) {
    const taxable = amountOf(items, resolved.taxable)
    const combined = amountOf(items, resolved.combinedTax)
    if (taxable !== null && combined !== null) {
      const taxableDiff = round2(gross + combined - taxable)
      if (Math.abs(taxableDiff) > BALANCE_TOLERANCE) problems.push(`应发 + 合并扣税额 − 计税应发 相差 ${taxableDiff.toFixed(2)}`)
      else passed.push('应发 + 合并扣税额 = 计税应发')
    }
  }

  return {
    ok: !problems.length,
    message: problems.length
      ? problems.join('；')
      : (passed.length ? `金额校验通过（${passed.join('，')}）` : '未启用公式校验')
  }
}

// ocrResults：一张或多张图片的 OCR 结果数组
function buildDraft(ocrResults, template, config) {
  const resolved = resolveConfig(config)
  const orderedTemplate = getOrderedTemplate(template || {}, resolved)
  const pages = (ocrResults || []).map(result => parsePage(result, resolved))
  const warnings = []

  pages.forEach((page, index) => {
    if (!page.pairs.length) warnings.push(pages.length > 1 ? `第 ${index + 1} 张图片未识别到工资项目` : '图片中未识别到工资项目')
  })

  const months = pages.map(page => page.month).filter(Boolean)
  const month = mostCommon(months) || currentMonth()
  if (!months.length) warnings.push('未识别到月份，请手动确认')
  else if (months.some(value => value !== month)) warnings.push(`图片中的月份不一致（${Array.from(new Set(months)).join('、')}），请确认`)

  const merged = completeItems(mergePages(pages, orderedTemplate, resolved), orderedTemplate)
  // 新增公司的关键字段可能还没设置或名称对不上：按识别到的字段名推断，保存时再写回公司配置
  const effective = resolved.guessGroups ? inferKeys(merged, resolved) : resolved
  const items = settleByFormula(merged, effective)
  if (effective.gross && amountOf(items, effective.gross) === null) warnings.push(`未识别到“${effective.gross}”，可能漏传了对应截图`)
  if (effective.net && amountOf(items, effective.net) === null) warnings.push(`未识别到“${effective.net}”，可能漏传了对应截图`)
  return {
    format: resolved.id,
    month,
    items,
    template: orderedTemplate,
    keys: { gross: effective.gross, net: effective.net, deductTotal: effective.deductTotal },
    warnings,
    validation: validate(items, effective)
  }
}

// 关键字段在识别结果中不存在时，按名称推断：含“应发”（非计税）→ 应发；含“实发” → 实发；扣款/扣除合计 → 扣除合计
function inferKeys(items, config) {
  const pick = (current, pattern, exclude) => {
    if (current && amountOf(items, current) !== null) return current
    const found = items.find(item => item.group !== 'info' && !isBlankAmount(item.amount) &&
      pattern.test(item.name) && !(exclude && exclude.test(item.name)))
    return found ? found.name : current
  }
  return Object.assign({}, config, {
    gross: pick(config.gross, /应发/, /计税/),
    net: pick(config.net, /实发/),
    deductTotal: pick(config.deductTotal, /(扣款|扣除|扣项).*合计|合计.*(扣款|扣除|扣项)/)
  })
}

function recordFromDraft(draft) {
  const items = {}
  draft.items.forEach(item => {
    if (!item.name) return
    items[item.name] = isBlankAmount(item.amount) ? '' : Number(item.amount || 0)
  })
  const imagePaths = (draft.imagePaths || []).filter(Boolean)
  return {
    id: draft.id || `${draft.month}_${draft.format}_${Date.now()}`,
    month: draft.month,
    format: draft.format,
    items,
    imagePath: imagePaths[0] || draft.imagePath || '',
    imagePaths,
    createdAt: draft.createdAt || Date.now(),
    updatedAt: Date.now()
  }
}

function recordTotals(record, template, config) {
  const resolved = resolveConfig(config)
  const items = (record && record.items) || {}
  const deductTotal = resolved.deductTotal && !isBlankAmount(items[resolved.deductTotal]) ? Number(items[resolved.deductTotal]) : null
  const deductNames = ((template && template.deduct) || resolved.order.deduct).filter(name => !sameName(name, resolved.deductTotal))
  return {
    gross: Number(items[resolved.gross] || 0),
    deduct: deductTotal !== null ? deductTotal : deductNames.reduce((sum, name) => sum + Number(items[name] || 0), 0),
    net: Number(items[resolved.net] || 0)
  }
}

module.exports = {
  CN_TEMPLATE_ORDER,
  CN_CONFIG,
  GROUPS,
  GROSS_NAME,
  NET_NAME,
  resolveConfig,
  parsePage,
  buildDraft,
  getOrderedTemplate,
  completeItems,
  validate,
  recordFromDraft,
  recordTotals
}
