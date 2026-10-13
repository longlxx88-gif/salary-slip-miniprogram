// 生成 .xlsx（Office Open XML）文件，不依赖第三方库：
// xlsx 是一个 zip 包，这里用“仅存储、不压缩”的方式打包几份 XML；单元格用内联字符串，无需 sharedStrings。
// 用法：build([{ name: 'Sheet 名', rows: [['表头', ...], [值, ...]] }]) → ArrayBuffer

function utf8Bytes(text) {
  const bytes = []
  const value = String(text)
  for (let index = 0; index < value.length; index += 1) {
    let code = value.charCodeAt(index)
    // 代理对（emoji 等）合成一个码点
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const low = value.charCodeAt(index + 1)
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00)
        index += 1
      }
    }
    if (code < 0x80) bytes.push(code)
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
  }
  return bytes
}

let crcTable = null
function crc32(bytes) {
  if (!crcTable) {
    crcTable = []
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable.push(c >>> 0)
    }
  }
  let crc = 0xffffffff
  for (let index = 0; index < bytes.length; index += 1) crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function pushUint16(target, value) {
  target.push(value & 0xff, (value >>> 8) & 0xff)
}

function pushUint32(target, value) {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff)
}

// 仅存储（method 0）的 zip
function zip(files) {
  const output = []
  const central = []
  files.forEach(file => {
    const name = utf8Bytes(file.name)
    const data = utf8Bytes(file.content)
    const crc = crc32(data)
    const offset = output.length

    pushUint32(output, 0x04034b50)
    pushUint16(output, 20)
    pushUint16(output, 0x0800) // 文件名为 UTF-8
    pushUint16(output, 0)
    pushUint16(output, 0)
    pushUint16(output, 0x21)
    pushUint32(output, crc)
    pushUint32(output, data.length)
    pushUint32(output, data.length)
    pushUint16(output, name.length)
    pushUint16(output, 0)
    name.forEach(byte => output.push(byte))
    data.forEach(byte => output.push(byte))

    pushUint32(central, 0x02014b50)
    pushUint16(central, 20)
    pushUint16(central, 20)
    pushUint16(central, 0x0800)
    pushUint16(central, 0)
    pushUint16(central, 0)
    pushUint16(central, 0x21)
    pushUint32(central, crc)
    pushUint32(central, data.length)
    pushUint32(central, data.length)
    pushUint16(central, name.length)
    pushUint16(central, 0)
    pushUint16(central, 0)
    pushUint16(central, 0)
    pushUint16(central, 0)
    pushUint32(central, 0)
    pushUint32(central, offset)
    name.forEach(byte => central.push(byte))
  })

  const centralOffset = output.length
  central.forEach(byte => output.push(byte))
  pushUint32(output, 0x06054b50)
  pushUint16(output, 0)
  pushUint16(output, 0)
  pushUint16(output, files.length)
  pushUint16(output, files.length)
  pushUint32(output, central.length)
  pushUint32(output, centralOffset)
  pushUint16(output, 0)

  return new Uint8Array(output).buffer
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // XML 不允许的控制字符
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
}

function columnName(index) {
  let name = ''
  let value = index + 1
  while (value > 0) {
    const remainder = (value - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    value = Math.floor((value - 1) / 26)
  }
  return name
}

function cellXml(value, rowIndex, columnIndex, style) {
  const ref = `${columnName(columnIndex)}${rowIndex + 1}`
  const styleAttr = style ? ` s="${style}"` : ''
  if (value === '' || value === null || value === undefined) return ''
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${styleAttr}><v>${value}</v></c>`
  return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
}

// 第一行为表头（加粗、冻结）；数字单元格保留两位小数显示
function sheetXml(rows) {
  const widths = []
  rows.forEach(row => row.forEach((value, column) => {
    const length = String(value === undefined || value === null ? '' : value).length
    widths[column] = Math.max(widths[column] || 8, Math.min(40, length * 2 + 2))
  }))
  const cols = widths.map((width, column) => `<col min="${column + 1}" max="${column + 1}" width="${width}" customWidth="1"/>`).join('')
  const body = rows.map((row, rowIndex) => {
    const cells = row.map((value, column) => {
      const style = rowIndex === 0 ? 1 : (typeof value === 'number' ? 2 : 0)
      return cellXml(value, rowIndex, column, style)
    }).join('')
    return `<row r="${rowIndex + 1}">${cells}</row>`
  }).join('')
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    (cols ? `<cols>${cols}</cols>` : '') +
    `<sheetData>${body}</sheetData></worksheet>`
}

// Sheet 名：最长 31 字符，不能含 []:*?/\，且不能重复
function sheetNames(sheets) {
  const used = []
  return sheets.map((sheet, index) => {
    const base = String(sheet.name || `Sheet${index + 1}`).replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || `Sheet${index + 1}`
    let name = base
    let suffix = 2
    while (used.indexOf(name.toLowerCase()) >= 0) {
      name = `${base.slice(0, 28)}(${suffix})`
      suffix += 1
    }
    used.push(name.toLowerCase())
    return name
  })
}

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs></styleSheet>'

function build(sheets) {
  const list = sheets.length ? sheets : [{ name: 'Sheet1', rows: [] }]
  const names = sheetNames(list)
  const files = [
    {
      name: '[Content_Types].xml',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        list.map((sheet, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        '</Types>'
    },
    {
      name: '_rels/.rels',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>'
    },
    {
      name: 'xl/workbook.xml',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets>' +
        names.map((name, index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('') +
        '</sheets></workbook>'
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        list.map((sheet, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        '</Relationships>'
    },
    { name: 'xl/styles.xml', content: STYLES }
  ].concat(list.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, content: sheetXml(sheet.rows || []) })))

  return zip(files)
}

module.exports = {
  build
}
