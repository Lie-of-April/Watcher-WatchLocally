'use strict'

/**
 * 全局索引：递归扫描库根下所有媒体文件，落进 index.json。
 * 用途：全局搜索、跨文件夹标签检索、"递归浏览子孙文件"。
 * 扫描是分批 yield 的协作式任务，避免长时间阻塞主进程消息循环。
 */

const fsp = require('node:fs/promises')
const path = require('node:path')
const { isMediaExt, kindOf } = require('./consts')
const { normPath } = require('./store')

const MAX_ENTRIES = 500000
const SKIP_DIRS = new Set([
  'node_modules', '$recycle.bin', 'system volume information',
  '.git', '.svn', 'appdata', 'windows', 'program files', 'program files (x86)'
])

let running = false
let cancelFlag = false

function isRunning() {
  return running
}

function cancel() {
  cancelFlag = true
}

const tick = () => new Promise((r) => setImmediate(r))

/**
 * @param {string[]} roots 库根路径
 * @param {object} store
 * @param {(p:{scanned:number,found:number,current:string})=>void} onProgress
 */
async function scan(roots, store, onProgress) {
  if (running) return { ok: false, error: '扫描已在进行中' }
  running = true
  cancelFlag = false

  const entries = {}
  let scanned = 0
  let found = 0
  let lastReport = 0

  async function walk(dir, depth) {
    if (cancelFlag || found >= MAX_ENTRIES || depth > 24) return
    let dirents
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    scanned++
    if (Date.now() - lastReport > 250) {
      lastReport = Date.now()
      onProgress?.({ scanned, found, current: dir })
      await tick()
    }

    const subdirs = []
    for (const d of dirents) {
      if (cancelFlag) return
      if (d.name.startsWith('.')) continue
      const full = normPath(path.join(dir, d.name))
      if (d.isDirectory()) {
        if (SKIP_DIRS.has(d.name.toLowerCase())) continue
        subdirs.push(full)
      } else if (d.isFile()) {
        const ext = path.extname(d.name).toLowerCase()
        if (!isMediaExt(ext)) continue
        let st
        try {
          st = await fsp.stat(full)
        } catch {
          continue
        }
        entries[full] = {
          n: d.name,
          e: ext,
          k: kindOf(ext),
          s: st.size,
          m: st.mtimeMs,
          d: normPath(dir)
        }
        found++
        if (found >= MAX_ENTRIES) return
      }
    }
    for (const sd of subdirs) {
      if (cancelFlag) return
      await walk(sd, depth + 1)
    }
  }

  try {
    for (const root of roots) {
      if (cancelFlag) break
      await walk(normPath(root), 0)
    }
    if (!cancelFlag) {
      store.data.index.entries = entries
      store.data.index.scannedAt = { at: Date.now(), roots: [...roots], count: found }
      store.markDirty('index')
    }
    onProgress?.({ scanned, found, current: '', done: true })
    return { ok: true, scanned, found, canceled: cancelFlag }
  } finally {
    running = false
    cancelFlag = false
  }
}

/** 单目录递归收集（不写库），用于"包含子文件夹"的即时浏览 */
async function collectRecursive(dir, limit = 20000) {
  const out = []
  async function walk(d, depth) {
    if (out.length >= limit || depth > 16) return
    let dirents
    try {
      dirents = await fsp.readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    const subs = []
    for (const it of dirents) {
      if (it.name.startsWith('.')) continue
      const full = normPath(path.join(d, it.name))
      if (it.isDirectory()) {
        if (SKIP_DIRS.has(it.name.toLowerCase())) continue
        subs.push(full)
      } else if (it.isFile()) {
        const ext = path.extname(it.name).toLowerCase()
        if (!isMediaExt(ext)) continue
        let st
        try {
          st = await fsp.stat(full)
        } catch {
          continue
        }
        out.push({
          name: it.name,
          path: full,
          isDir: false,
          ext,
          kind: kindOf(ext),
          size: st.size,
          mtime: st.mtimeMs,
          ctime: st.birthtimeMs || st.ctimeMs
        })
        if (out.length >= limit) return
      }
    }
    for (const s of subs) {
      if (out.length >= limit) return
      await walk(s, depth + 1)
    }
  }
  await walk(normPath(dir), 0)
  return out
}

module.exports = { scan, cancel, isRunning, collectRecursive }
