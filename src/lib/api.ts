import type {
  Entry, SubDir, Tag, TagGroup, ItemMeta, FolderMeta,
  LibraryRoot, Settings, SearchOpts, ThumbInfo, Playlist
} from '@/types'

type Res<T> = { ok: boolean; data?: T; error?: string }

const raw = (window as any).api

if (!raw) {
  // 纯浏览器里打开会走到这里；给个明确提示而不是满屏 undefined 报错
  console.error('未检测到 Electron 预加载桥接，请通过 npm run dev 启动应用')
}

async function call<T>(p: Promise<Res<T>>): Promise<T> {
  const r = await p
  if (!r || !r.ok) throw new Error(r?.error || '操作失败')
  return r.data as T
}

export const api = {
  win: {
    minimize: () => call<boolean>(raw.win.minimize()),
    toggleMaximize: () => call<boolean>(raw.win.toggleMaximize()),
    close: () => call<boolean>(raw.win.close()),
    isMaximized: () => call<boolean>(raw.win.isMaximized()),
    toggleFullscreen: () => call<boolean>(raw.win.toggleFullscreen()),
    onState: (cb: (s: any) => void) => raw.win.onState(cb)
  },
  fs: {
    listDir: (dirPath: string, opts?: any) =>
      call<{ path: string; parent: string | null; entries: Entry[] }>(raw.fs.listDir(dirPath, opts)),
    listRecursive: (dirPath: string, limit?: number) =>
      call<Entry[]>(raw.fs.listRecursive(dirPath, limit)),
    listSubdirs: (dirPath: string) => call<SubDir[]>(raw.fs.listSubdirs(dirPath)),
    listDrives: () => call<{ drives: any[]; home: string }>(raw.fs.listDrives()),
    autoCover: (dirPath: string) => call<string | null>(raw.fs.autoCover(dirPath)),
    firstImage: (dirPath: string, sortBy?: string) =>
      call<{
        name: string; path: string; ext: string; kind: string;
        size: number; mtime: number; ctime: number; count: number
      } | null>(raw.fs.firstImage(dirPath, sortBy)),
    countMedia: (dirPath: string) => call<{ files: number; dirs: number }>(raw.fs.countMedia(dirPath)),
    createFolder: (parentDir: string, name: string) =>
      call<string>(raw.fs.createFolder(parentDir, name)),
    rename: (target: string, newName: string) => call<string>(raw.fs.rename(target, newName)),
    move: (paths: string[], targetDir: string) => call<any[]>(raw.fs.move(paths, targetDir)),
    copy: (paths: string[], targetDir: string) => call<any[]>(raw.fs.copy(paths, targetDir)),
    trash: (paths: string[]) => call<any[]>(raw.fs.trash(paths)),
    reveal: (target: string) => call<boolean>(raw.fs.reveal(target)),
    openExternal: (target: string) => call<any>(raw.fs.openExternal(target)),
    pickFolder: () => call<string | null>(raw.fs.pickFolder()),
    pickFile: (filters?: any) => call<string | null>(raw.fs.pickFile(filters)),
    saveJson: (name: string, data: any) => call<string | null>(raw.fs.saveJson(name, data)),
    openJson: () => call<any>(raw.fs.openJson()),
    exif: (target: string) => call<Record<string, string> | null>(raw.fs.exif(target)),
    pathForFile: (f: File): string | null => raw.fs.pathForFile(f)
  },
  db: {
    getLibrary: () => call<{ roots: LibraryRoot[]; settings: Settings }>(raw.db.getLibrary()),
    addRoot: (p: string, name?: string) => call<LibraryRoot[]>(raw.db.addRoot(p, name)),
    removeRoot: (id: string) => call<LibraryRoot[]>(raw.db.removeRoot(id)),
    renameRoot: (id: string, name: string) => call<LibraryRoot[]>(raw.db.renameRoot(id, name)),
    setSettings: (patch: Partial<Settings>) => call<Settings>(raw.db.setSettings(patch)),

    getTags: () => call<{ tags: Tag[]; groups: TagGroup[] }>(raw.db.getTags()),
    createTag: (p: { name: string; color?: string; groupId?: string | null }) =>
      call<Tag>(raw.db.createTag(p)),
    updateTag: (id: string, patch: Partial<Tag>) => call<Tag>(raw.db.updateTag(id, patch)),
    deleteTag: (id: string) => call<boolean>(raw.db.deleteTag(id)),
    createTagGroup: (p: { name: string; color?: string }) => call<TagGroup>(raw.db.createTagGroup(p)),
    updateTagGroup: (id: string, patch: Partial<TagGroup>) =>
      call<TagGroup>(raw.db.updateTagGroup(id, patch)),
    deleteTagGroup: (id: string) => call<boolean>(raw.db.deleteTagGroup(id)),

    getMetaFor: (paths: string[]) =>
      call<{ items: Record<string, ItemMeta>; folders: Record<string, FolderMeta> }>(
        raw.db.getMetaFor(paths)
      ),
    setItemTags: (p: string, tagIds: string[]) => call<ItemMeta>(raw.db.setItemTags(p, tagIds)),
    setFolderTags: (p: string, tagIds: string[]) => call<FolderMeta>(raw.db.setFolderTags(p, tagIds)),
    bulkTag: (targets: { path: string; isDir: boolean }[], tagIds: string[], mode: string) =>
      call<boolean>(raw.db.bulkTag(targets, tagIds, mode)),
    setFavorite: (p: string, isDir: boolean, value: boolean) =>
      call<ItemMeta>(raw.db.setFavorite(p, isDir, value)),
    setRating: (p: string, isDir: boolean, value: number) =>
      call<ItemMeta>(raw.db.setRating(p, isDir, value)),
    setNote: (p: string, isDir: boolean, note: string) =>
      call<ItemMeta>(raw.db.setNote(p, isDir, note)),
    setFolderCover: (folderPath: string, coverPath: string | null) =>
      call<FolderMeta>(raw.db.setFolderCover(folderPath, coverPath)),
    setFolderView: (folderPath: string, view: 'album' | 'normal', albumSort?: string) =>
      call<FolderMeta>(raw.db.setFolderView(folderPath, view, albumSort)),
    search: (opts: SearchOpts) =>
      call<{ entries: Entry[]; truncated: boolean }>(raw.db.search(opts)),
    pruneMissing: () => call<number>(raw.db.pruneMissing()),
    exportData: () => call<any>(raw.db.exportData()),
    importData: (payload: any, merge: boolean) => call<boolean>(raw.db.importData(payload, merge)),

    listPlaylists: () => call<Playlist[]>(raw.db.listPlaylists()),
    createPlaylist: (name: string) => call<Playlist>(raw.db.createPlaylist(name)),
    renamePlaylist: (id: string, name: string) => call<Playlist>(raw.db.renamePlaylist(id, name)),
    deletePlaylist: (id: string) => call<boolean>(raw.db.deletePlaylist(id)),
    getPlaylist: (id: string) => call<Playlist | null>(raw.db.getPlaylist(id)),
    addToPlaylist: (id: string, paths: string[]) => call<Playlist>(raw.db.addToPlaylist(id, paths)),
    removePlaylistItem: (id: string, index: number) => call<Playlist>(raw.db.removePlaylistItem(id, index)),
    reorderPlaylist: (id: string, from: number, to: number) =>
      call<Playlist>(raw.db.reorderPlaylist(id, from, to)),
    clearPlaylist: (id: string) => call<Playlist>(raw.db.clearPlaylist(id))
  },
  thumb: {
    get: (p: string, mtime: number, size: number) =>
      call<ThumbInfo | null>(raw.thumb.get(p, mtime, size)),
    save: (p: string, mtime: number, size: number, dataUrl: string, w: number, h: number) =>
      call<ThumbInfo>(raw.thumb.save(p, mtime, size, dataUrl, w, h)),
    saveDims: (p: string, mtime: number, size: number, w: number, h: number) =>
      call<boolean>(raw.thumb.saveDims(p, mtime, size, w, h)),
    dimsBatch: (list: { path: string; mtime: number; size: number }[]) =>
      call<Record<string, [number, number]>>(raw.thumb.dimsBatch(list)),
    /** 批量判定「是不是动图」：GIF / 动画 WebP / APNG / 多帧 JPEG */
    animatedBatch: (list: { path: string; mtime: number; size: number }[]) =>
      call<Record<string, boolean>>(raw.thumb.animatedBatch(list)),
    clear: () => call<any>(raw.thumb.clear()),
    stats: () => call<{ count: number; bytes: number; dir: string }>(raw.thumb.stats())
  },
  index: {
    scan: () => call<any>(raw.index.scan()),
    cancel: () => call<boolean>(raw.index.cancel()),
    status: () => call<{ running: boolean; info: any; count: number }>(raw.index.status()),
    onProgress: (cb: (p: any) => void) => raw.index.onProgress(cb)
  },
  mediaUrl: (p: string) => (raw ? raw.util.mediaUrl(p) : ''),
  platform: raw?.util?.platform || 'win32'
}
