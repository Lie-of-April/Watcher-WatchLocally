'use strict'

/**
 * 缩略图磁盘缓存。
 * 生成动作放在渲染进程（用 canvas 解码图片 / 抓视频首帧），
 * 这样零原生依赖、不用带 ffmpeg 或 sharp；主进程只负责寻址与落盘。
 * 缓存键含 mtime + size，源文件一改动缓存自然失效。
 */

const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')

let CACHE_DIR = ''
let DIMS_FILE = ''
const memIndex = new Set()

/**
 * 尺寸表：key -> [宽, 高]。
 * 瀑布流必须在图片解码前就知道宽高比，否则每张图加载完都会推挤布局。
 */
let dims = {}
let dimsDirty = false
let dimsTimer = null

async function init(dir) {
  CACHE_DIR = dir
  DIMS_FILE = path.join(dir, 'dims.json')
  await fsp.mkdir(CACHE_DIR, { recursive: true })
  try {
    dims = JSON.parse(await fsp.readFile(DIMS_FILE, 'utf8')) || {}
  } catch {
    dims = {}
  }
}

function scheduleDimsFlush() {
  dimsDirty = true
  if (dimsTimer) clearTimeout(dimsTimer)
  dimsTimer = setTimeout(flushDims, 1500)
}

async function flushDims() {
  if (!dimsDirty || !DIMS_FILE) return
  dimsDirty = false
  try {
    const tmp = DIMS_FILE + '.tmp'
    await fsp.writeFile(tmp, JSON.stringify(dims), 'utf8')
    await fsp.rename(tmp, DIMS_FILE)
  } catch (e) {
    console.error('[thumbs] 尺寸表落盘失败:', e.message)
  }
}

function keyOf(filePath, mtime, size) {
  const h = crypto
    .createHash('sha1')
    .update(`${String(filePath).toLowerCase()}|${Math.round(mtime || 0)}|${size || 0}`)
    .digest('hex')
  return h
}

function fileOf(key) {
  return path.join(CACHE_DIR, key.slice(0, 2), key + '.jpg')
}

async function get(filePath, mtime, size) {
  const key = keyOf(filePath, mtime, size)
  const f = fileOf(key)
  const dim = dims[key] || null
  if (memIndex.has(key)) return { file: f, w: dim?.[0] || 0, h: dim?.[1] || 0 }
  try {
    await fsp.access(f)
    memIndex.add(key)
    return { file: f, w: dim?.[0] || 0, h: dim?.[1] || 0 }
  } catch {
    return dim ? { file: null, w: dim[0], h: dim[1] } : null
  }
}

async function save(filePath, mtime, size, dataUrl, w, h) {
  const key = keyOf(filePath, mtime, size)
  const f = fileOf(key)
  const comma = String(dataUrl).indexOf(',')
  if (comma < 0) throw new Error('无效的缩略图数据')
  const buf = Buffer.from(String(dataUrl).slice(comma + 1), 'base64')
  await fsp.mkdir(path.dirname(f), { recursive: true })
  const tmp = f + '.tmp'
  await fsp.writeFile(tmp, buf)
  await fsp.rename(tmp, f)
  memIndex.add(key)
  if (w && h) {
    dims[key] = [Math.round(w), Math.round(h)]
    scheduleDimsFlush()
  }
  return { file: f, w: w || 0, h: h || 0 }
}

/**
 * 批量取已知尺寸（纯内存查表）。
 * 瀑布流在渲染前一次性拿全整页的宽高比，避免边滚边重排。
 */
function dimsBatch(list) {
  const out = {}
  for (const it of list || []) {
    const d = dims[keyOf(it.path, it.mtime, it.size)]
    if (d) out[it.path] = d
  }
  return out
}

/** 只记尺寸不存图（比如解码失败但拿到了元信息） */
function saveDims(filePath, mtime, size, w, h) {
  if (!w || !h) return false
  dims[keyOf(filePath, mtime, size)] = [Math.round(w), Math.round(h)]
  scheduleDimsFlush()
  return true
}

async function clear() {
  memIndex.clear()
  dims = {}
  dimsDirty = false
  await fsp.rm(CACHE_DIR, { recursive: true, force: true })
  await fsp.mkdir(CACHE_DIR, { recursive: true })
}

async function stats() {
  let count = 0
  let bytes = 0
  async function walk(dir) {
    let items
    try {
      items = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const it of items) {
      const full = path.join(dir, it.name)
      if (it.isDirectory()) await walk(full)
      else {
        count++
        try {
          bytes += (await fsp.stat(full)).size
        } catch {}
      }
    }
  }
  await walk(CACHE_DIR)
  return { count, bytes, dir: CACHE_DIR }
}

module.exports = { init, get, save, saveDims, dimsBatch, clear, stats, keyOf, flushDims }
