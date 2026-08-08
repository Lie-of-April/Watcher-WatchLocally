'use strict'

const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { normPath } = require('./store')
const { kindOf, isMediaExt } = require('./consts')

const TAG_COLORS = [
  '#e05263', '#e07a3f', '#d9a441', '#6fa84f', '#3f9e8c',
  '#4a8fd4', '#6b6fd4', '#9b5fc0', '#c25f9e', '#7a8794'
]

function uid(prefix = 'id') {
  return prefix + '_' + crypto.randomBytes(6).toString('hex')
}

function createDbApi(store) {
  const D = () => store.data

  /* ---------------- 库根 ---------------- */
  function getLibrary() {
    return { roots: D().library.roots, settings: D().library.settings }
  }

  function addRoot(p, name) {
    const np = normPath(p)
    const roots = D().library.roots
    if (roots.some((r) => normPath(r.path) === np)) return roots
    roots.push({
      id: uid('root'),
      path: np,
      name: name || path.basename(np) || np,
      addedAt: Date.now()
    })
    store.markDirty('library')
    return roots
  }

  function removeRoot(id) {
    const lib = D().library
    lib.roots = lib.roots.filter((r) => r.id !== id)
    store.markDirty('library')
    return lib.roots
  }

  function renameRoot(id, name) {
    const r = D().library.roots.find((x) => x.id === id)
    if (r) {
      r.name = name
      store.markDirty('library')
    }
    return D().library.roots
  }

  function setSettings(patch) {
    Object.assign(D().library.settings, patch || {})
    store.markDirty('library')
    return D().library.settings
  }

  /* ---------------- 标签 ---------------- */
  function getTags() {
    const { tags, groups } = D()
    const counts = countTagUsage()
    return {
      tags: tags.tags.map((t) => ({ ...t, count: counts[t.id] || 0 })),
      groups: tags.groups
    }
  }

  function countTagUsage() {
    const counts = {}
    for (const meta of Object.values(D().items.items)) {
      for (const id of meta.tags || []) counts[id] = (counts[id] || 0) + 1
    }
    for (const meta of Object.values(D().folders.folders)) {
      for (const id of meta.tags || []) counts[id] = (counts[id] || 0) + 1
    }
    return counts
  }

  function createTag({ name, color, groupId }) {
    const n = String(name || '').trim()
    if (!n) throw new Error('标签名不能为空')
    const exist = D().tags.tags.find((t) => t.name.toLowerCase() === n.toLowerCase())
    if (exist) return exist
    const tag = {
      id: uid('tag'),
      name: n,
      color: color || TAG_COLORS[D().tags.tags.length % TAG_COLORS.length],
      groupId: groupId || null,
      createdAt: Date.now()
    }
    D().tags.tags.push(tag)
    store.markDirty('tags')
    return tag
  }

  function updateTag(id, patch) {
    const t = D().tags.tags.find((x) => x.id === id)
    if (!t) throw new Error('标签不存在')
    if (patch.name !== undefined) {
      const n = String(patch.name).trim()
      if (!n) throw new Error('标签名不能为空')
      t.name = n
    }
    if (patch.color !== undefined) t.color = patch.color
    if (patch.groupId !== undefined) t.groupId = patch.groupId || null
    store.markDirty('tags')
    return t
  }

  /** 删标签必须同时清掉所有引用，否则会留下指向空标签的脏数据 */
  function deleteTag(id) {
    D().tags.tags = D().tags.tags.filter((t) => t.id !== id)
    let touchedItems = false
    let touchedFolders = false
    for (const meta of Object.values(D().items.items)) {
      if (meta.tags?.includes(id)) {
        meta.tags = meta.tags.filter((t) => t !== id)
        touchedItems = true
      }
    }
    for (const meta of Object.values(D().folders.folders)) {
      if (meta.tags?.includes(id)) {
        meta.tags = meta.tags.filter((t) => t !== id)
        touchedFolders = true
      }
    }
    store.markDirty('tags')
    if (touchedItems) store.markDirty('items')
    if (touchedFolders) store.markDirty('folders')
    return true
  }

  function createTagGroup({ name, color }) {
    const g = {
      id: uid('grp'),
      name: String(name || '新分组').trim(),
      color: color || '#7a8794',
      order: D().tags.groups.length
    }
    D().tags.groups.push(g)
    store.markDirty('tags')
    return g
  }

  function updateTagGroup(id, patch) {
    const g = D().tags.groups.find((x) => x.id === id)
    if (!g) throw new Error('分组不存在')
    Object.assign(g, patch)
    store.markDirty('tags')
    return g
  }

  function deleteTagGroup(id) {
    D().tags.groups = D().tags.groups.filter((g) => g.id !== id)
    for (const t of D().tags.tags) if (t.groupId === id) t.groupId = null
    store.markDirty('tags')
    return true
  }

  /* ---------------- 条目元数据 ---------------- */
  function ensureItem(p) {
    const np = normPath(p)
    let m = D().items.items[np]
    if (!m) {
      m = { path: np, tags: [], favorite: false, rating: 0, note: '', updatedAt: Date.now() }
      D().items.items[np] = m
    }
    if (!Array.isArray(m.tags)) m.tags = []
    return m
  }

  function ensureFolder(p) {
    const np = normPath(p)
    let m = D().folders.folders[np]
    if (!m) {
      m = { path: np, tags: [], cover: null, coverMode: 'auto', note: '', updatedAt: Date.now() }
      D().folders.folders[np] = m
    }
    if (!Array.isArray(m.tags)) m.tags = []
    return m
  }

  function getMetaFor(paths) {
    const items = {}
    const folders = {}
    for (const raw of paths || []) {
      const np = normPath(raw)
      if (D().items.items[np]) items[np] = D().items.items[np]
      if (D().folders.folders[np]) folders[np] = D().folders.folders[np]
    }
    return { items, folders }
  }

  function setItemTags(p, tagIds) {
    const m = ensureItem(p)
    m.tags = [...new Set(tagIds || [])]
    m.updatedAt = Date.now()
    store.markDirty('items')
    return m
  }

  function setFolderTags(p, tagIds) {
    const m = ensureFolder(p)
    m.tags = [...new Set(tagIds || [])]
    m.updatedAt = Date.now()
    store.markDirty('items')
    store.markDirty('folders')
    return m
  }

  /** 批量给多个目标加/去标签，isDir 由调用方逐条给出 */
  function bulkTag(targets, tagIds, mode = 'add') {
    const ids = tagIds || []
    let items = false
    let folders = false
    for (const t of targets || []) {
      const p = typeof t === 'string' ? t : t.path
      const isDir = typeof t === 'string' ? false : !!t.isDir
      const m = isDir ? ensureFolder(p) : ensureItem(p)
      if (mode === 'add') {
        m.tags = [...new Set([...(m.tags || []), ...ids])]
      } else if (mode === 'remove') {
        m.tags = (m.tags || []).filter((x) => !ids.includes(x))
      } else if (mode === 'toggle') {
        for (const id of ids) {
          if (m.tags.includes(id)) m.tags = m.tags.filter((x) => x !== id)
          else m.tags.push(id)
        }
      }
      m.updatedAt = Date.now()
      if (isDir) folders = true
      else items = true
    }
    if (items) store.markDirty('items')
    if (folders) store.markDirty('folders')
    return true
  }

  function setFavorite(p, isDir, value) {
    const m = isDir ? ensureFolder(p) : ensureItem(p)
    m.favorite = !!value
    m.updatedAt = Date.now()
    store.markDirty(isDir ? 'folders' : 'items')
    return m
  }

  function setRating(p, isDir, value) {
    const m = isDir ? ensureFolder(p) : ensureItem(p)
    m.rating = Math.max(0, Math.min(5, Number(value) || 0))
    m.updatedAt = Date.now()
    store.markDirty(isDir ? 'folders' : 'items')
    return m
  }

  function setNote(p, isDir, note) {
    const m = isDir ? ensureFolder(p) : ensureItem(p)
    m.note = String(note || '')
    m.updatedAt = Date.now()
    store.markDirty(isDir ? 'folders' : 'items')
    return m
  }

  /* ---------------- 文件夹封面 ---------------- */
  function setFolderCover(folderPath, coverPath) {
    const m = ensureFolder(folderPath)
    m.cover = coverPath ? normPath(coverPath) : null
    m.coverMode = coverPath ? 'manual' : 'auto'
    m.updatedAt = Date.now()
    store.markDirty('folders')
    return m
  }

  /** 把文件夹标记为"套图"（album）或恢复为普通文件夹，并记录套图排序方式 */
  function setFolderView(folderPath, view, albumSort) {
    const m = ensureFolder(folderPath)
    m.view = view === 'album' ? 'album' : 'normal'
    if (albumSort) m.albumSort = albumSort
    m.updatedAt = Date.now()
    store.markDirty('folders')
    return m
  }

  function getFolderMetaMap(paths) {
    const out = {}
    for (const p of paths || []) {
      const np = normPath(p)
      const m = D().folders.folders[np]
      if (m) out[np] = m
    }
    return out
  }

  /* ---------------- 元数据跟随文件移动 ---------------- */
  /**
   * 文件/文件夹改名或移动后调用。
   * 文件夹要连同其下所有子孙记录一起改键，否则整理一次目录，标签全成孤儿。
   */
  function migrateMeta(oldPath, newPath) {
    const from = normPath(oldPath)
    const to = normPath(newPath)
    if (!from || !to || from === to) return 0
    const fromLower = from.toLowerCase()
    let moved = 0

    const remap = (bucket, key) => {
      const src = D()[bucket][key]
      const out = {}
      let changed = false
      for (const [k, v] of Object.entries(src)) {
        const kl = k.toLowerCase()
        let nk = k
        if (kl === fromLower) {
          nk = to
        } else if (kl.startsWith(fromLower + '/')) {
          nk = to + k.slice(from.length)
        }
        if (nk !== k) {
          changed = true
          moved++
          out[nk] = { ...v, path: nk }
        } else {
          out[k] = v
        }
      }
      if (changed) {
        D()[bucket][key] = out
        store.markDirty(bucket)
      }
    }

    remap('items', 'items')
    remap('folders', 'folders')

    // 封面指向的图片也可能一起被搬走了
    let coverChanged = false
    for (const meta of Object.values(D().folders.folders)) {
      if (!meta.cover) continue
      const cl = meta.cover.toLowerCase()
      if (cl === fromLower) {
        meta.cover = to
        coverChanged = true
      } else if (cl.startsWith(fromLower + '/')) {
        meta.cover = to + meta.cover.slice(from.length)
        coverChanged = true
      }
    }
    if (coverChanged) store.markDirty('folders')

    return moved
  }

  /* ---------------- 搜索 ---------------- */
  async function search(opts = {}) {
    const {
      query = '',
      tagIds = [],
      tagMode = 'and',
      untaggedOnly = false,
      kinds = [],
      scopeDir = null,
      favoriteOnly = false,
      minRating = 0,
      includeFolders = true,
      limit = 5000
    } = opts

    const q = String(query).trim().toLowerCase()
    const scope = scopeDir ? normPath(scopeDir).toLowerCase() : null
    const inScope = (p) => !scope || p.toLowerCase() === scope || p.toLowerCase().startsWith(scope + '/')

    // 评分筛选：minRating === -1 表示"仅未评分"；-2 表示"已评分(任意>0)"；>0 表示"至少 N 星"；0 不限制
    const ratingOk = (rating) => {
      const r = rating || 0
      if (minRating === -1) return r === 0
      if (minRating === -2) return r > 0
      if (minRating > 0) return r >= minRating
      return true
    }

    const matchTags = (metaTags) => {
      const tags = metaTags || []
      if (untaggedOnly) return tags.length === 0
      if (!tagIds.length) return true
      if (tagMode === 'or') return tagIds.some((id) => tags.includes(id))
      if (tagMode === 'not') return !tagIds.some((id) => tags.includes(id))
      return tagIds.every((id) => tags.includes(id))
    }

    const results = []
    const seen = new Set()
    const folders = []

    const pushFile = async (p, meta, cached) => {
      if (results.length >= limit) return
      const np = normPath(p)
      if (seen.has(np)) return
      const ext = path.extname(np).toLowerCase()
      const kind = kindOf(ext)
      if (kinds.length && !kinds.includes(kind)) return
      if (q && !path.basename(np).toLowerCase().includes(q)) return
      if (!inScope(np)) return
      if (favoriteOnly && !meta?.favorite) return
      if (!ratingOk(meta?.rating)) return

      let size = cached?.s
      let mtime = cached?.m
      if (size === undefined || mtime === undefined) {
        try {
          const st = await fsp.stat(np)
          if (!st.isFile()) return
          size = st.size
          mtime = st.mtimeMs
        } catch {
          return
        }
      }
      seen.add(np)
      results.push({
        name: path.basename(np),
        path: np,
        isDir: false,
        ext,
        kind,
        size,
        mtime,
        ctime: mtime
      })
    }

    // 限定在当前文件夹：直接扫磁盘上的真实文件（含从未打开/未索引过的），
    // 标签/评分/收藏等元数据仍取自库（没有则按「无标签、0 星、未收藏」处理）。
    // 这样搜索会覆盖当前文件夹下的全部媒体文件，而不只是已索引的那部分。
    if (scope) {
      const root = normPath(scopeDir)
      const dirs = []
      const walk = async (dir) => {
        if (results.length >= limit) return
        let list
        try {
          list = await fsp.readdir(dir, { withFileTypes: true })
        } catch {
          return
        }
        for (const ent of list) {
          const full = path.join(dir, ent.name)
          const np = normPath(full)
          if (ent.isDirectory()) {
            dirs.push(np)
            await walk(np)
          } else if (ent.isFile()) {
            const ext = path.extname(np).toLowerCase()
            if (!isMediaExt(ext)) continue
            const meta = D().items.items[np]
            const kind = kindOf(ext)
            if (kinds.length && !kinds.includes(kind)) continue
            if (q && !path.basename(np).toLowerCase().includes(q)) continue
            if (!matchTags(meta?.tags)) continue
            if (favoriteOnly && !meta?.favorite) continue
            if (!ratingOk(meta?.rating)) continue
            try {
              const st = await fsp.stat(np)
              if (!st.isFile()) continue
              if (seen.has(np)) continue
              seen.add(np)
              results.push({
                name: path.basename(np),
                path: np,
                isDir: false,
                ext,
                kind,
                size: st.size,
                mtime: st.mtimeMs,
                ctime: st.mtimeMs
              })
            } catch {}
          }
        }
      }
      await walk(root)
      if (includeFolders) {
        for (const dp of dirs) {
          if (folders.length >= 500) break
          const meta = D().folders.folders[dp]
          if (!matchTags(meta?.tags)) continue
          if (q && !path.basename(dp).toLowerCase().includes(q)) continue
          if (favoriteOnly && !meta?.favorite) continue
          if (!ratingOk(meta?.rating)) continue
          try {
            const st = await fsp.stat(dp)
            if (!st.isDirectory()) continue
            folders.push({
              name: path.basename(dp),
              path: dp,
              isDir: true,
              ext: '',
              kind: 'dir',
              size: 0,
              mtime: st.mtimeMs,
              ctime: st.birthtimeMs || st.ctimeMs
            })
          } catch {}
        }
      }
      return { entries: [...folders, ...results], truncated: results.length >= limit }
    }

    // 有标签条件时，候选集来自已打标签的记录（数量小，快）
    // 无标签条件时，才需要扫全局索引
    const needIndexScan = !tagIds.length && !untaggedOnly && !favoriteOnly && minRating <= 0

    if (!needIndexScan) {
      for (const [p, meta] of Object.entries(D().items.items)) {
        if (!matchTags(meta.tags)) continue
        const cached = D().index.entries[p]
        await pushFile(p, meta, cached)
      }
      if (untaggedOnly) {
        // 未打标签的文件不在 items 里，得从索引补
        for (const [p, cached] of Object.entries(D().index.entries)) {
          if (D().items.items[p]?.tags?.length) continue
          if (favoriteOnly && !D().items.items[p]?.favorite) continue
          if (!ratingOk(D().items.items[p]?.rating)) continue
          await pushFile(p, D().items.items[p], cached)
        }
      }
    } else {
      for (const [p, cached] of Object.entries(D().index.entries)) {
        await pushFile(p, D().items.items[p], cached)
      }
    }

    if (includeFolders) {
      for (const [p, meta] of Object.entries(D().folders.folders)) {
        if (folders.length >= 500) break
        if (!matchTags(meta.tags)) continue
        if (q && !path.basename(p).toLowerCase().includes(q)) continue
        if (!inScope(p)) continue
        if (favoriteOnly && !meta.favorite) continue
        if (!ratingOk(meta.rating)) continue
        try {
          const st = await fsp.stat(p)
          if (!st.isDirectory()) continue
          folders.push({
            name: path.basename(p),
            path: normPath(p),
            isDir: true,
            ext: '',
            kind: 'dir',
            size: 0,
            mtime: st.mtimeMs,
            ctime: st.birthtimeMs || st.ctimeMs
          })
        } catch {}
      }
    }

    return { entries: [...folders, ...results], truncated: results.length >= limit }
  }

  /** 清理指向已不存在文件的元数据 */
  async function pruneMissing() {
    let removed = 0
    for (const p of Object.keys(D().items.items)) {
      try {
        await fsp.access(p)
      } catch {
        delete D().items.items[p]
        removed++
      }
    }
    for (const p of Object.keys(D().folders.folders)) {
      try {
        await fsp.access(p)
      } catch {
        delete D().folders.folders[p]
        removed++
      }
    }
    if (removed) {
      store.markDirty('items')
      store.markDirty('folders')
    }
    return removed
  }

  function exportData() {
    return {
      version: 1,
      exportedAt: Date.now(),
      library: D().library,
      tags: D().tags,
      items: D().items,
      folders: D().folders
    }
  }

  function importData(payload, merge = true) {
    if (!payload || typeof payload !== 'object') throw new Error('数据格式无效')
    if (merge) {
      const existingNames = new Set(D().tags.tags.map((t) => t.name.toLowerCase()))
      const idMap = {}
      for (const t of payload.tags?.tags || []) {
        const dup = D().tags.tags.find((x) => x.name.toLowerCase() === t.name.toLowerCase())
        if (dup) {
          idMap[t.id] = dup.id
        } else {
          const nt = { ...t }
          D().tags.tags.push(nt)
          existingNames.add(nt.name.toLowerCase())
          idMap[t.id] = nt.id
        }
      }
      for (const g of payload.tags?.groups || []) {
        if (!D().tags.groups.some((x) => x.id === g.id)) D().tags.groups.push(g)
      }
      for (const [p, m] of Object.entries(payload.items?.items || {})) {
        const cur = ensureItem(p)
        cur.tags = [...new Set([...cur.tags, ...(m.tags || []).map((id) => idMap[id] || id)])]
        cur.favorite = cur.favorite || m.favorite
        cur.rating = Math.max(cur.rating || 0, m.rating || 0)
        cur.note = cur.note || m.note
      }
      for (const [p, m] of Object.entries(payload.folders?.folders || {})) {
        const cur = ensureFolder(p)
        cur.tags = [...new Set([...cur.tags, ...(m.tags || []).map((id) => idMap[id] || id)])]
        cur.cover = cur.cover || m.cover
        if (m.cover) cur.coverMode = m.coverMode || 'manual'
      }
    } else {
      if (payload.tags) D().tags = payload.tags
      if (payload.items) D().items = payload.items
      if (payload.folders) D().folders = payload.folders
      if (payload.library?.roots) D().library.roots = payload.library.roots
    }
    store.markDirty('tags')
    store.markDirty('items')
    store.markDirty('folders')
    store.markDirty('library')
    return true
  }

  /* ---------------- 播放列表（不改变文件结构） ---------------- */
  function listPlaylists() {
    return D().playlists.lists
  }

  function createPlaylist({ name }) {
    const p = {
      id: uid('pl'),
      name: String(name || '新播放列表').trim() || '新播放列表',
      items: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    D().playlists.lists.push(p)
    store.markDirty('playlists')
    return p
  }

  function renamePlaylist(id, name) {
    const p = D().playlists.lists.find((x) => x.id === id)
    if (!p) throw new Error('播放列表不存在')
    p.name = String(name || '').trim() || p.name
    p.updatedAt = Date.now()
    store.markDirty('playlists')
    return p
  }

  function deletePlaylist(id) {
    D().playlists.lists = D().playlists.lists.filter((x) => x.id !== id)
    store.markDirty('playlists')
    return true
  }

  function getPlaylist(id) {
    return D().playlists.lists.find((x) => x.id === id) || null
  }

  function touchPlaylist(p) {
    p.updatedAt = Date.now()
    store.markDirty('playlists')
  }

  function addToPlaylist(id, paths) {
    const p = getPlaylist(id)
    if (!p) throw new Error('播放列表不存在')
    const set = new Set(p.items)
    let added = 0
    for (const raw of paths || []) {
      const np = normPath(raw)
      if (!set.has(np)) {
        set.add(np)
        p.items.push(np)
        added++
      }
    }
    if (added) touchPlaylist(p)
    return p
  }

  function removePlaylistItem(id, index) {
    const p = getPlaylist(id)
    if (!p) throw new Error('播放列表不存在')
    if (index < 0 || index >= p.items.length) return p
    p.items.splice(index, 1)
    touchPlaylist(p)
    return p
  }

  function reorderPlaylist(id, from, to) {
    const p = getPlaylist(id)
    if (!p) throw new Error('播放列表不存在')
    if (from < 0 || from >= p.items.length) return p
    const clamped = Math.max(0, Math.min(p.items.length - 1, to))
    const [m] = p.items.splice(from, 1)
    p.items.splice(clamped, 0, m)
    touchPlaylist(p)
    return p
  }

  function clearPlaylist(id) {
    const p = getPlaylist(id)
    if (!p) throw new Error('播放列表不存在')
    p.items = []
    touchPlaylist(p)
    return p
  }

  return {
    getLibrary, addRoot, removeRoot, renameRoot, setSettings,
    getTags, createTag, updateTag, deleteTag,
    createTagGroup, updateTagGroup, deleteTagGroup,
    getMetaFor, setItemTags, setFolderTags, bulkTag,
    setFavorite, setRating, setNote,
    setFolderCover, setFolderView, getFolderMetaMap,
    migrateMeta, search, pruneMissing,
    exportData, importData,
    listPlaylists, createPlaylist, renamePlaylist, deletePlaylist,
    getPlaylist, addToPlaylist, removePlaylistItem, reorderPlaylist, clearPlaylist,
    TAG_COLORS
  }
}

module.exports = { createDbApi, TAG_COLORS }
