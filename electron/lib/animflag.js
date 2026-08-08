'use strict'

/**
 * 动图判定：区分「会动的图」和「静止的图」。
 *
 * 光看扩展名不够——.webp / .png / .jpg 都可能是静态也可能是动画，
 * 所以这里只读文件头部的几 KB 做结构判定，不做完整解码。
 * 结果按 路径+mtime+size 缓存到磁盘，同一批图只在第一次浏览时付出 IO 代价。
 */

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')

let FLAG_FILE = ''
let flags = {}
let dirty = false
let timer = null

/* 各格式需要读取的头部长度：够判定即可，别把大文件整个读进内存 */
const HEAD_GIF = 512 * 1024
const HEAD_WEBP = 128
const HEAD_PNG = 64 * 1024
// 多帧 JPEG 要跨过完整的第一帧才能看到第二个 SOI；首帧可能很大，给 8MB 上限
const HEAD_JPEG = 8 * 1024 * 1024

async function init(dir) {
  FLAG_FILE = path.join(dir, 'animated.json')
  try {
    flags = JSON.parse(await fsp.readFile(FLAG_FILE, 'utf8')) || {}
  } catch {
    flags = {}
  }
}

function keyOf(filePath, mtime, size) {
  // v3：检测逻辑升级（jpg 增加真实文件头嗅探，覆盖"改后缀的动图"）后强制重新判定
  return crypto
    .createHash('sha1')
    .update(`v3|${String(filePath).toLowerCase()}|${Math.round(mtime || 0)}|${size || 0}`)
    .digest('hex')
}

function schedule() {
  dirty = true
  if (timer) clearTimeout(timer)
  timer = setTimeout(flush, 2000)
}

async function flush() {
  if (!dirty || !FLAG_FILE) return
  dirty = false
  try {
    const tmp = FLAG_FILE + '.tmp'
    await fsp.writeFile(tmp, JSON.stringify(flags), 'utf8')
    await fsp.rename(tmp, FLAG_FILE)
  } catch (e) {
    console.error('[animflag] 落盘失败:', e.message)
  }
}

/** 只读文件开头的 n 字节 */
async function readHead(filePath, n) {
  let fh
  try {
    fh = await fsp.open(filePath, 'r')
    const st = await fh.stat()
    const len = Math.min(n, st.size)
    if (len <= 0) return null
    const buf = Buffer.allocUnsafe(len)
    const { bytesRead } = await fh.read(buf, 0, len, 0)
    return bytesRead === len ? buf : buf.subarray(0, bytesRead)
  } catch {
    return null
  } finally {
    if (fh) await fh.close().catch(() => {})
  }
}

/**
 * GIF：判定依据是「图像帧数 ≥ 2」。
 * 逐块走一遍逻辑屏幕之后的数据流，比盲搜字节可靠（0x2C 也可能出现在像素数据里）。
 */
function gifAnimated(buf) {
  if (buf.length < 14 || buf.toString('latin1', 0, 3) !== 'GIF') return false
  let i = 13
  // 全局色表
  const packed = buf[10]
  if (packed & 0x80) i += 3 * (1 << ((packed & 0x07) + 1))

  let frames = 0
  while (i < buf.length) {
    const b = buf[i]
    if (b === 0x3b) break // Trailer
    if (b === 0x21) {
      // 扩展块：跳过所有 sub-block
      i += 2
      while (i < buf.length && buf[i] !== 0x00) i += buf[i] + 1
      i++
      continue
    }
    if (b === 0x2c) {
      frames++
      if (frames >= 2) return true
      i += 10
      const lp = buf[i - 1]
      if (lp & 0x80) i += 3 * (1 << ((lp & 0x07) + 1))
      i++ // LZW min code size
      while (i < buf.length && buf[i] !== 0x00) i += buf[i] + 1
      i++
      continue
    }
    break // 遇到无法识别的块就停手，宁可判静态也别乱猜
  }
  return false
}

/** 动画 WebP：VP8X 扩展头里带 ANIM chunk */
function webpAnimated(buf) {
  if (buf.length < 21) return false
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return false
  if (buf.toString('latin1', 12, 16) !== 'VP8X') return false
  // VP8X flags: bit 1 = animation
  return (buf[20] & 0x02) !== 0 || buf.toString('latin1', 0, Math.min(buf.length, 64)).includes('ANIM')
}

/** APNG：在 IDAT 之前出现 acTL 块 */
function pngAnimated(buf) {
  if (buf.length < 16 || buf.readUInt32BE(0) !== 0x89504e47) return false
  const idat = buf.indexOf('IDAT', 0, 'latin1')
  const actl = buf.indexOf('acTL', 0, 'latin1')
  return actl > 0 && (idat < 0 || actl < idat)
}

/**
 * 多帧 JPEG（一些「动图 jpg」就是把多张 JPEG 首尾拼接）。
 * 与渲染端的 parseMultiFrameJpeg 判定口径保持一致：
 * - 必须以 SOI(FFD8FF) 开头、EOI(FFD9) 结尾
 * - 扫描所有 SOI 标记，出现 ≥2 个且第二个离首帧 ≥50KB
 * （EXIF 缩略图很小、紧贴首帧，靠这个间距挡掉误判）。
 */
function jpegAnimated(buf) {
  const n = buf.length
  if (n < 64) return false
  if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return false
  // 必须以 EOI(FFD9) 结尾，否则多半是被截断/非拼接的图
  if (!(buf[n - 2] === 0xff && buf[n - 1] === 0xd9)) return false
  let prev = 0
  let extra = 0
  for (let i = 3; i + 2 < n; i++) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) {
      if (i - prev >= 50000) extra++
      prev = i
    }
  }
  return extra >= 1
}

async function detectOne(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  try {
    if (ext === '.gif') {
      const b = await readHead(filePath, HEAD_GIF)
      return b ? gifAnimated(b) : false
    }
    if (ext === '.webp') {
      const b = await readHead(filePath, HEAD_WEBP)
      return b ? webpAnimated(b) : false
    }
    if (ext === '.png' || ext === '.apng') {
      const b = await readHead(filePath, HEAD_PNG)
      return b ? pngAnimated(b) : false
    }
    if (ext === '.jpg' || ext === '.jpeg' || ext === '.jfif') {
      const b = await readHead(filePath, HEAD_JPEG)
      if (!b) return false
      // 先按真实文件头嗅探：很多"动图 jpg"其实是被改了扩展名的 GIF / 动图 WebP / APNG，
      // 光看扩展名会漏判，所以这里以文件头为准重新路由到对应检测器。
      const head3 = b.toString('latin1', 0, 3)
      const head4 = b.toString('latin1', 0, 4)
      if (head3 === 'GIF') return gifAnimated(b)
      if (head4 === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return webpAnimated(b)
      if (b.readUInt32BE(0) === 0x89504e47) return pngAnimated(b)
      return jpegAnimated(b)
    }
  } catch {
    /* 读失败按静态处理 */
  }
  return false
}

const CANDIDATE = /\.(gif|webp|png|apng|jpe?g|jfif)$/i

/**
 * 批量判定。命中缓存的直接返回，其余按小并发探测，避免一次开几十个句柄。
 * @param {{path:string,mtime:number,size:number}[]} list
 * @returns {Promise<Record<string, boolean>>}
 */
async function detectBatch(list) {
  const out = {}
  if (!Array.isArray(list) || !list.length) return out

  const todo = []
  for (const it of list) {
    if (!it || !it.path) continue
    if (!CANDIDATE.test(it.path)) {
      out[it.path] = false
      continue
    }
    const k = keyOf(it.path, it.mtime, it.size)
    if (k in flags) out[it.path] = !!flags[k]
    else todo.push({ ...it, key: k })
  }
  if (!todo.length) return out

  const CONC = 6
  let idx = 0
  await Promise.all(
    new Array(Math.min(CONC, todo.length)).fill(0).map(async () => {
      while (idx < todo.length) {
        const it = todo[idx++]
        const v = await detectOne(it.path)
        flags[it.key] = v
        out[it.path] = v
      }
    })
  )
  schedule()
  return out
}

function clear() {
  flags = {}
  dirty = false
  if (FLAG_FILE) {
    try {
      fs.unlinkSync(FLAG_FILE)
    } catch {
      /* 文件不存在忽略 */
    }
  }
}

module.exports = { init, detectBatch, clear, flush }
