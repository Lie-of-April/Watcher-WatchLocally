'use strict'

const fs = require('node:fs')

/**
 * 极简 EXIF 读取器：只读 JPEG 的 APP1/Exif，解析 IFD0 与 Exif SubIFD 里
 * 常用的一批标签（相机/镜头/时间/曝光/光圈/ISO/焦距/像素尺寸/方向）。
 * 纯 JS，零原生依赖；失败或没有 EXIF 时返回 null。
 */

const SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 9: 4, 10: 8, 11: 4 }

// IFD0 顶层标签
const IFD0_LABELS = {
  0x010f: '相机品牌',
  0x0110: '相机型号',
  0x0131: '软件',
  0x0132: '文件时间',
  0x0112: '方向'
}
// Exif SubIFD 标签
const EXIF_LABELS = {
  0x829a: '快门',
  0x829d: '光圈',
  0x8827: 'ISO',
  0x9003: '拍摄时间',
  0x920a: '焦距',
  0xa434: '镜头',
  0xa002: '像素宽',
  0xa003: '像素高'
}

const ORIENTATION = {
  1: '正常', 2: '水平翻转', 3: '旋转 180°', 4: '垂直翻转',
  5: '水平翻转 + 顺时针 90°', 6: '顺时针 90°', 7: '水平翻转 + 逆时针 90°', 8: '逆时针 90°'
}

function parseIFD(buf, tiffBase, offset, le) {
  const rd16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o))
  const rd32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o))
  const n = rd16(tiffBase + offset)
  const out = {}
  for (let i = 0; i < n; i++) {
    const e = tiffBase + offset + 2 + i * 12
    const tag = rd16(e)
    const type = rd16(e + 2)
    const count = rd32(e + 4)
    const size = SIZES[type] || 0
    let dataOff = e + 8
    if (count * size > 4) dataOff = tiffBase + rd32(e + 8)
    out[tag] = { type, count, dataOff, rd16, rd32 }
  }
  return out
}

function readVal(buf, entry, le) {
  const { type, count, dataOff } = entry
  switch (type) {
    case 2: // ASCII
      return buf.toString('ascii', dataOff, dataOff + count).replace(/\0+$/, '').trim()
    case 3: // SHORT
      return entry.rd16(dataOff)
    case 4: // LONG
      return entry.rd32(dataOff)
    case 5: { // RATIONAL
      const num = entry.rd32(dataOff)
      const den = entry.rd32(dataOff + 4)
      return den ? num / den : 0
    }
    case 1:
      return buf.readUInt8(dataOff)
    case 9:
      return le ? buf.readInt32LE(dataOff) : buf.readInt32BE(dataOff)
    default:
      return null
  }
}

function fmt(tag, v) {
  if (v == null) return ''
  switch (tag) {
    case 0x829a: // ExposureTime
      return typeof v === 'number'
        ? v < 1 ? `1/${Math.round(1 / v)} s` : `${v.toFixed(1)} s`
        : String(v)
    case 0x829d: // FNumber
      return 'f/' + (typeof v === 'number' ? v.toFixed(1) : v)
    case 0x8827: // ISO
      return 'ISO ' + v
    case 0x920a: // FocalLength
      return (typeof v === 'number' ? Math.round(v) : v) + ' mm'
    case 0x0112: // Orientation
      return ORIENTATION[v] || String(v)
    case 0x9003: // DateTimeOriginal
    case 0x0132: // DateTime
      return typeof v === 'string' ? v.replace(':', '-').replace(':', '-') : String(v)
    default:
      return typeof v === 'string' ? v : String(v)
  }
}

function read(filePath) {
  let buf
  try {
    const fd = fs.openSync(filePath, 'r')
    const stat = fs.fstatSync(fd)
    const len = Math.min(stat.size, 256 * 1024) // EXIF 都在文件头，没必要读全图
    buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, 0)
    fs.closeSync(fd)
  } catch {
    return null
  }

  // 仅支持 JPEG
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null

  // 找 APP1(Exif)
  let off = 2
  let tiffStart = -1
  while (off < buf.length - 12) {
    if (buf[off] !== 0xff) break
    const marker = buf[off + 1]
    const len = buf.readUInt16BE(off + 2)
    if (marker === 0xe1 && buf.toString('ascii', off + 4, off + 10) === 'Exif\0\0') {
      tiffStart = off + 10
      break
    }
    if (marker === 0xda) break // 图像数据开始
    off += 2 + len
  }
  if (tiffStart < 0) return null

  const order = buf.toString('ascii', tiffStart, tiffStart + 2)
  if (order !== 'II' && order !== 'MM') return null
  const le = order === 'II'

  try {
    const rd32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o))
    const ifd0Off = rd32(tiffStart + 4)
    const ifd0 = parseIFD(buf, tiffStart, ifd0Off, le)
    const result = {}

    for (const [tag, label] of Object.entries(IFD0_LABELS)) {
      const e = ifd0[tag]
      if (e) result[label] = fmt(tag, readVal(buf, e, le))
    }

    // Exif SubIFD
    if (ifd0[0x8769]) {
      const subOff = ifd0[0x8769].rd32(ifd0[0x8769].dataOff)
      const sub = parseIFD(buf, tiffStart, subOff, le)
      for (const [tag, label] of Object.entries(EXIF_LABELS)) {
        const e = sub[tag]
        if (e) result[label] = fmt(tag, readVal(buf, e, le))
      }
    }

    return Object.keys(result).length ? result : null
  } catch {
    return null
  }
}

module.exports = { read }
