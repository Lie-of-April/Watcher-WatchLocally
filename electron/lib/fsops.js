'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { shell } = require('electron')
const { kindOf, isMediaExt } = require('./consts')
const { normPath } = require('./store')

const INVALID_NAME = /[<>:"/\\|?*\x00-\x1f]/

/** 并发跑一批异步任务，避免上千个 stat 同时打爆句柄 */
async function pool(items, limit, worker) {
  const out = new Array(items.length)
  let i = 0
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++
      try {
        out[idx] = await worker(items[idx], idx)
      } catch {
        out[idx] = null
      }
    }
  })
  await Promise.all(runners)
  return out
}

async function listDir(dirPath, opts = {}) {
  const { includeOther = false } = opts
  const dir = normPath(dirPath)
  const dirents = await fsp.readdir(dir, { withFileTypes: true })

  const wanted = dirents.filter((d) => {
    if (d.name.startsWith('.')) return false
    if (d.isDirectory()) return true
    if (!d.isFile() && !d.isSymbolicLink()) return false
    const ext = path.extname(d.name)
    return includeOther ? true : isMediaExt(ext)
  })

  const entries = await pool(wanted, 32, async (d) => {
    const full = normPath(path.join(dir, d.name))
    let st
    try {
      st = await fsp.stat(full)
    } catch {
      return null
    }
    const isDir = st.isDirectory()
    const ext = isDir ? '' : path.extname(d.name).toLowerCase()
    return {
      name: d.name,
      path: full,
      isDir,
      ext,
      kind: isDir ? 'dir' : kindOf(ext),
      size: isDir ? 0 : st.size,
      mtime: st.mtimeMs,
      ctime: st.birthtimeMs || st.ctimeMs
    }
  })

  return {
    path: dir,
    parent: parentOf(dir),
    entries: entries.filter(Boolean)
  }
}

function parentOf(p) {
  const dir = normPath(p)
  const parent = normPath(path.dirname(dir))
  if (!parent || parent === dir) return null
  return parent
}

/** 只列子文件夹，供目录树按需展开 */
async function listSubdirs(dirPath) {
  const dir = normPath(dirPath)
  let dirents
  try {
    dirents = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const dirs = dirents.filter((d) => d.isDirectory() && !d.name.startsWith('.'))
  const out = await pool(dirs, 24, async (d) => {
    const full = normPath(path.join(dir, d.name))
    let hasChild = false
    let mtime = 0
    try {
      const sub = await fsp.readdir(full, { withFileTypes: true })
      hasChild = sub.some((s) => s.isDirectory() && !s.name.startsWith('.'))
    } catch {
      hasChild = false
    }
    try {
      const st = await fsp.stat(full)
      mtime = st.mtimeMs
    } catch {
      mtime = 0
    }
    return { name: d.name, path: full, isDir: true, hasChild, mtime }
  })
  return out.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
}

/** 找文件夹里第一张可作封面的图（浅层优先，找不到再下探一层） */
async function findAutoCover(dirPath, depth = 2) {
  const dir = normPath(dirPath)
  let dirents
  try {
    dirents = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
  const files = dirents
    .filter((d) => d.isFile() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }))

  for (const name of files) {
    const k = kindOf(path.extname(name))
    if (k === 'image' || k === 'gif') return normPath(path.join(dir, name))
  }
  // 浅层没图，退而求其次找视频
  for (const name of files) {
    if (kindOf(path.extname(name)) === 'video') return normPath(path.join(dir, name))
  }
  if (depth <= 1) return null
  const subs = dirents
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }))
    .slice(0, 8)
  for (const sub of subs) {
    const found = await findAutoCover(path.join(dir, sub), depth - 1)
    if (found) return found
  }
  return null
}

/** 套图封面：取子文件夹里排在最前面的那张媒体（默认按名称），返回其信息与总数 */
async function firstImage(dirPath, sortBy = 'name') {
  const dir = normPath(dirPath)
  let dirents
  try {
    dirents = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
  const names = dirents.filter((d) => d.isFile() && !d.name.startsWith('.')).map((d) => d.name)
  const media = await pool(names, 32, async (name) => {
    const ext = path.extname(name).toLowerCase()
    if (!isMediaExt(ext)) return null
    const kind = kindOf(ext)
    let st
    try {
      st = await fsp.stat(normPath(path.join(dir, name)))
    } catch {
      return null
    }
    return {
      name,
      ext,
      kind,
      size: st.size,
      mtime: st.mtimeMs,
      ctime: st.birthtimeMs || st.ctimeMs
    }
  })
  const list = media.filter(Boolean)
  if (!list.length) return null
  const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
  list.sort((a, b) => {
    let r = 0
    if (sortBy === 'mtime') r = a.mtime - b.mtime
    else if (sortBy === 'ctime') r = a.ctime - b.ctime
    else if (sortBy === 'size') r = a.size - b.size
    else r = collator.compare(a.name, b.name)
    if (r === 0) r = collator.compare(a.name, b.name)
    return r
  })
  const first = list[0]
  return {
    name: first.name,
    path: normPath(path.join(dir, first.name)),
    ext: first.ext,
    kind: first.kind,
    size: first.size,
    mtime: first.mtime,
    ctime: first.ctime,
    count: list.length
  }
}

/** 统计文件夹内媒体数量（只看一层，快速） */
async function countMedia(dirPath) {
  try {
    const dirents = await fsp.readdir(normPath(dirPath), { withFileTypes: true })
    let files = 0
    let dirs = 0
    for (const d of dirents) {
      if (d.name.startsWith('.')) continue
      if (d.isDirectory()) dirs++
      else if (isMediaExt(path.extname(d.name))) files++
    }
    return { files, dirs }
  } catch {
    return { files: 0, dirs: 0 }
  }
}

async function exists(p) {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}

/** 目标已存在时自动追加 (1)(2)... 不覆盖用户文件 */
async function uniqueTarget(dir, name) {
  let target = path.join(dir, name)
  if (!(await exists(target))) return normPath(target)
  const ext = path.extname(name)
  const base = path.basename(name, ext)
  for (let i = 1; i < 10000; i++) {
    target = path.join(dir, `${base} (${i})${ext}`)
    if (!(await exists(target))) return normPath(target)
  }
  throw new Error('无法生成不冲突的文件名')
}

async function createFolder(parentDir, name) {
  if (!name || INVALID_NAME.test(name)) throw new Error('文件夹名含非法字符')
  const target = await uniqueTarget(normPath(parentDir), name.trim())
  await fsp.mkdir(target, { recursive: false })
  return target
}

async function renameEntry(oldPath, newName) {
  if (!newName || INVALID_NAME.test(newName)) throw new Error('名称含非法字符')
  const src = normPath(oldPath)
  const dir = path.dirname(src)
  const target = normPath(path.join(dir, newName.trim()))
  if (target === src) return src
  if (await exists(target)) throw new Error('同名文件已存在')
  await fsp.rename(src, target)
  return target
}

function isSubPath(parent, child) {
  const p = normPath(parent).toLowerCase()
  const c = normPath(child).toLowerCase()
  return c === p || c.startsWith(p + '/')
}

/** 跨盘 rename 会抛 EXDEV，此时退化为复制 + 删除 */
async function moveOne(src, targetDir) {
  const name = path.basename(src)
  const target = await uniqueTarget(targetDir, name)
  try {
    await fsp.rename(src, target)
  } catch (e) {
    if (e.code === 'EXDEV') {
      await fsp.cp(src, target, { recursive: true })
      await fsp.rm(src, { recursive: true, force: true })
    } else {
      throw e
    }
  }
  return target
}

async function movePaths(paths, targetDir) {
  const dest = normPath(targetDir)
  const st = await fsp.stat(dest)
  if (!st.isDirectory()) throw new Error('目标不是文件夹')

  const results = []
  for (const raw of paths) {
    const src = normPath(raw)
    try {
      if (isSubPath(src, dest)) throw new Error('不能把文件夹移动到它自己内部')
      if (normPath(path.dirname(src)) === dest) {
        results.push({ src, ok: true, skipped: true, target: src })
        continue
      }
      const target = await moveOne(src, dest)
      results.push({ src, ok: true, target })
    } catch (e) {
      results.push({ src, ok: false, error: e.message })
    }
  }
  return results
}

async function copyPaths(paths, targetDir) {
  const dest = normPath(targetDir)
  const results = []
  for (const raw of paths) {
    const src = normPath(raw)
    try {
      if (isSubPath(src, dest)) throw new Error('不能把文件夹复制到它自己内部')
      const target = await uniqueTarget(dest, path.basename(src))
      await fsp.cp(src, target, { recursive: true })
      results.push({ src, ok: true, target })
    } catch (e) {
      results.push({ src, ok: false, error: e.message })
    }
  }
  return results
}

/** 一律走系统回收站，绝不硬删——误删可以救回来 */
async function trashPaths(paths) {
  const results = []
  for (const raw of paths) {
    const p = normPath(raw)
    try {
      await shell.trashItem(path.normalize(p))
      results.push({ src: p, ok: true })
    } catch (e) {
      results.push({ src: p, ok: false, error: e.message })
    }
  }
  return results
}

function revealInExplorer(p) {
  shell.showItemInFolder(path.normalize(normPath(p)))
}

async function openExternal(p) {
  const r = await shell.openPath(path.normalize(normPath(p)))
  if (r) throw new Error(r)
}

function listDrives() {
  const drives = []
  if (process.platform === 'win32') {
    for (let c = 65; c <= 90; c++) {
      const letter = String.fromCharCode(c)
      const root = `${letter}:/`
      try {
        fs.accessSync(root)
        drives.push({ name: `${letter}:`, path: root, isDir: true })
      } catch {}
    }
  } else {
    drives.push({ name: '/', path: '/', isDir: true })
  }
  const home = normPath(os.homedir())
  return { drives, home }
}

module.exports = {
  listDir,
  listSubdirs,
  parentOf,
  findAutoCover,
  firstImage,
  countMedia,
  createFolder,
  renameEntry,
  movePaths,
  copyPaths,
  trashPaths,
  revealInExplorer,
  openExternal,
  listDrives,
  exists,
  pool
}
