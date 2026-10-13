const formats = require('./formats')
const cnSlip = require('./cnSlip')

// 国内公司及界面新增的公司走列表引擎（cnSlip），泰国公司走本文件原有逻辑
function isCn(format) {
  return Boolean(format) && formats.isListEngine(format)
}

function engine(format) {
  return formats.engineConfig(format)
}

const SALARY_TEMPLATE_ORDER = {
  income: [
    '基本工资',
    '平时加班OT1.5',
    '周日工作',
    '节假日工作工资',
    '周日、节假日加班工资OT3',
    '有薪假工资',
    '病假工资',
    '初创补贴',
    '上浮10%',
    '餐费补贴',
    '绩效奖金KPI',
    '夜班津贴',
    '内部推荐费',
    '补扣',
    '应发工资'
  ],
  deduct: [
    '社会保险',
    '扣个人所得税',
    '扣项合计'
  ],
  total: [
    '实发工资'
  ],
  annual: [
    '年度累计社保',
    '年度累计税额'
  ]
}

const incomeKeywords = ['基本工资', '绩效', '奖金', '补贴', '津贴', '餐费', '夜班', '加班费', '应发', '收入', '工资', '推荐费', '有薪假', '病假', '上浮']
const deductKeywords = ['养老', '医疗', '失业', '保险', '社保', '公积金', '个税', '所得税', '扣款', '代扣', '扣除', '扣个', '扣项', '扣除项目']
const ignoredKeywords = [
  '工资条', '工资单', 'PaySlip', 'Pay Slip', '日期', '编号', '姓名', '部门', '单位', '公司', '账号', '银行',
  '发薪周期', '薪资周期', '工资期间', '员工', '职位', '地址', 'No.', 'Fortiter', 'Technology', 'Co.', 'Ltd',
  'MAMATA', 'City', 'Rayong', 'Industrial', 'Estate', 'Bank', '工号', '开户行', '银行账号', '发薪周期',
  '设备开发工程师', '工程研发部', 'บริษัท', 'ธนาคาร', 'บัญชี', 'เลขที่', 'ที่อยู่'
]
const sectionHeaderNames = ['收入项目', '扣除项目', '实发工资项目', '年度累计']

function currentMonth() {
  const date = new Date()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${date.getFullYear()}-${month}`
}

function normalizeAmountText(text) {
  return String(text || '')
    .replace(/[Oo]/g, '0')
    .replace(/[lI]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/[，,]/g, '')
    .replace(/[^\d.-]/g, '')
}

function toAmount(text) {
  if (!isAmountText(text)) return null
  const normalized = normalizeAmountText(text)
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null
  return Number(normalized)
}

function isAmountText(text) {
  const raw = String(text || '').trim()
  if (!raw) return false
  if (/[A-Za-z\u4e00-\u9fa5ก-๙]/.test(raw)) return false
  const numericParts = raw.match(/-?[\dOoIlSB]+(?:[.,，][\dOoIlSB]+)*/g) || []
  return numericParts.length === 1
}

function amountLines(text) {
  return String(text || '')
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => toAmount(line))
    .filter(amount => amount !== null)
}

function containsAny(text, keywords) {
  return keywords.some(keyword => text.indexOf(keyword) >= 0)
}

function classifyName(name) {
  if (name.indexOf('年度累计') >= 0) return 'annual'
  if (name.indexOf('实发') >= 0) return 'total'
  if (containsAny(name, deductKeywords)) return 'deduct'
  if (containsAny(name, incomeKeywords)) return 'income'
  return 'income'
}

function cleanName(text) {
  return String(text || '')
    .replace(/[:：]/g, '')
    .replace(/[ก-๙]/g, '')
    .replace(/[0-9OoIlSB.,，\-\s/]/g, '')
    .trim()
}

function chineseOnly(text) {
  return String(text || '').replace(/[^\u4e00-\u9fa5]/g, '')
}

function isSectionHeader(name) {
  const text = chineseOnly(name)
  return sectionHeaderNames.indexOf(text) >= 0
}

function isIgnored(name) {
  const text = String(name || '').trim()
  if (!text) return true
  if (!/[\u4e00-\u9fa5]/.test(text)) return true
  if (isSectionHeader(text)) return true
  if (text.indexOf('税前') >= 0) return true
  if (text.indexOf('含税') >= 0) return true
  if (text.indexOf('合并扣税') >= 0) return true
  if (text.indexOf('含合并') >= 0) return true
  if (ignoredKeywords.some(keyword => text.indexOf(keyword) >= 0)) return true
  if (text.length > 18 && /[A-Za-z]{8,}/.test(text) && !containsAny(text, incomeKeywords.concat(deductKeywords))) return true
  if (/^[A-Za-z]+$/.test(text)) return true
  return false
}

function itemKey(name) {
  return String(name || '').replace(/\s/g, '')
}

function normalizeItemName(name) {
  return itemKey(name)
    .replace(/[()（）]/g, '')
    .replace(/[、/，,]/g, '')
    .replace(/[0-9.％%]/g, '')
    .replace(/[A-Za-z]/g, '')
    .replace(/[ก-๙]/g, '')
    .replace(/平均/g, '平时')
    .replace(/税前/g, '')
    .replace(/奖金/g, '')
    .replace(/合计/g, '')
    .replace(/总计/g, '')
    .replace(/工资/g, '')
}

function uniqueNames(names) {
  const result = []
  const keys = []
  ;(names || []).forEach(name => {
    const key = normalizeItemName(name)
    if (name && keys.indexOf(key) < 0) {
      result.push(name)
      keys.push(key)
    }
  })
  return result
}

function getOrderedTemplate(template, format) {
  if (isCn(format)) return cnSlip.getOrderedTemplate(template, engine(format))
  const cleanIncomeItems = ((template && template.income) || [])
    .filter(name => !isIgnored(name))
  const totalItems = (template && template.total) || []
  const annualItems = (template && template.annual) || []
  return {
    income: uniqueNames(SALARY_TEMPLATE_ORDER.income.concat(cleanIncomeItems)),
    deduct: uniqueNames(SALARY_TEMPLATE_ORDER.deduct.concat(((template && template.deduct) || []).filter(name => !isIgnored(name)))),
    total: uniqueNames(SALARY_TEMPLATE_ORDER.total.concat(totalItems.filter(name => {
      return name.indexOf('年度累计') < 0 && name.indexOf('应发') < 0 && !isIgnored(name)
    }))),
    annual: uniqueNames(SALARY_TEMPLATE_ORDER.annual.concat(annualItems, totalItems.filter(name => name.indexOf('年度累计') >= 0)))
  }
}

function templateGroups(format) {
  if (isCn(format)) return cnSlip.GROUPS.slice()
  return ['income', 'deduct', 'total', 'annual']
}

function groupForMatchedName(name, template) {
  return templateGroups().find(group => (template[group] || []).indexOf(name) >= 0) || 'income'
}

function findOrderedName(name, candidates) {
  const source = normalizeItemName(name)
  if (!source) return ''
  return candidates.find(candidate => {
    const target = normalizeItemName(candidate)
    return source === target || source.indexOf(target) >= 0 || target.indexOf(source) >= 0
  }) || ''
}

function fuzzyMatch(name, candidates) {
  const source = itemKey(name)
  if (!source) return ''
  const exact = candidates.find(candidate => itemKey(candidate) === source)
  if (exact) return exact
  return findOrderedName(name, candidates) || candidates.find(candidate => {
    const target = itemKey(candidate)
    return source.indexOf(target) >= 0 || target.indexOf(source) >= 0
  }) || ''
}

function hasLowConfidence(block, threshold) {
  const values = block.wordConfidence || block.WordConfidence || block.confidences || []
  if (!values.length) return false
  return values.some(value => Number(value) < threshold)
}

function normalizeBlocks(rawResult) {
  const list = rawResult && (rawResult.tableCells || rawResult.items || rawResult.lines || rawResult.TextDetections || rawResult.textDetections)
  return (list || []).map((item, index) => ({
    id: `${Date.now()}_${index}`,
    text: item.text || item.Text || item.DetectedText || '',
    x: Number(item.x || item.X || (item.WordCoord && item.WordCoord.Left) || 0),
    y: Number(item.y || item.Y || (item.WordCoord && item.WordCoord.Top) || index * 20),
    width: Number(item.width || item.Width || (item.WordCoord && item.WordCoord.Width) || 0),
    height: Number(item.height || item.Height || (item.WordCoord && item.WordCoord.Height) || 0),
    row: item.row === undefined ? undefined : Number(item.row),
    col: item.col === undefined ? undefined : Number(item.col),
    rowSpan: item.rowSpan === undefined ? undefined : Number(item.rowSpan),
    colSpan: item.colSpan === undefined ? undefined : Number(item.colSpan),
    tableIndex: item.tableIndex === undefined ? undefined : Number(item.tableIndex),
    cellIndex: item.cellIndex === undefined ? undefined : Number(item.cellIndex),
    wordConfidence: item.wordConfidence || item.WordConfidence || item.confidences || []
  })).filter(item => item.text)
}

function parseInlineAmount(block) {
  const text = block.text.replace(/\s/g, '')
  const match = text.match(/(-?[\dOoIlSB]+(?:[.,，][\dOoIlSB]{1,2})?|-?[\dOoIlSB]+)/)
  if (!match) return null
  const amount = toAmount(match[0])
  if (amount === null) return null
  const name = cleanName(text.replace(match[0], ''))
  return { name, amount, block }
}

function pairBlocks(blocks) {
  const tablePairs = pairTableBlocks(blocks)
  if (tablePairs.length) return tablePairs

  const sorted = blocks.slice().sort((a, b) => a.y - b.y || a.x - b.x)
  const pairs = []

  sorted.forEach(block => {
    const inline = parseInlineAmount(block)
    if (inline && !isIgnored(inline.name)) {
      pairs.push(inline)
      return
    }

    const amount = toAmount(block.text)
    if (amount === null) return

    const nameBlock = sorted
      .filter(candidate => candidate !== block && toAmount(candidate.text) === null)
      .filter(candidate => Math.abs(candidate.y - block.y) <= Math.max(18, block.height + 8))
      .sort((a, b) => Math.abs(a.x - block.x) - Math.abs(b.x - block.x))[0]

    if (!nameBlock) return
    const name = cleanName(nameBlock.text)
    if (!isIgnored(name)) pairs.push({ name, amount, block })
  })

  return pairs
}

function pairTableBlocks(blocks) {
  const tableBlocks = blocks.filter(block => Number.isFinite(block.row) && Number.isFinite(block.col))
  if (!tableBlocks.length) return []
  const pairs = []

  tableBlocks.forEach(block => {
    const amounts = amountLines(block.text)
    if (!amounts.length) return

    if (amounts.length > 1) {
      pairMultiLineAmounts(block, amounts, tableBlocks).forEach(pair => pairs.push(pair))
      return
    }

    const internalPairs = pairMixedCell(block)
    const labelBlock = findLabelForAmountBlock(block, tableBlocks)
    const startsWithAmount = toAmount(String(block.text || '').split(/\n+/).map(line => line.trim()).filter(Boolean)[0]) !== null

    if (startsWithAmount && labelBlock) {
      const name = labelLines(labelBlock)[0]
      if (!isIgnored(name)) pairs.push({ name, amount: amounts[0], block })
      return
    }

    if (internalPairs.length) {
      internalPairs.forEach(pair => pairs.push(pair))
      return
    }

    if (!labelBlock) return
    const name = labelLines(labelBlock)[0]
    if (!isIgnored(name)) pairs.push({ name, amount: amounts[0], block })
  })

  return pairs
}

function pairMixedCell(block) {
  const lines = String(block.text || '').split(/\n+/).map(line => line.trim()).filter(Boolean)
  const pairs = []

  for (let index = 0; index < lines.length - 1; index += 1) {
    const name = cleanName(lines[index])
    const amount = toAmount(lines[index + 1])
    if (amount !== null && !isIgnored(name)) {
      pairs.push({ name, amount, block })
      index += 1
      continue
    }

    const reversedAmount = toAmount(lines[index])
    const reversedName = cleanName(lines[index + 1])
    if (reversedAmount !== null && !isIgnored(reversedName)) {
      pairs.push({ name: reversedName, amount: reversedAmount, block })
      index += 1
    }
  }

  if (pairs.length) return pairs

  lines.forEach(line => {
    const inline = parseInlineAmount({ text: line })
    if (inline && !isIgnored(inline.name)) {
      pairs.push({ name: inline.name, amount: inline.amount, block })
    }
  })

  return pairs
}

function cellEndRow(block) {
  const endRow = Number(block.rowSpan)
  return Number.isFinite(endRow) && endRow >= Number(block.row) ? endRow : Number(block.row)
}

function isSameTable(a, b) {
  return a.tableIndex === undefined || b.tableIndex === undefined || Number(a.tableIndex) === Number(b.tableIndex)
}

function labelLines(block) {
  if (isIgnored(block.text)) return []
  return String(block.text || '')
    .split(/\n+/)
    .map(line => cleanName(line))
    .filter(name => name && toAmount(name) === null && !isIgnored(name))
}

function findLabelForAmountBlock(block, tableBlocks) {
  const sameRow = tableBlocks
    .filter(candidate => candidate !== block && isSameTable(candidate, block))
    .filter(candidate => Number(candidate.row) === Number(block.row))
    .filter(candidate => Number(candidate.col) < Number(block.col))
    .filter(candidate => labelLines(candidate).length)
    .sort((a, b) => Number(b.col) - Number(a.col))

  return sameRow[0] || null
}

function pairMultiLineAmounts(block, amounts, tableBlocks) {
  const startRow = Number(block.row)
  const endRow = cellEndRow(block)
  const labelsByRow = {}
  tableBlocks
    .filter(candidate => candidate !== block && isSameTable(candidate, block))
    .filter(candidate => Number(candidate.row) >= startRow && Number(candidate.row) <= endRow)
    .filter(candidate => Number(candidate.col) < Number(block.col))
    .filter(candidate => labelLines(candidate).length)
    .forEach(candidate => {
      const row = String(candidate.row)
      if (!labelsByRow[row] || Number(candidate.col) > Number(labelsByRow[row].col)) {
        labelsByRow[row] = candidate
      }
    })

  const labels = Object.keys(labelsByRow)
    .map(row => labelsByRow[row])
    .sort((a, b) => Number(a.row) - Number(b.row))

  return amounts.map((amount, index) => {
    const label = labels[index]
    if (!label) return null
    return {
      name: labelLines(label)[0],
      amount,
      block
    }
  }).filter(Boolean)
}

function getGroupRank(group) {
  const index = templateGroups().indexOf(group)
  return index >= 0 ? index : templateGroups().length
}

function orderInGroup(item) {
  const orderedNames = SALARY_TEMPLATE_ORDER[item.group] || []
  const directIndex = orderedNames.findIndex(name => itemKey(name) === itemKey(item.name))
  if (directIndex >= 0) return directIndex

  const fuzzyName = findOrderedName(item.name, orderedNames)
  return fuzzyName ? orderedNames.indexOf(fuzzyName) : orderedNames.length + 100
}

function sortItems(items) {
  return (items || []).slice().sort((a, b) => {
    const groupDiff = getGroupRank(a.group) - getGroupRank(b.group)
    if (groupDiff) return groupDiff

    const orderDiff = orderInGroup(a) - orderInGroup(b)
    if (orderDiff) return orderDiff

    return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN')
  })
}

function isBlankAmount(amount) {
  return amount === '' || amount === null || amount === undefined
}

function createBlankItem(group, name) {
  return {
    id: `${group}_${itemKey(name)}`,
    name,
    amount: '',
    group,
    pending: false,
    confirmed: true,
    temporary: false
  }
}

function completeTemplateItems(items, template, format) {
  if (isCn(format)) return cnSlip.completeItems(items, template)
  const byName = {}
  ;(items || []).forEach(item => {
    if (isIgnored(item.name)) return
    byName[`${item.group}_${itemKey(item.name)}`] = item
  })

  const result = []
  templateGroups().forEach(group => {
    ;(template[group] || []).forEach(name => {
      const key = `${group}_${itemKey(name)}`
      result.push(byName[key] || createBlankItem(group, name))
      delete byName[key]
    })
  })

  Object.keys(byName).forEach(key => result.push(byName[key]))
  return sortItems(deriveMissingFormulaItems(result))
}

function deriveMissingFormulaItems(items) {
  deriveMissingDeductItems(items)
  deriveMissingNetAndDeductTotal(items)
  return items
}

function deriveMissingDeductItems(items) {
  const social = items.find(item => item.group === 'deduct' && item.name.indexOf('社会保险') >= 0)
  const tax = items.find(item => item.group === 'deduct' && item.name.indexOf('所得税') >= 0)
  const total = items.find(item => item.group === 'deduct' && item.name.indexOf('合计') >= 0)

  if (social && isBlankAmount(social.amount) && tax && total && !isBlankAmount(tax.amount) && !isBlankAmount(total.amount)) {
    const derived = Number(total.amount || 0) - Number(tax.amount || 0)
    if (derived >= 0) social.amount = Number(derived.toFixed(2))
  }

  if (tax && isBlankAmount(tax.amount) && social && total && !isBlankAmount(social.amount) && !isBlankAmount(total.amount)) {
    const derived = Number(total.amount || 0) - Number(social.amount || 0)
    if (derived >= 0) tax.amount = Number(derived.toFixed(2))
  }
}

function deriveMissingNetAndDeductTotal(items) {
  const gross = items.find(item => item.name.indexOf('应发') >= 0 && !isBlankAmount(item.amount))
  const net = items.find(item => item.group === 'total' && item.name.indexOf('实发') >= 0)
  const total = items.find(item => item.group === 'deduct' && item.name.indexOf('合计') >= 0)

  if (gross && net && total && isBlankAmount(net.amount) && !isBlankAmount(total.amount)) {
    const derived = Number(gross.amount || 0) - Number(total.amount || 0)
    if (derived >= 0) net.amount = Number(derived.toFixed(2))
  }

  if (gross && net && total && isBlankAmount(total.amount) && !isBlankAmount(net.amount)) {
    const derived = Number(gross.amount || 0) - Number(net.amount || 0)
    if (derived >= 0) total.amount = Number(derived.toFixed(2))
  }
}

function buildDraft(rawResult, template, settings) {
  const threshold = Number(settings.confidenceThreshold || 75)
  const blocks = normalizeBlocks(rawResult)
  const pairs = pairBlocks(blocks)
  const orderedTemplate = getOrderedTemplate(template || {})
  const templateNames = []
    .concat(orderedTemplate.income || [])
    .concat(orderedTemplate.deduct || [])
    .concat(orderedTemplate.total || [])
    .concat(orderedTemplate.annual || [])
  const nextTemplate = getOrderedTemplate(template || {})

  const recognizedItems = pairs.map(pair => {
    if (isIgnored(pair.name)) return null
    const matched = fuzzyMatch(pair.name, templateNames)
    if (!matched) return null
    const name = matched || pair.name
    if (isIgnored(name)) return null
    const group = matched
      ? groupForMatchedName(matched, nextTemplate)
      : classifyName(name)

    return {
      id: pair.block.id,
      name,
      amount: pair.amount,
      group,
      pending: hasLowConfidence(pair.block, threshold),
      confirmed: !hasLowConfidence(pair.block, threshold),
      temporary: false
    }
  }).filter(Boolean)
  relocateLikelyGross(recognizedItems)
  const items = completeTemplateItems(recognizedItems, nextTemplate)

  return {
    month: currentMonth(),
    items,
    template: nextTemplate,
    rawBlocks: blocks,
    validation: validateItems(items)
  }
}

function relocateLikelyGross(items) {
  const hasGross = items.some(item => item.name.indexOf('应发') >= 0 && !isBlankAmount(item.amount))
  if (hasGross) return

  const candidate = items.find(item => {
    return item.group === 'income' &&
      item.name.indexOf('基本工资') < 0 &&
      item.name.indexOf('绩效') < 0 &&
      item.name.indexOf('上浮') < 0 &&
      Number(item.amount || 0) > 30000
  })

  if (!candidate) return
  candidate.name = '应发工资'
  candidate.group = 'income'
}

// keyOverrides：识别时推断出的关键字段（新增公司首次识别、尚未写回配置时）
function validateItems(items, format, keyOverrides) {
  if (isCn(format)) return cnSlip.validate(items, Object.assign({}, engine(format), keyOverrides))
  const gross = findAmount(items, '应发')
  const net = findAmount(items, '实发')
  const deductTotal = findDeductTotal(items)

  if (gross === null || net === null) {
    return {
      ok: true,
      message: '未识别完整的应发/实发字段，已跳过公式校验'
    }
  }

  const diff = Math.abs((gross - deductTotal) - net)
  return {
    ok: diff <= 0.02,
    message: diff <= 0.02 ? '金额校验通过' : `应发 - 扣除 = 实发 不平衡，差额 ${diff.toFixed(2)}`
  }
}

function findDeductTotal(items) {
  const total = items.find(item => item.group === 'deduct' && item.name.indexOf('合计') >= 0 && !isBlankAmount(item.amount))
  if (total) return Number(total.amount || 0)

  return items
    .filter(item => item.group === 'deduct' && item.name.indexOf('合计') < 0)
    .reduce((sum, item) => sum + Number(item.amount || 0), 0)
}

function findAmount(items, keyword) {
  const item = items.find(entry => entry.name.indexOf(keyword) >= 0 && !isBlankAmount(entry.amount))
  return item ? Number(item.amount || 0) : null
}

function recordFromDraft(draft) {
  if (isCn(draft.format)) return cnSlip.recordFromDraft(draft)
  const items = {}
  draft.items.forEach(item => {
    if (isIgnored(item.name)) return
    items[item.name] = isBlankAmount(item.amount) ? '' : Number(item.amount || 0)
  })
  return {
    id: draft.id || `${draft.month}_${Date.now()}`,
    month: draft.month,
    format: 'thai',
    items,
    imagePath: draft.imagePath || '',
    createdAt: draft.createdAt || Date.now(),
    updatedAt: Date.now()
  }
}

// 列表引擎公司（国内 / 新增公司）的识别草稿；ocrResults 为一张或多张图片的 OCR 结果
function buildListDraft(ocrResults, template, format) {
  return cnSlip.buildDraft(ocrResults, template, engine(format))
}

// 应发 / 实发对应的字段名
function keyFieldNames(template, format) {
  if (isCn(format)) return { gross: engine(format).gross, net: engine(format).net }
  return {
    gross: (template.total || []).concat(template.income || []).find(name => name.indexOf('应发') >= 0) || '',
    net: (template.total || []).find(name => name.indexOf('实发') >= 0) || ''
  }
}

// 单条记录的应发/扣除/实发，按记录自身的格式取值
function recordTotals(record, template) {
  const recordFormatId = formats.recordFormat(record)
  if (isCn(recordFormatId)) return cnSlip.recordTotals(record, template, engine(recordFormatId))
  const items = (record && record.items) || {}
  const grossName = (template.total || []).concat(template.income || []).find(name => name.indexOf('应发') >= 0)
  const netName = (template.total || []).find(name => name.indexOf('实发') >= 0)
  return {
    gross: Number(grossName ? items[grossName] || 0 : 0),
    deduct: sumDeduct([record], template.deduct || []),
    net: Number(netName ? items[netName] || 0 : 0)
  }
}

function summarize(records, template, format) {
  if (isCn(format)) {
    const totals = records.map(record => cnSlip.recordTotals(record, template, engine(format)))
    const sum = key => totals.reduce((total, item) => total + item[key], 0)
    const gross = sum('gross')
    const net = sum('net')
    return {
      count: records.length,
      gross,
      net,
      deduct: sum('deduct'),
      avgGross: records.length ? gross / records.length : 0,
      avgNet: records.length ? net / records.length : 0
    }
  }
  const incomeNames = template.income || []
  const deductNames = template.deduct || []
  const totalGrossNames = (template.total || []).concat(incomeNames).filter(name => name.indexOf('应发') >= 0)
  const totalNetNames = (template.total || []).filter(name => name.indexOf('实发') >= 0)

  const sumNames = names => records.reduce((sum, record) => {
    return sum + names.reduce((sub, name) => sub + Number(record.items[name] || 0), 0)
  }, 0)

  const gross = sumNames(totalGrossNames.length ? totalGrossNames : incomeNames.filter(name => name.indexOf('应发') < 0))
  const net = sumNames(totalNetNames)
  const deduct = sumDeduct(records, deductNames)

  return {
    count: records.length,
    gross,
    net,
    deduct,
    avgGross: records.length ? gross / records.length : 0,
    avgNet: records.length ? net / records.length : 0
  }
}

function sumDeduct(records, deductNames) {
  const totalName = (deductNames || []).find(name => name.indexOf('合计') >= 0)
  const detailNames = (deductNames || []).filter(name => name.indexOf('合计') < 0)

  return records.reduce((sum, record) => {
    if (totalName && record.items[totalName] !== undefined && record.items[totalName] !== '') {
      return sum + Number(record.items[totalName] || 0)
    }

    return sum + detailNames.reduce((sub, name) => sub + Number(record.items[name] || 0), 0)
  }, 0)
}

module.exports = {
  SALARY_TEMPLATE_ORDER,
  currentMonth,
  buildDraft,
  validateItems,
  recordFromDraft,
  recordTotals,
  keyFieldNames,
  buildListDraft,
  summarize,
  getOrderedTemplate,
  sortItems,
  completeTemplateItems,
  templateGroups
}
