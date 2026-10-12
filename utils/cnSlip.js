// 国内公司工资条：手机 App“我的薪资”多页截图，左侧标签、右侧数值，满屏斜向水印。
// OCR 走腾讯通用文字识别（ocr 云函数 mode: 'general'），按同一行 y 坐标配对标签与数值。

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
const TAXABLE_NAME = '计税应发工资合计'
const COMBINED_TAX_NAME = '合并扣税额(已领现金，仅扣税)'
// 非金额或页面装饰文字，不作为工资项目
const SKIP_LABELS = ['期间', '入职日期', '绩效等级', '我的薪资', '上滑翻页']
const MAX_TEXT_ANGLE = 10
const LABEL_MAX_X_RATIO = 0.4
// 实测：正常金额置信度多为 95～100（个别 0.00 为 82～83），误读（如 ￥0.00、净含量:）为 57～75
const MIN_VALUE_CONFIDENCE = 80
const BALANCE_TOLERANCE = 0.02

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

// 金额必须带两位小数；水印碎片（LY514857、514857 等）没有小数点，天然被排除。
// OCR 会给孤立的 0.00 前面加上货币符号（￥0.00），先去掉
function parseValue(text) {
  const normalized = String(text || '').replace(/\s/g, '').replace(/[，,￥¥$]/g, '')
  if (!/^-?\d+\.\d{2}$/.test(normalized)) return null
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

// 解析单页截图：通用识别（文本行）与表格识别（单元格）各自配对，再按字段名合并互补。
// 返回 { month, pairs: [{ name, amount|null, conflict?: [a, b] }] }
function parsePage(rawResult) {
  const general = pairLines(normalizeLines(rawResult))
  const table = pairTableCells((rawResult && rawResult.tableCells) || [])
  return {
    month: general.month || table.month,
    pairs: combinePairs(general.pairs, table.pairs)
  }
}

function pairTableCells(cells) {
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
      const labelIndex = texts.findIndex(text => hasChinese(text))
      if (labelIndex < 0) return
      const name = cleanLabel(texts[labelIndex])
      if (!hasChinese(name) || SKIP_LABELS.indexOf(name) >= 0) return
      const valueCell = cellsInRow.slice(labelIndex + 1).find(cell => parseValue(cell.text) !== null)
      pairs.push({
        name,
        amount: valueCell ? parseValue(valueCell.text) : null,
        lowConfidence: Boolean(valueCell && averageConfidence(valueCell) < MIN_VALUE_CONFIDENCE)
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

function pairLines(lines) {
  let month = ''
  const values = []
  const labels = []
  // 字段名都在左半边；右侧金额列偶尔被 OCR 读成“净含量:”“发票专用章”之类的文字，不能当字段名
  const pageRight = lines.reduce((max, line) => Math.max(max, line.x + line.width), 0)
  const labelMaxX = pageRight * LABEL_MAX_X_RATIO

  lines.forEach(line => {
    const lineMonth = parseMonth(line.text)
    if (lineMonth) {
      if (!month) month = lineMonth
      return
    }
    const amount = parseValue(line.text)
    if (amount !== null) {
      values.push(Object.assign({ amount, used: false }, line))
      return
    }
    if (hasChinese(line.text) && line.x < labelMaxX) labels.push(line)
  })

  const pairs = []
  labels
    .sort((a, b) => a.y - b.y)
    .forEach(label => {
      const name = cleanLabel(label.text)
      if (!hasChinese(name) || SKIP_LABELS.indexOf(name) >= 0) return
      const value = values
        .filter(candidate => !candidate.used && candidate.x > label.x)
        .map(candidate => ({ candidate, diff: Math.abs(centerY(candidate) - centerY(label)) }))
        .filter(entry => entry.diff <= Math.max(label.height, entry.candidate.height, 20) * 0.6)
        .sort((a, b) => a.diff - b.diff)[0]

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
  // 标签被水印截断（如“平日迟到/早退”）：唯一前缀匹配时才认，并标记待核对
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

function mergePages(pages, template) {
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
      const name = match ? match.name : (suspect ? `${pair.name}（待核对）` : pair.name)
      // 模板外字段默认归入参考信息，避免误识别的杂项污染收入合计
      const group = match ? match.group : (pair.name.indexOf('扣') === 0 ? 'deduct' : 'info')
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
    else if (entry.unknown) note = '模板外的新字段，请确认字段名、分组和金额'
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

function getOrderedTemplate(template) {
  // 内置字段以 CN_TEMPLATE_ORDER 的分组为准（旧模板里计税两项在 info 组，需迁到 tax 组）
  const builtinGroup = {}
  GROUPS.forEach(group => {
    CN_TEMPLATE_ORDER[group].forEach(name => {
      builtinGroup[labelKey(name)] = group
    })
  })
  const result = {}
  GROUPS.forEach(group => {
    const saved = ((template && template[group]) || []).filter(name => {
      const owner = builtinGroup[labelKey(name)]
      return !owner || owner === group
    })
    result[group] = uniqueByKey(CN_TEMPLATE_ORDER[group].concat(saved))
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
  const key = labelKey(name)
  return items.find(item => labelKey(item.name) === key)
}

function amountOf(items, name) {
  const item = findItem(items, name)
  return item && !isBlankAmount(item.amount) ? Number(item.amount) : null
}

function sumAmounts(items) {
  return items.reduce((sum, item) => sum + Number(item.amount || 0), 0)
}

function incomeDetails(items) {
  return items.filter(item => item.group === 'income' && labelKey(item.name) !== labelKey(GROSS_NAME))
}

function deductItems(items) {
  return items.filter(item => item.group === 'deduct')
}

// 只缺一项时用公式反推，并标记为待确认
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

// 用“收入合计 = 应发”“应发 − 扣除 = 实发”处理不确定项（未识别 / 低置信度 / 整页漏传的空白）：
// 1. 不确定项按识别值（空白按 0）计算后公式恰好平衡 → 证明这些值正确，自动采用、无需确认；
// 2. 不平衡且只有一个空白不确定项 → 反推该项，标记待确认；
// 3. 其余情况 → 保持待确认，并提示这些项的合计应为多少。
// 组内有其他异常（重名、两种识别冲突、模板外字段）时不自动采用。
function settleByFormula(items) {
  const gross = amountOf(items, GROSS_NAME)
  const net = amountOf(items, NET_NAME)

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

  if (gross !== null) settle(incomeDetails(items), gross, '收入项')
  if (gross !== null && net !== null) settle(deductItems(items), gross - net, '扣除项')
  settleTaxable(items, gross)
  return items
}

// 计税应发工资合计 = 应发工资合计 + 合并扣税额：缺一项时反推（标记待确认），三项齐全且平衡时确认不确定项
function settleTaxable(items, gross) {
  const taxableItem = findItem(items, TAXABLE_NAME)
  const combinedItem = findItem(items, COMBINED_TAX_NAME)
  if (!taxableItem || !combinedItem || gross === null) return
  const taxable = amountOf(items, TAXABLE_NAME)
  const combined = amountOf(items, COMBINED_TAX_NAME)

  if (taxable !== null && combined !== null) {
    if (Math.abs(round2(gross + combined - taxable)) <= BALANCE_TOLERANCE) {
      ;[taxableItem, combinedItem].filter(item => item.uncertain).forEach(clearPending)
    }
    return
  }
  if (taxable !== null && combined === null) {
    combinedItem.amount = round2(taxable - gross)
    setPending(combinedItem, '由“计税应发 − 应发”反推，请对照截图核对')
  } else if (taxable === null && combined !== null) {
    taxableItem.amount = round2(gross + combined)
    setPending(taxableItem, '由“应发 + 合并扣税额”反推，请对照截图核对')
  }
}

function validate(items) {
  const gross = amountOf(items, GROSS_NAME)
  const net = amountOf(items, NET_NAME)
  if (gross === null || net === null) {
    return { ok: true, message: '未识别到应发/实发合计，已跳过公式校验' }
  }

  const incomeDiff = round2(sumAmounts(incomeDetails(items)) - gross)
  const netDiff = round2(gross - sumAmounts(deductItems(items)) - net)
  const problems = []
  if (Math.abs(incomeDiff) > BALANCE_TOLERANCE) problems.push(`收入各项合计与应发相差 ${incomeDiff.toFixed(2)}`)
  if (Math.abs(netDiff) > BALANCE_TOLERANCE) problems.push(`应发 − 扣除 − 实发 相差 ${netDiff.toFixed(2)}`)

  const taxable = amountOf(items, TAXABLE_NAME)
  const combined = amountOf(items, COMBINED_TAX_NAME)
  const checksTaxable = taxable !== null && combined !== null
  if (checksTaxable) {
    const taxableDiff = round2(gross + combined - taxable)
    if (Math.abs(taxableDiff) > BALANCE_TOLERANCE) problems.push(`应发 + 合并扣税额 − 计税应发 相差 ${taxableDiff.toFixed(2)}`)
  }

  return {
    ok: !problems.length,
    message: problems.length
      ? problems.join('；')
      : `金额校验通过（收入合计 = 应发，应发 − 扣除 = 实发${checksTaxable ? '，应发 + 合并扣税额 = 计税应发' : ''}）`
  }
}

// ocrResults：多张截图的 OCR 结果数组
function buildDraft(ocrResults, template) {
  const orderedTemplate = getOrderedTemplate(template || {})
  const pages = (ocrResults || []).map(parsePage)
  const warnings = []

  pages.forEach((page, index) => {
    if (!page.pairs.length) warnings.push(`第 ${index + 1} 张截图未识别到工资项目`)
  })

  const months = pages.map(page => page.month).filter(Boolean)
  const month = mostCommon(months) || currentMonth()
  if (!months.length) warnings.push('未识别到月份，请手动确认')
  else if (months.some(value => value !== month)) warnings.push(`截图中的月份不一致（${Array.from(new Set(months)).join('、')}），请确认`)

  const items = settleByFormula(completeItems(mergePages(pages, orderedTemplate), orderedTemplate))
  if (amountOf(items, GROSS_NAME) === null) warnings.push(`未识别到“${GROSS_NAME}”，可能漏传了对应截图`)
  if (amountOf(items, NET_NAME) === null) warnings.push(`未识别到“${NET_NAME}”，可能漏传了对应截图`)
  return {
    format: 'cn',
    month,
    items,
    template: orderedTemplate,
    warnings,
    validation: validate(items)
  }
}

function recordFromDraft(draft) {
  const items = {}
  draft.items.forEach(item => {
    if (!item.name) return
    items[item.name] = isBlankAmount(item.amount) ? '' : Number(item.amount || 0)
  })
  const imagePaths = (draft.imagePaths || []).filter(Boolean)
  return {
    id: draft.id || `${draft.month}_cn_${Date.now()}`,
    month: draft.month,
    format: 'cn',
    items,
    imagePath: imagePaths[0] || '',
    imagePaths,
    createdAt: draft.createdAt || Date.now(),
    updatedAt: Date.now()
  }
}

function recordTotals(record, template) {
  const items = (record && record.items) || {}
  const deductNames = (template && template.deduct) || CN_TEMPLATE_ORDER.deduct
  return {
    gross: Number(items[GROSS_NAME] || 0),
    deduct: deductNames.reduce((sum, name) => sum + Number(items[name] || 0), 0),
    net: Number(items[NET_NAME] || 0)
  }
}

module.exports = {
  CN_TEMPLATE_ORDER,
  GROUPS,
  GROSS_NAME,
  NET_NAME,
  parsePage,
  buildDraft,
  getOrderedTemplate,
  completeItems,
  validate,
  recordFromDraft,
  recordTotals
}
