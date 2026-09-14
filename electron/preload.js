'use strict'

const { contextBridge, ipcRenderer, webUtils } = require('electron')

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload)

const api = {
  /* 窗口 */
  win: {
    minimize: () => invoke('win:minimize'),
    toggleMaximize: () => invoke('win:toggleMaximize'),
    close: () => invoke('win:close'),
    isMaximized: () => invoke('win:isMaximized'),
    toggleFullscreen: () => invoke('win:toggleFullscreen'),
    setMinSize: (width, height) => invoke('win:setMinSize', { width, height }),
    getSize: () => invoke('win:getSize'),
    setSize: (width, height) => invoke('win:setSize', { width, height }),
    onState: (cb) => {
      const h = (_e, s) => cb(s)
      ipcRenderer.on('window:state', h)
      return () => ipcRenderer.off('window:state', h)
    }
  },

  /* 文件系统 */
  fs: {
    listDir: (dirPath, opts) => invoke('fs:listDir', { dirPath, opts }),
    listRecursive: (dirPath, limit) => invoke('fs:listRecursive', { dirPath, limit }),
    listSubdirs: (dirPath) => invoke('fs:listSubdirs', { dirPath }),
    listDrives: () => invoke('fs:listDrives'),
    autoCover: (dirPath) => invoke('fs:autoCover', { dirPath }),
    firstImage: (dirPath, sortBy) => invoke('fs:firstImage', { dirPath, sortBy }),
    countMedia: (dirPath) => invoke('fs:countMedia', { dirPath }),
    createFolder: (parentDir, name) => invoke('fs:createFolder', { parentDir, name }),
    rename: (target, newName) => invoke('fs:rename', { target, newName }),
    move: (paths, targetDir) => invoke('fs:move', { paths, targetDir }),
    copy: (paths, targetDir) => invoke('fs:copy', { paths, targetDir }),
    trash: (paths) => invoke('fs:trash', { paths }),
    reveal: (target) => invoke('fs:reveal', { target }),
    openExternal: (target) => invoke('fs:openExternal', { target }),
    pickFolder: () => invoke('fs:pickFolder'),
    pickFile: (filters) => invoke('fs:pickFile', { filters }),
    saveJson: (defaultName, data) => invoke('fs:saveJson', { defaultName, data }),
    openJson: () => invoke('fs:openJson'),
    exif: (target) => invoke('fs:exif', { target }),
    /** 从拖拽事件的 File 对象取真实磁盘路径（Electron 32+ 必须走 webUtils） */
    pathForFile: (file) => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return file?.path || null
      }
    }
  },

  /* 数据库 */
  db: {
    getLibrary: () => invoke('db:getLibrary'),
    addRoot: (path, name) => invoke('db:addRoot', { path, name }),
    removeRoot: (id) => invoke('db:removeRoot', { id }),
    renameRoot: (id, name) => invoke('db:renameRoot', { id, name }),
    setSettings: (patch) => invoke('db:setSettings', { patch }),

    getTags: () => invoke('db:getTags'),
    createTag: (payload) => invoke('db:createTag', payload),
    updateTag: (id, patch) => invoke('db:updateTag', { id, patch }),
    deleteTag: (id) => invoke('db:deleteTag', { id }),
    createTagGroup: (payload) => invoke('db:createTagGroup', payload),
    updateTagGroup: (id, patch) => invoke('db:updateTagGroup', { id, patch }),
    deleteTagGroup: (id) => invoke('db:deleteTagGroup', { id }),

    getMetaFor: (paths) => invoke('db:getMetaFor', { paths }),
    setItemTags: (path, tagIds) => invoke('db:setItemTags', { path, tagIds }),
    setFolderTags: (path, tagIds) => invoke('db:setFolderTags', { path, tagIds }),
    bulkTag: (targets, tagIds, mode) => invoke('db:bulkTag', { targets, tagIds, mode }),
    setFavorite: (path, isDir, value) => invoke('db:setFavorite', { path, isDir, value }),
    setRating: (path, isDir, value) => invoke('db:setRating', { path, isDir, value }),
    setNote: (path, isDir, note) => invoke('db:setNote', { path, isDir, note }),
    setFolderCover: (folderPath, coverPath) => invoke('db:setFolderCover', { folderPath, coverPath }),
    setFolderView: (folderPath, view, albumSort) =>
      invoke('db:setFolderView', { folderPath, view, albumSort }),
    search: (opts) => invoke('db:search', opts),
    pruneMissing: () => invoke('db:pruneMissing'),
    exportData: () => invoke('db:exportData'),
    importData: (payload, merge) => invoke('db:importData', { payload, merge }),

    listPlaylists: () => invoke('db:listPlaylists'),
    createPlaylist: (name) => invoke('db:createPlaylist', { name }),
    renamePlaylist: (id, name) => invoke('db:renamePlaylist', { id, name }),
    deletePlaylist: (id) => invoke('db:deletePlaylist', { id }),
    getPlaylist: (id) => invoke('db:getPlaylist', { id }),
    addToPlaylist: (id, paths) => invoke('db:addToPlaylist', { id, paths }),
    removePlaylistItem: (id, index) => invoke('db:removePlaylistItem', { id, index }),
    reorderPlaylist: (id, from, to) => invoke('db:reorderPlaylist', { id, from, to }),
    clearPlaylist: (id) => invoke('db:clearPlaylist', { id })
  },

  /* 缩略图 */
  thumb: {
    get: (path, mtime, size) => invoke('thumb:get', { path, mtime, size }),
    save: (path, mtime, size, dataUrl, w, h) =>
      invoke('thumb:save', { path, mtime, size, dataUrl, w, h }),
    saveDims: (path, mtime, size, w, h) => invoke('thumb:saveDims', { path, mtime, size, w, h }),
    dimsBatch: (list) => invoke('thumb:dimsBatch', { list }),
    animatedBatch: (list) => invoke('thumb:animatedBatch', { list }),
    clear: () => invoke('thumb:clear'),
    stats: () => invoke('thumb:stats')
  },

  /* 索引 */
  index: {
    scan: () => invoke('index:scan'),
    cancel: () => invoke('index:cancel'),
    status: () => invoke('index:status'),
    onProgress: (cb) => {
      const h = (_e, p) => cb(p)
      ipcRenderer.on('index:progress', h)
      return () => ipcRenderer.off('index:progress', h)
    }
  },

  /* 工具 */
  util: {
    mediaUrl: (filePath) =>
      filePath ? `media://local/${encodeURIComponent(String(filePath).replace(/\\/g, '/'))}` : '',
    platform: process.platform
  }
}

contextBridge.exposeInMainWorld('api', api)
