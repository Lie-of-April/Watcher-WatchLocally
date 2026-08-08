'use strict'

/**
 * 集中式 JSON 数据库。
 * - 全量载入内存，读操作零 IO
 * - 写操作打脏标记，防抖批量落盘，先写临时文件再原子 rename，避免半截文件
 * - 路径统一规范化为小写盘符 + 正斜杠，作为主键
 */

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')

const FILES = {
  library: 'library.json',
  tags: 'tags.json',
  items: 'items.json',
  folders: 'folders.json',
  index: 'index.json',
  playlists: 'playlists.json'
}

const DEFAULTS = {
  library: {
    roots: [],
    settings: {
      theme: 'light',
      accent: '#0096fa',
      columnWidth: 240,
      gap: 12,
      sortBy: 'name',
      sortDir: 'asc',
      showFolders: true,
      folderFirst: true,
      autoCover: true,
      hoverPlayGif: true,
      hoverPlayVideo: true,
      recursive: false,
      zoomSensitivity: 1,
      loopAnim: true,
      videoSeek: 15,
      imageSampling: 'smooth',
      hoverPlayJpg: true,
      hoverPlayWebp: true,
      videoPreviewHold: 1500,
      lastDir: null
    }
  },
  tags: { tags: [], groups: [] },
  items: { items: {} },
  folders: { folders: {} },
  index: { entries: {}, scannedAt: {} },
  playlists: { lists: [] }
}

class Store {
  constructor(dataDir) {
    this.dataDir = dataDir
    this.data = {}
    this.dirty = new Set()
    this.timer = null
    this.writing = false
  }

  async init() {
    await fsp.mkdir(this.dataDir, { recursive: true })
    for (const key of Object.keys(FILES)) {
      this.data[key] = await this._read(key)
    }
    // 补齐后加的默认设置项
    this.data.library.settings = Object.assign(
      {},
      DEFAULTS.library.settings,
      this.data.library.settings || {}
    )
  }

  async _read(key) {
    const file = path.join(this.dataDir, FILES[key])
    try {
      const raw = await fsp.readFile(file, 'utf8')
      const parsed = JSON.parse(raw)
      return Object.assign(structuredClone(DEFAULTS[key]), parsed)
    } catch (e) {
      if (e.code !== 'ENOENT') {
        console.error(`[store] 读取 ${FILES[key]} 失败，回退默认值:`, e.message)
        // 损坏文件留个备份，避免用户数据被静默覆盖
        try {
          await fsp.rename(file, file + '.corrupt-' + Date.now())
        } catch {}
      }
      return structuredClone(DEFAULTS[key])
    }
  }

  markDirty(key) {
    this.dirty.add(key)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 400)
  }

  async flush() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.writing) {
      // 正在写盘时再排一次，保证最后状态一定落盘
      setTimeout(() => this.flush(), 200)
      return
    }
    const keys = [...this.dirty]
    if (!keys.length) return
    this.dirty.clear()
    this.writing = true
    try {
      for (const key of keys) {
        const file = path.join(this.dataDir, FILES[key])
        const tmp = file + '.tmp'
        await fsp.writeFile(tmp, JSON.stringify(this.data[key]), 'utf8')
        await fsp.rename(tmp, file)
      }
    } catch (e) {
      console.error('[store] 落盘失败:', e)
      keys.forEach((k) => this.dirty.add(k))
    } finally {
      this.writing = false
    }
  }

  flushSync() {
    for (const key of this.dirty) {
      try {
        const file = path.join(this.dataDir, FILES[key])
        fs.writeFileSync(file + '.tmp', JSON.stringify(this.data[key]), 'utf8')
        fs.renameSync(file + '.tmp', file)
      } catch (e) {
        console.error('[store] 同步落盘失败:', e)
      }
    }
    this.dirty.clear()
  }
}

/** 路径规范化：作为数据库主键使用，必须稳定 */
function normPath(p) {
  if (!p) return ''
  let s = String(p).replace(/\\/g, '/')
  // 去掉结尾斜杠（盘符根除外：D:/ 保留）
  if (s.length > 3 && s.endsWith('/')) s = s.slice(0, -1)
  // Windows 盘符统一大写，避免 d:/ 与 D:/ 视作两条记录
  if (/^[a-z]:/.test(s)) s = s[0].toUpperCase() + s.slice(1)
  return s
}

module.exports = { Store, normPath, DEFAULTS }
