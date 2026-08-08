'use strict'

const { ipcMain, dialog, BrowserWindow } = require('electron')
const fsp = require('node:fs/promises')
const path = require('node:path')
const fsops = require('./lib/fsops')
const thumbs = require('./lib/thumbs')
const animflag = require('./lib/animflag')
const exif = require('./lib/exif')
const indexer = require('./lib/indexer')
const { normPath } = require('./lib/store')

/** 统一包一层：任何 handler 抛错都变成 {ok:false,error}，渲染层不用到处 try/catch */
function ok(data) {
  return { ok: true, data }
}
function fail(e) {
  const msg = e && e.message ? e.message : String(e)
  return { ok: false, error: msg }
}
function wrap(fn) {
  return async (_event, payload) => {
    try {
      return ok(await fn(payload || {}))
    } catch (e) {
      console.error('[ipc]', e)
      return fail(e)
    }
  }
}

function registerIpc({ store, db, getWindow }) {
  const H = (channel, fn) => ipcMain.handle(channel, wrap(fn))

  /* ---------------- 窗口 ---------------- */
  H('win:minimize', () => {
    getWindow()?.minimize()
    return true
  })
  H('win:toggleMaximize', () => {
    const w = getWindow()
    if (!w) return false
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
    return w.isMaximized()
  })
  H('win:close', () => {
    getWindow()?.close()
    return true
  })
  H('win:isMaximized', () => !!getWindow()?.isMaximized())
  H('win:toggleFullscreen', () => {
    const w = getWindow()
    if (!w) return false
    w.setFullScreen(!w.isFullScreen())
    return w.isFullScreen()
  })

  /* ---------------- 文件系统 ---------------- */
  H('fs:listDir', ({ dirPath, opts }) => fsops.listDir(dirPath, opts))
  H('fs:listRecursive', ({ dirPath, limit }) => indexer.collectRecursive(dirPath, limit || 20000))
  H('fs:listSubdirs', ({ dirPath }) => fsops.listSubdirs(dirPath))
  H('fs:listDrives', () => fsops.listDrives())
  H('fs:autoCover', ({ dirPath }) => fsops.findAutoCover(dirPath))
  H('fs:firstImage', ({ dirPath, sortBy }) => fsops.firstImage(dirPath, sortBy))
  H('fs:countMedia', ({ dirPath }) => fsops.countMedia(dirPath))

  H('fs:createFolder', ({ parentDir, name }) => fsops.createFolder(parentDir, name))

  H('fs:rename', async ({ target, newName }) => {
    const newPath = await fsops.renameEntry(target, newName)
    db.migrateMeta(target, newPath)
    return newPath
  })

  H('fs:move', async ({ paths, targetDir }) => {
    const results = await fsops.movePaths(paths, targetDir)
    for (const r of results) {
      if (r.ok && !r.skipped && r.target) db.migrateMeta(r.src, r.target)
    }
    return results
  })

  H('fs:copy', ({ paths, targetDir }) => fsops.copyPaths(paths, targetDir))

  H('fs:trash', async ({ paths }) => {
    const results = await fsops.trashPaths(paths)
    return results
  })

  H('fs:reveal', ({ target }) => {
    fsops.revealInExplorer(target)
    return true
  })
  H('fs:openExternal', ({ target }) => fsops.openExternal(target))
  H('fs:exif', ({ target }) => exif.read(target))

  H('fs:pickFolder', async () => {
    const w = getWindow()
    const r = await dialog.showOpenDialog(w, {
      title: '选择文件夹',
      properties: ['openDirectory', 'createDirectory']
    })
    if (r.canceled || !r.filePaths.length) return null
    return normPath(r.filePaths[0])
  })

  H('fs:pickFile', async ({ filters }) => {
    const w = getWindow()
    const r = await dialog.showOpenDialog(w, {
      title: '选择文件',
      properties: ['openFile'],
      filters: filters || [
        { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif'] }
      ]
    })
    if (r.canceled || !r.filePaths.length) return null
    return normPath(r.filePaths[0])
  })

  H('fs:saveJson', async ({ defaultName, data }) => {
    const w = getWindow()
    const r = await dialog.showSaveDialog(w, {
      title: '导出数据',
      defaultPath: defaultName || 'watcher-backup.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePath) return null
    await fsp.writeFile(r.filePath, JSON.stringify(data, null, 2), 'utf8')
    return normPath(r.filePath)
  })

  H('fs:openJson', async () => {
    const w = getWindow()
    const r = await dialog.showOpenDialog(w, {
      title: '导入数据',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePaths.length) return null
    const raw = await fsp.readFile(r.filePaths[0], 'utf8')
    return JSON.parse(raw)
  })

  /* ---------------- 数据库 ---------------- */
  H('db:getLibrary', () => db.getLibrary())
  H('db:addRoot', ({ path: p, name }) => db.addRoot(p, name))
  H('db:removeRoot', ({ id }) => db.removeRoot(id))
  H('db:renameRoot', ({ id, name }) => db.renameRoot(id, name))
  H('db:setSettings', ({ patch }) => db.setSettings(patch))

  H('db:getTags', () => db.getTags())
  H('db:createTag', (p) => db.createTag(p))
  H('db:updateTag', ({ id, patch }) => db.updateTag(id, patch))
  H('db:deleteTag', ({ id }) => db.deleteTag(id))
  H('db:createTagGroup', (p) => db.createTagGroup(p))
  H('db:updateTagGroup', ({ id, patch }) => db.updateTagGroup(id, patch))
  H('db:deleteTagGroup', ({ id }) => db.deleteTagGroup(id))

  H('db:getMetaFor', ({ paths }) => db.getMetaFor(paths))
  H('db:setItemTags', ({ path: p, tagIds }) => db.setItemTags(p, tagIds))
  H('db:setFolderTags', ({ path: p, tagIds }) => db.setFolderTags(p, tagIds))
  H('db:bulkTag', ({ targets, tagIds, mode }) => db.bulkTag(targets, tagIds, mode))
  H('db:setFavorite', ({ path: p, isDir, value }) => db.setFavorite(p, isDir, value))
  H('db:setRating', ({ path: p, isDir, value }) => db.setRating(p, isDir, value))
  H('db:setNote', ({ path: p, isDir, note }) => db.setNote(p, isDir, note))
  H('db:setFolderCover', ({ folderPath, coverPath }) => db.setFolderCover(folderPath, coverPath))
  H('db:setFolderView', ({ folderPath, view, albumSort }) => db.setFolderView(folderPath, view, albumSort))
  H('db:search', (opts) => db.search(opts))
  H('db:pruneMissing', () => db.pruneMissing())
  H('db:exportData', () => db.exportData())
  H('db:importData', ({ payload, merge }) => db.importData(payload, merge))

  /* ---------------- 播放列表 ---------------- */
  H('db:listPlaylists', () => db.listPlaylists())
  H('db:createPlaylist', ({ name }) => db.createPlaylist({ name }))
  H('db:renamePlaylist', ({ id, name }) => db.renamePlaylist(id, name))
  H('db:deletePlaylist', ({ id }) => db.deletePlaylist(id))
  H('db:getPlaylist', ({ id }) => db.getPlaylist(id))
  H('db:addToPlaylist', ({ id, paths }) => db.addToPlaylist(id, paths))
  H('db:removePlaylistItem', ({ id, index }) => db.removePlaylistItem(id, index))
  H('db:reorderPlaylist', ({ id, from, to }) => db.reorderPlaylist(id, from, to))
  H('db:clearPlaylist', ({ id }) => db.clearPlaylist(id))

  /* ---------------- 缩略图 ---------------- */
  H('thumb:get', async ({ path: p, mtime, size }) => {
    const r = await thumbs.get(p, mtime, size)
    if (!r) return null
    return { file: r.file ? normPath(r.file) : null, w: r.w, h: r.h }
  })
  H('thumb:save', async ({ path: p, mtime, size, dataUrl, w, h }) => {
    const r = await thumbs.save(p, mtime, size, dataUrl, w, h)
    return { file: normPath(r.file), w: r.w, h: r.h }
  })
  H('thumb:saveDims', ({ path: p, mtime, size, w, h }) => thumbs.saveDims(p, mtime, size, w, h))
  H('thumb:dimsBatch', ({ list }) => thumbs.dimsBatch(list))
  H('thumb:clear', () => {
    animflag.clear()
    return thumbs.clear()
  })
  H('thumb:stats', () => thumbs.stats())
  /* 动图判定：读文件头识别 GIF / 动画 WebP / APNG / 多帧 JPEG，结果带磁盘缓存 */
  H('thumb:animatedBatch', ({ list }) => animflag.detectBatch(list))

  /* ---------------- 索引 ---------------- */
  H('index:scan', async () => {
    const roots = db.getLibrary().roots.map((r) => r.path)
    if (!roots.length) throw new Error('还没有添加媒体库文件夹')
    const w = getWindow()
    return indexer.scan(roots, store, (p) => {
      if (w && !w.isDestroyed()) w.webContents.send('index:progress', p)
    })
  })
  H('index:cancel', () => {
    indexer.cancel()
    return true
  })
  H('index:status', () => ({
    running: indexer.isRunning(),
    info: store.data.index.scannedAt || null,
    count: Object.keys(store.data.index.entries || {}).length
  }))
}

module.exports = { registerIpc }
