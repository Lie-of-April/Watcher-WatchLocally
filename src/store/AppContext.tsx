import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState
} from 'react'
import { api } from '@/lib/api'
import { sortEntries, basename, dirname, kindFromExt } from '@/lib/utils'
import type {
  Entry, Tag, TagGroup, ItemMeta, FolderMeta, LibraryRoot, Settings, Kind, Playlist
} from '@/types'
import { t } from '@/i18n/strings'

/* ---------------- 类型 ---------------- */

export interface Filters {
  query: string
  tagIds: string[]
  tagMode: 'and' | 'or' | 'not'
  kinds: Kind[]
  favoriteOnly: boolean
  untaggedOnly: boolean
  minRating: number
  /** 搜索范围：null = 全部已索引媒体库；否则限定在该目录（含子目录）内 */
  scopeDir?: string | null
  /** true = 在所有已索引媒体库中搜索；false（默认）= 仅在当前文件夹及其子文件夹内搜索 */
  scopeAll?: boolean
}

export interface Toast {
  id: number
  text: string
  type?: 'ok' | 'err' | 'info'
}

interface ConfirmOpts {
  title: string
  message?: React.ReactNode
  confirmText?: string
  danger?: boolean
  /** 可选复选框（如"以后不再提示"）。确认时若被勾选，会调用 onConfirm(checked) */
  checkbox?: { label: string; default?: boolean; onConfirm?: (checked: boolean) => void }
}

interface PromptOpts {
  title: string
  label?: string
  initial?: string
  placeholder?: string
  confirmText?: string
}

interface Ctx {
  /* 库 */
  roots: LibraryRoot[]
  settings: Settings
  patchSettings: (p: Partial<Settings>) => void
  addRoot: () => Promise<void>
  removeRoot: (id: string) => Promise<void>

  /* 标签 */
  tags: Tag[]
  tagGroups: TagGroup[]
  tagMap: Record<string, Tag>
  reloadTags: () => Promise<void>

  /* 浏览 */
  mode: 'browse' | 'search'
  currentDir: string | null
  entries: Entry[]
  sortedEntries: Entry[]
  fileEntries: Entry[]
  folderEntries: Entry[]
  loading: boolean
  error: string | null
  navigate: (dir: string, pushHistory?: boolean) => void
  refresh: () => void
  goUp: () => void
  goBack: () => void
  goForward: () => void
  canBack: boolean
  canForward: boolean

  /* 元数据 */
  itemMeta: Record<string, ItemMeta>
  folderMeta: Record<string, FolderMeta>
  reloadMeta: (paths?: string[]) => Promise<void>
  applyMetaPatch: (path: string, isDir: boolean, patch: Partial<FolderMeta>) => void

  /* 筛选 */
  filters: Filters
  setFilters: React.Dispatch<React.SetStateAction<Filters>>
  resetFilters: () => void
  activeFilterCount: number
  runSearch: () => void

  /** 当前生效的排序（优先取当前文件夹的 folderSort 覆盖，否则全局默认） */
  activeSortBy: Settings['sortBy']
  activeSortDir: 'asc' | 'desc'
  /** 设置当前文件夹（或全局默认）的排序方式 */
  setActiveSortBy: (k: Settings['sortBy']) => void
  setActiveSortDir: (d: 'asc' | 'desc') => void

  /* 选择 */
  selection: Set<string>
  isSelected: (p: string) => boolean
  toggleSelect: (p: string, additive?: boolean) => void
  selectRange: (p: string) => void
  selectOnly: (p: string) => void
  /** 框选：一次性替换整个选择集（App 侧框选回调基于 base 整体重算后调用） */
  selectPaths: (paths: string[]) => void
  selectAll: () => void
  clearSelection: () => void
  selectedEntries: Entry[]

  /* 查看器 */
  viewerIndex: number | null
  openViewer: (p: string) => void
  closeViewer: () => void
  setViewerIndex: (i: number | null) => void
  viewerList: Entry[]
  viewerQueueName: string | null

  /** 瀑布流实际呈现的条目：普通媒体 + 套图封面，套图在父目录里以大图封面呈现 */
  streamEntries: Entry[]
  /** 套图封面项：被标记为 album 的子文件夹，以封面媒体形式呈现 */
  albumEntries: Entry[]
  /** 已成功以封面形式进入瀑布流的套图文件夹路径集合 */
  albumShown: Set<string>
  /** 打开"套图"文件夹：以子文件夹内媒体独立成队列浏览 */
  openAlbum: (folderPath: string) => void
  /** 把文件夹标记为套图 / 恢复普通文件夹 */
  setFolderView: (folderPath: string, view: 'album' | 'normal', albumSort?: string) => Promise<void>
  /** 批量设置若干文件夹的呈现方式 */
  setFoldersAlbum: (paths: string[], view: 'album' | 'normal') => Promise<void>

  /* 播放列表（不改动文件结构） */
  playlists: Playlist[]
  loadPlaylists: () => Promise<void>
  startPlaylist: (id: string) => Promise<void>
  addToPlaylist: (id: string, paths: string[]) => Promise<void>

  /* 交互 */
  toasts: Toast[]
  toast: (text: string, type?: 'ok' | 'err' | 'info') => void
  confirm: (o: ConfirmOpts) => Promise<boolean>
  prompt: (o: PromptOpts) => Promise<string | null>
  confirmState: (ConfirmOpts & { resolve: (v: boolean) => void }) | null
  promptState: (PromptOpts & { resolve: (v: string | null) => void }) | null

  /* 文件操作 */
  doCreateFolder: (parent?: string) => Promise<void>
  doRename: (entry: Entry) => Promise<void>
  doTrash: (paths: string[]) => Promise<void>
  doMove: (paths: string[], target: string) => Promise<void>
  doCopy: (paths: string[], target: string) => Promise<void>
  doSetCover: (folderPath: string, coverPath: string | null) => Promise<void>
  doToggleFavorite: (entry: Entry) => Promise<void>

  /* 索引 */
  indexProgress: any
  indexInfo: { running: boolean; count: number; info: any } | null
  startScan: () => Promise<void>
  refreshIndexStatus: () => Promise<void>
}

const AppCtx = createContext<Ctx>(null as any)
export const useApp = () => useContext(AppCtx)

const DEFAULT_FILTERS: Filters = {
  query: '',
  tagIds: [],
  tagMode: 'and',
  kinds: [],
  favoriteOnly: false,
  untaggedOnly: false,
  minRating: 0,
  scopeDir: null,
  scopeAll: false
}

const DEFAULT_SETTINGS: Settings = {
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
  lastDir: null,
  theme: 'light',
  accent: '#0096fa',
  loopAnim: true,
  videoSeek: 15,
  imageSampling: 'smooth',
  hoverPlayJpg: true,
  hoverPlayWebp: true,
  videoPreviewHold: 1500,
  folderSort: {},
  albumReadMode: {},
  albumProgress: {},
  skipTrashConfirm: false
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [roots, setRoots] = useState<LibraryRoot[]>([])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [tags, setTags] = useState<Tag[]>([])
  const [tagGroups, setTagGroups] = useState<TagGroup[]>([])

  const [mode, setMode] = useState<'browse' | 'search'>('browse')
  const [currentDir, setCurrentDir] = useState<string | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [itemMeta, setItemMeta] = useState<Record<string, ItemMeta>>({})
  const [folderMeta, setFolderMeta] = useState<Record<string, FolderMeta>>({})

  /* 套图封面缓存：folderPath -> 封面媒体信息；albumVer 用于触发重渲染 */
  const albumCovers = useRef<Record<string, any>>({})
  const albumPending = useRef<Set<string>>(new Set())
  /* 已确认取不到封面（空文件夹/无媒体）的目录，避免每次 effect 重跑都重复发 IPC */
  const albumEmpty = useRef<Set<string>>(new Set())
  const [albumVer, setAlbumVer] = useState(0)

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [confirmState, setConfirmState] = useState<any>(null)
  const [promptState, setPromptState] = useState<any>(null)
  const [indexProgress, setIndexProgress] = useState<any>(null)
  const [indexInfo, setIndexInfo] = useState<any>(null)

  /* 播放列表 / 查看器队列 */
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [queueList, setQueueList] = useState<Entry[] | null>(null)
  const [viewerQueueName, setViewerQueueName] = useState<string | null>(null)

  const history = useRef<string[]>([])
  const histPos = useRef(-1)
  const anchorRef = useRef<string | null>(null)
  const reqId = useRef(0)

  /* ---------------- 提示 ---------------- */
  const toast = useCallback((text: string, type: 'ok' | 'err' | 'info' = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'err' ? 4200 : 2600)
  }, [])

  const confirm = useCallback(
    (o: ConfirmOpts) => new Promise<boolean>((resolve) => setConfirmState({ ...o, resolve })),
    []
  )
  const prompt = useCallback(
    (o: PromptOpts) => new Promise<string | null>((resolve) => setPromptState({ ...o, resolve })),
    []
  )

  /* ---------------- 初始化 ---------------- */
  /** 把主题 / 强调色写到 documentElement 上，CSS 通过 data-theme + --accent 生效 */
  const applyTheme = useCallback((s: Settings) => {
    document.documentElement.setAttribute('data-theme', s.theme || 'light')
    document.documentElement.style.setProperty('--accent', s.accent || '#0096fa')
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        const lib = await api.db.getLibrary()
        setRoots(lib.roots)
        const merged = { ...DEFAULT_SETTINGS, ...lib.settings } as Settings
        setSettings(merged)
        applyTheme(merged)
        await reloadTags()
        loadPlaylists().catch(() => {})
        const status = await api.index.status()
        setIndexInfo(status)
        const start = lib.settings?.lastDir || lib.roots[0]?.path || null
        if (start) navigateInternal(start, true)
      } catch (e: any) {
        setError(e.message)
      }
    })()
    const off = api.index.onProgress((p: any) => {
      setIndexProgress(p.done ? null : p)
      if (p.done) {
        api.index.status().then(setIndexInfo).catch(() => {})
      }
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reloadTags = useCallback(async () => {
    try {
      const t = await api.db.getTags()
      setTags(t.tags)
      setTagGroups(t.groups)
    } catch (e: any) {
      toast(e.message, 'err')
    }
  }, [toast])

  const tagMap = useMemo(() => {
    const m: Record<string, Tag> = {}
    for (const t of tags) m[t.id] = t
    return m
  }, [tags])

  /* ---------------- 元数据 ---------------- */
  const loadMetaFor = useCallback(async (list: Entry[]) => {
    if (!list.length) {
      setItemMeta({})
      setFolderMeta({})
      return
    }
    try {
      const m = await api.db.getMetaFor(list.map((e) => e.path))
      setItemMeta(m.items || {})
      setFolderMeta(m.folders || {})
    } catch {
      /* 元数据读失败不该阻塞浏览 */
    }
  }, [])

  const reloadMeta = useCallback(
    async (paths?: string[]) => {
      const target = paths || entries.map((e) => e.path)
      if (!target.length) return
      try {
        const m = await api.db.getMetaFor(target)
        setItemMeta((prev) => ({ ...prev, ...(m.items || {}) }))
        setFolderMeta((prev) => ({ ...prev, ...(m.folders || {}) }))
      } catch {}
    },
    [entries]
  )

  /** 本地即时更新，避免每次改标签都全量拉一遍 */
  const applyMetaPatch = useCallback(
    (path: string, isDir: boolean, patch: Partial<FolderMeta>) => {
      if (isDir) {
        setFolderMeta((prev) => ({
          ...prev,
          [path]: { ...(prev[path] || { path, tags: [], updatedAt: 0 }), ...patch } as FolderMeta
        }))
      } else {
        setItemMeta((prev) => ({
          ...prev,
          [path]: { ...(prev[path] || { path, tags: [], updatedAt: 0 }), ...patch } as ItemMeta
        }))
      }
    },
    []
  )

  /* ---------------- 导航 ---------------- */
  const loadDir = useCallback(
    async (dir: string) => {
      const id = ++reqId.current
      setLoading(true)
      setError(null)
      try {
        let list: Entry[]
        if (settings.recursive) {
          list = await api.fs.listRecursive(dir, 20000)
        } else {
          const r = await api.fs.listDir(dir)
          list = r.entries
        }
        if (id !== reqId.current) return
        setEntries(list)
        await loadMetaFor(list)
      } catch (e: any) {
        if (id !== reqId.current) return
        setEntries([])
        setError(e.message || t('appctx.cannotReadFolder'))
      } finally {
        if (id === reqId.current) setLoading(false)
      }
    },
    [settings.recursive, loadMetaFor]
  )

  const navigateInternal = useCallback(
    (dir: string, replaceHistory = false) => {
      setMode('browse')
      setCurrentDir(dir)
      setSelection(new Set())
      anchorRef.current = null
      setViewerIndex(null)
      setQueueList(null)
      setViewerQueueName(null)
      if (replaceHistory) {
        history.current = [dir]
        histPos.current = 0
      } else {
        history.current = history.current.slice(0, histPos.current + 1)
        history.current.push(dir)
        histPos.current = history.current.length - 1
      }
      loadDir(dir)
      api.db.setSettings({ lastDir: dir }).catch(() => {})
    },
    [loadDir]
  )

  const navigate = useCallback(
    (dir: string) => {
      if (dir === currentDir && mode === 'browse') return
      navigateInternal(dir, false)
    },
    [currentDir, mode, navigateInternal]
  )

  const refresh = useCallback(() => {
    if (mode === 'search') runSearchRef.current()
    else if (currentDir) loadDir(currentDir)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, currentDir, loadDir])

  const goUp = useCallback(() => {
    if (!currentDir) return
    const p = dirname(currentDir)
    if (p && p !== currentDir) navigate(p)
  }, [currentDir, navigate])

  const goBack = useCallback(() => {
    if (histPos.current > 0) {
      histPos.current--
      const dir = history.current[histPos.current]
      setMode('browse')
      setCurrentDir(dir)
      setSelection(new Set())
      loadDir(dir)
    }
  }, [loadDir])

  const goForward = useCallback(() => {
    if (histPos.current < history.current.length - 1) {
      histPos.current++
      const dir = history.current[histPos.current]
      setMode('browse')
      setCurrentDir(dir)
      setSelection(new Set())
      loadDir(dir)
    }
  }, [loadDir])

  // 目录内容随"包含子文件夹"开关变化需要重载
  useEffect(() => {
    if (mode === 'browse' && currentDir) loadDir(currentDir)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.recursive])

  /* ---------------- 搜索 ---------------- */
  const runSearch = useCallback(async () => {
    const id = ++reqId.current
    setLoading(true)
    setError(null)
    setMode('search')
    setSelection(new Set())
    setViewerIndex(null)
    try {
      const r = await api.db.search({
        query: filters.query,
        tagIds: filters.tagIds,
        tagMode: filters.tagMode,
        untaggedOnly: filters.untaggedOnly,
        kinds: filters.kinds,
        favoriteOnly: filters.favoriteOnly,
        minRating: filters.minRating,
        scopeDir: filters.scopeAll ? null : currentDir || null,
        includeFolders: true,
        limit: 5000
      })
      if (id !== reqId.current) return
      setEntries(r.entries)
      await loadMetaFor(r.entries)
      if (r.truncated) toast(t('appctx.tooManyResults'), 'info')
    } catch (e: any) {
      if (id !== reqId.current) return
      setEntries([])
      setError(e.message)
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [filters, loadMetaFor, toast])

  // 始终持有最新版 runSearch，避免 refresh() 闭包到过期的 filters
  // （否则搜索模式下 F5 / 删除文件后，刚设好的 scopeDir/minRating/tagMode 会被静默回滚）
  const runSearchRef = useRef(runSearch)
  useEffect(() => { runSearchRef.current = runSearch }, [runSearch])

  const activeFilterCount = useMemo(() => {
    let n = 0
    if (filters.query.trim()) n++
    if (filters.tagIds.length) n++
    if (filters.kinds.length) n++
    if (filters.favoriteOnly) n++
    if (filters.untaggedOnly) n++
    /* 评分筛选：-1（未评分）与 1-5（已评分/星级）都算一条生效的筛选 */
    if (filters.minRating !== 0) n++
    if (filters.scopeAll) n++
    return n
  }, [filters])

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS)
    setMode('browse')
    if (currentDir) loadDir(currentDir)
  }, [currentDir, loadDir])

  /* ---------------- 排序与分组 ---------------- */
  /* 每个文件夹可独立记忆排序方式：有 folderSort 覆盖时用覆盖值，否则回退全局默认。
   * 这样切换文件夹不会互相继承排序。 */
  const folderSortMap = settings.folderSort || {}
  const activeSort = currentDir && mode === 'browse' ? folderSortMap[currentDir] : undefined
  const activeSortBy = activeSort?.sortBy ?? settings.sortBy
  const activeSortDir = activeSort?.sortDir ?? settings.sortDir

  /* 排序前把评分并到 Entry 上（来自 itemMeta / folderMeta），这样"按评分排序"才有效 */
  const sortedEntries = useMemo(
    () =>
      sortEntries(
        entries.map((e) =>
          e.rating !== undefined ? e : { ...e, rating: (e.isDir ? folderMeta : itemMeta)[e.path]?.rating || 0 }
        ),
        { ...settings, sortBy: activeSortBy, sortDir: activeSortDir }
      ),
    [entries, itemMeta, folderMeta, settings, activeSortBy, activeSortDir]
  )
  const folderEntries = useMemo(
    () => (settings.showFolders ? sortedEntries.filter((e) => e.isDir) : []),
    [sortedEntries, settings.showFolders]
  )
  const fileEntries = useMemo(() => sortedEntries.filter((e) => !e.isDir), [sortedEntries])

  /* 套图封面项：把被标记为 album 的子文件夹，以"封面媒体"的形式塞进瀑布流。
     优先用用户手动设的封面（folderMeta.cover），否则用自动取到的首图 */
  const albumEntries = useMemo(() => {
    const out: Entry[] = []
    for (const f of folderEntries) {
      const meta = folderMeta[f.path]
      if (!meta || meta.view !== 'album') continue
      const manual = meta.coverMode === 'manual' && meta.cover
      const c = manual ? null : albumCovers.current[f.path]
      if (!manual && !c) continue
      const coverPath = manual ? meta.cover! : c.path
      const ext = manual
        ? (coverPath.includes('.') ? coverPath.slice(coverPath.lastIndexOf('.')).toLowerCase() : '')
        : c.ext
      const kind = manual ? kindFromExt(ext) : c.kind
      out.push({
        name: f.name,
        path: coverPath,
        isDir: false,
        ext,
        kind,
        size: manual ? 0 : c.size,
        mtime: manual ? 0 : c.mtime,
        ctime: manual ? 0 : c.ctime,
        albumPath: f.path,
        albumCount: manual ? undefined : c.count,
        rating: (meta?.rating as number) || 0
      } as Entry)
    }
    return out
  }, [folderEntries, folderMeta, albumVer])

  /* 瀑布流真正的条目序列：普通媒体 + 套图封面，一起参与排序。
   * 必须用当前文件夹的 active 排序，而不是全局 settings——
   * 否则每个文件夹自定义的排序会被全局默认覆盖（表现为“只有第一个文件夹排序生效”）。 */
  const streamEntries = useMemo(
    () =>
      sortEntries([...fileEntries, ...albumEntries], {
        ...settings,
        sortBy: activeSortBy,
        sortDir: activeSortDir
      }),
    [fileEntries, albumEntries, settings, activeSortBy, activeSortDir]
  )

  /* 已经以封面形式进入瀑布流的套图文件夹。没进来的（封面还没取到 / 文件夹是空的）
     仍需在文件夹网格里露出，否则用户既看不见也无法取消它的套图状态 */
  const albumShown = useMemo(
    () => new Set(albumEntries.map((e) => e.albumPath as string)),
    [albumEntries]
  )

  /* 套图封面懒加载：发现 album 文件夹缺封面就异步取首张图 */
  useEffect(() => {
    let cancelled = false
    const need = folderEntries.filter(
      (f) =>
        folderMeta[f.path]?.view === 'album' &&
        !albumCovers.current[f.path] &&
        !albumEmpty.current.has(f.path) &&
        !albumPending.current.has(f.path)
    )
    if (!need.length) return
    need.forEach((f) => albumPending.current.add(f.path))
    ;(async () => {
      let got = false
      try {
        for (const f of need) {
          if (cancelled) break
          const sort = folderMeta[f.path]?.albumSort || 'name'
          try {
            const r = await api.fs.firstImage(f.path, sort)
            if (r) {
              albumCovers.current[f.path] = r
              got = true
            } else {
              /* 该文件夹内没有可用媒体，标记后不再重复请求 */
              albumEmpty.current.add(f.path)
            }
          } catch {
            /* 单个失败不影响其它，留待下次刷新重试 */
          }
        }
      } finally {
        /* 无论正常结束还是被取消，都要释放 pending，否则封面将永远加载不出来 */
        need.forEach((f) => albumPending.current.delete(f.path))
      }
      if (got) setAlbumVer((v) => v + 1)
    })()
    return () => {
      cancelled = true
    }
  }, [folderEntries, folderMeta, albumVer])

  /* ---------------- 选择 ---------------- */
  const isSelected = useCallback((p: string) => selection.has(p), [selection])

  const toggleSelect = useCallback((p: string, additive = true) => {
    setSelection((prev) => {
      const next = additive ? new Set(prev) : new Set<string>()
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })
    anchorRef.current = p
  }, [])

  const selectOnly = useCallback((p: string) => {
    setSelection(new Set([p]))
    anchorRef.current = p
  }, [])

  const selectRange = useCallback(
    (p: string) => {
      const list = sortedEntries.map((e) => e.path)
      const anchor = anchorRef.current
      if (!anchor) {
        setSelection(new Set([p]))
        anchorRef.current = p
        return
      }
      const a = list.indexOf(anchor)
      const b = list.indexOf(p)
      if (a < 0 || b < 0) {
        setSelection(new Set([p]))
        return
      }
      const [s, e] = a < b ? [a, b] : [b, a]
      setSelection(new Set(list.slice(s, e + 1)))
    },
    [sortedEntries]
  )

  const selectAll = useCallback(() => {
    setSelection(new Set(sortedEntries.map((e) => e.path)))
  }, [sortedEntries])

  /** 一次性把一批路径设为选中（框选用）。相同内容时保持引用不变，避免拖拽每帧重渲染 */
  const selectPaths = useCallback((paths: string[]) => {
    setSelection((prev) => {
      if (prev.size === paths.length && paths.every((p) => prev.has(p))) return prev
      return new Set(paths)
    })
    if (paths.length) anchorRef.current = paths[paths.length - 1]
  }, [])

  const clearSelection = useCallback(() => setSelection(new Set()), [])

  const selectedEntries = useMemo(
    () => sortedEntries.filter((e) => selection.has(e.path)),
    [sortedEntries, selection]
  )

  /* ---------------- 查看器 ---------------- */
  /** 队列优先：正在播放播放列表/套图时，查看器在队列里翻；否则在瀑布流条目里翻（含套图封面） */
  const viewerList = useMemo(
    () => queueList || streamEntries.filter((e) => e.kind !== 'other'),
    [streamEntries, queueList]
  )

  const openViewer = useCallback(
    (p: string) => {
      // 从目录里点开 = 退出播放列表队列，回到目录浏览
      setQueueList(null)
      setViewerQueueName(null)
      const def = streamEntries.filter((e) => e.kind !== 'other')
      const i = def.findIndex((e) => e.path === p)
      if (i >= 0) setViewerIndex(i)
    },
    [streamEntries]
  )
  const closeViewer = useCallback(() => setViewerIndex(null), [])

  /** 打开"套图"文件夹：把子文件夹里的媒体整理成独立队列，从第一张开始看 */
  const openAlbum = useCallback(
    async (folderPath: string) => {
      try {
        const r = await api.fs.listDir(folderPath)
        const sort = folderMeta[folderPath]?.albumSort || 'name'
        const media = r.entries.filter(
          (e) => !e.isDir && (e.kind === 'image' || e.kind === 'gif' || e.kind === 'video')
        )
        if (!media.length) {
          toast(t('appctx.albumNoMedia'), 'info')
          return
        }
        const ordered = sortEntries(media, {
          ...settings,
          sortBy: (sort as any) || 'name',
          sortDir: 'asc',
          folderFirst: false
        }).map((m) => ({ ...m, albumPath: folderPath }))
        setQueueList(ordered)
        setViewerQueueName(basename(folderPath))
        setViewerIndex(0)
      } catch (e: any) {
        toast(e.message || t('appctx.cannotOpenAlbum'), 'err')
      }
    },
    [folderMeta, settings, toast]
  )

  const setFolderView = useCallback(
    async (folderPath: string, view: 'album' | 'normal', albumSort?: string) => {
      try {
        const m = await api.db.setFolderView(folderPath, view, albumSort)
        setFolderMeta((prev) => ({ ...prev, [folderPath]: m }))
        /* 两个方向都要清干净缓存标记：取消套图要丢弃旧封面，
           重新设为套图则强制再取一次（用户可能刚往空文件夹里放了图） */
        delete albumCovers.current[folderPath]
        albumPending.current.delete(folderPath)
        albumEmpty.current.delete(folderPath)
        setAlbumVer((v) => v + 1)
        toast(view === 'album' ? t('appctx.setAlbumOk') : t('appctx.unsetAlbumOk'), 'ok')
      } catch (e: any) {
        toast(e.message, 'err')
      }
    },
    [toast]
  )

  const setFoldersAlbum = useCallback(
    async (paths: string[], view: 'album' | 'normal') => {
      if (!paths.length) return
      const patch: Record<string, any> = {}
      let fail = 0
      for (const p of paths) {
        try {
          patch[p] = await api.db.setFolderView(p, view)
          delete albumCovers.current[p]
          albumPending.current.delete(p)
          albumEmpty.current.delete(p)
        } catch {
          fail++
        }
      }
      const okCount = paths.length - fail
      if (okCount) {
        setFolderMeta((prev) => ({ ...prev, ...patch }))
        setAlbumVer((v) => v + 1)
      }
      toast(
        fail
          ? t('appctx.batchPartial', { ok: okCount, fail })
          : view === 'album'
            ? t('appctx.batchSetAlbum', { n: okCount })
            : t('appctx.batchUnsetAlbum', { n: okCount }),
        fail ? 'err' : 'ok'
      )
    },
    [toast]
  )

  /* ---------------- 播放列表 ---------------- */
  const loadPlaylists = useCallback(async () => {
    try {
      const list = await api.db.listPlaylists()
      setPlaylists(list)
    } catch (e: any) {
      toast(e.message, 'err')
    }
  }, [toast])

  const startPlaylist = useCallback(
    async (id: string) => {
      try {
        const pl = await api.db.getPlaylist(id)
        if (!pl) return
        const items: Entry[] = pl.items
          .map((p) => {
            const dot = p.lastIndexOf('.')
            const ext = dot > 0 ? p.slice(dot).toLowerCase() : ''
            const kind = kindFromExt(ext)
            return {
              name: basename(p),
              path: p,
              isDir: false,
              ext,
              kind,
              size: 0,
              mtime: 0,
              ctime: 0
            } as Entry
          })
          .filter((e) => e.kind !== 'other')
        if (!items.length) {
          toast(t('appctx.playlistEmpty'), 'info')
          return
        }
        setQueueList(items)
        setViewerQueueName(pl.name)
        setViewerIndex(0)
      } catch (e: any) {
        toast(e.message, 'err')
      }
    },
    [toast, setViewerIndex]
  )

  const addToPlaylist = useCallback(
    async (id: string, paths: string[]) => {
      if (!paths.length) return
      try {
        await api.db.addToPlaylist(id, paths)
        setPlaylists((prev) =>
          prev.map((p) => (p.id === id ? { ...p, items: [...p.items, ...paths] } : p))
        )
        toast(t('appctx.addedToPlaylist', { n: paths.length }), 'ok')
      } catch (e: any) {
        toast(e.message, 'err')
      }
    },
    [toast]
  )

  /* ---------------- 设置 ---------------- */
  const patchSettings = useCallback((p: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...p }
      applyTheme(next)
      return next
    })
    api.db.setSettings(p).catch(() => {})
  }, [applyTheme])

  /* ---------------- 每个文件夹独立记忆的排序 ---------------- */
  /** 设置当前文件夹（浏览模式）的排序；不在文件夹里时退化为改全局默认 */
  const setActiveSortBy = useCallback(
    (k: Settings['sortBy']) => {
      if (currentDir && mode === 'browse') {
        const cur = folderSortMap[currentDir] || { sortBy: settings.sortBy, sortDir: settings.sortDir }
        patchSettings({ folderSort: { ...folderSortMap, [currentDir]: { sortBy: k, sortDir: cur.sortDir } } })
      } else {
        patchSettings({ sortBy: k })
      }
    },
    [currentDir, mode, folderSortMap, settings.sortBy, settings.sortDir, patchSettings]
  )
  const setActiveSortDir = useCallback(
    (d: 'asc' | 'desc') => {
      if (currentDir && mode === 'browse') {
        const cur = folderSortMap[currentDir] || { sortBy: settings.sortBy, sortDir: settings.sortDir }
        patchSettings({ folderSort: { ...folderSortMap, [currentDir]: { sortBy: cur.sortBy, sortDir: d } } })
      } else {
        patchSettings({ sortDir: d })
      }
    },
    [currentDir, mode, folderSortMap, settings.sortBy, settings.sortDir, patchSettings]
  )

  /* ---------------- 库根 ---------------- */
  const addRoot = useCallback(async () => {
    try {
      const p = await api.fs.pickFolder()
      if (!p) return
      const list = await api.db.addRoot(p)
      setRoots(list)
      toast(t('appctx.addedLibrary', { name: basename(p) }), 'ok')
      navigateInternal(p, false)
    } catch (e: any) {
      toast(e.message, 'err')
    }
  }, [navigateInternal, toast])

  const removeRoot = useCallback(
    async (id: string) => {
      const r = roots.find((x) => x.id === id)
      const okc = await confirm({
        title: t('appctx.removeLibraryTitle'),
        message: (
          <>
            {t('appctx.removeLibraryMsg1')}<b>{r?.name}</b>{t('appctx.removeLibraryMsg2')}
            <br />
            <span className="text-dim">{t('appctx.removeLibraryHint')}</span>
          </>
        ),
        confirmText: t('appctx.removeConfirm')
      })
      if (!okc) return
      const list = await api.db.removeRoot(id)
      setRoots(list)
      toast(t('appctx.removedLibrary'), 'ok')
    },
    [roots, confirm, toast]
  )

  /* ---------------- 文件操作 ---------------- */
  const doCreateFolder = useCallback(
    async (parent?: string) => {
      const dir = parent || currentDir
      if (!dir) return
      const name = await prompt({
        title: t('appctx.newFolderTitle'),
        label: t('ctx.folderNameLabel'),
        initial: t('ctx.newFolderInitial'),
        confirmText: t('misc.create')
      })
      if (!name) return
      try {
        await api.fs.createFolder(dir, name)
        toast(t('ctx.folderCreated'), 'ok')
        refresh()
      } catch (e: any) {
        toast(e.message, 'err')
      }
    },
    [currentDir, prompt, refresh, toast]
  )

  const doRename = useCallback(
    async (entry: Entry) => {
      const name = await prompt({
        title: t('appctx.renameTitle'),
        label: entry.isDir ? t('ctx.folderNameLabel') : t('ctx.fileNameLabel'),
        initial: entry.name,
        confirmText: t('misc.save')
      })
      if (!name || name === entry.name) return
      try {
        await api.fs.rename(entry.path, name)
        toast(t('ctx.renamed'), 'ok')
        refresh()
      } catch (e: any) {
        toast(e.message, 'err')
      }
    },
    [prompt, refresh, toast]
  )

  const doTrash = useCallback(
    async (paths: string[]) => {
      if (!paths.length) return
      // 设置里勾选了"不再提示"就直接删，否则弹确认框（带"以后不再提示"复选框）
      if (!settings.skipTrashConfirm) {
        const okc = await confirm({
          title: t('appctx.deleteTitle', { n: paths.length }),
          message: (
            <>
              {t('appctx.trashMsg')}
              <div style={{ marginTop: 8, maxHeight: 150, overflowY: 'auto', fontSize: 12 }}>
                {paths.slice(0, 12).map((p) => (
                  <div key={p} className="text-dim" style={{ wordBreak: 'break-all' }}>
                    {basename(p)}
                  </div>
                ))}
                {paths.length > 12 && (
                  <div className="text-dim">{t('appctx.moreItems', { n: paths.length - 12 })}</div>
                )}
              </div>
            </>
          ),
          confirmText: t('appctx.moveToTrash'),
          danger: true,
          checkbox: {
            label: t('appctx.dontAskAgain'),
            default: false,
            onConfirm: (c) => {
              if (c) patchSettings({ skipTrashConfirm: true })
            }
          }
        })
        if (!okc) return
      }
      try {
        const rs = await api.fs.trash(paths)
        const failed = rs.filter((r: any) => !r.ok)
        if (failed.length) toast(t('appctx.deleteFailed', { n: failed.length, err: failed[0].error }), 'err')
        else toast(t('appctx.movedToTrash', { n: paths.length }), 'ok')
        clearSelection()

        const deleted = new Set(paths)
        let coverBump = false
        const coverFixes: Promise<any>[] = []
        for (const p of paths) {
          const dir = dirname(p)
          const fm = folderMeta[dir]
          if (!fm) continue
          // 套图：当前封面（自动首图）被删 → 清缓存，让其重新取首图（首图变了）
          if (fm.view === 'album') {
            const cv = albumCovers.current[dir]
            if (cv && deleted.has(cv.path)) {
              delete albumCovers.current[dir]
              albumEmpty.current.delete(dir)
              coverBump = true
            }
          }
          // 手动设的封面图被删 → 回退到自动首图（套图也一并刷新缓存）
          if (fm.coverMode === 'manual' && fm.cover && deleted.has(fm.cover)) {
            coverFixes.push(
              api.db.setFolderCover(dir, null).then((m) => {
                setFolderMeta((prev) => ({ ...prev, [dir]: m }))
              }).catch(() => {})
            )
            if (fm.view === 'album') {
              delete albumCovers.current[dir]
              albumEmpty.current.delete(dir)
              coverBump = true
            }
          }
        }

        // 套图查看队列：把已删除的项摘掉，并校正当前下标
        if (queueList && queueList.some((e) => deleted.has(e.path))) {
          const next = queueList.filter((e) => !deleted.has(e.path))
          setQueueList(next)
          if (viewerIndex != null) {
            const curPath = queueList[viewerIndex]?.path
            if (curPath && deleted.has(curPath)) {
              setViewerIndex(next.length ? Math.min(viewerIndex, next.length - 1) : null)
            }
          }
        }

        if (coverBump) setAlbumVer((v) => v + 1)
        await Promise.all(coverFixes)
        refresh()
      } catch (e: any) {
        toast(e.message, 'err')
      }
    },
    [confirm, clearSelection, refresh, toast, folderMeta, queueList, viewerIndex, setQueueList, setViewerIndex, albumCovers, albumEmpty, setAlbumVer, settings, patchSettings]
  )

  const doMove = useCallback(
    async (paths: string[], target: string) => {
      if (!paths.length) return
      try {
        const rs = await api.fs.move(paths, target)
        const failed = rs.filter((r: any) => !r.ok)
        const moved = rs.filter((r: any) => r.ok && !r.skipped).length
        if (failed.length) toast(t('appctx.moveFailed', { n: failed.length, err: failed[0].error }), 'err')
        else if (moved) toast(t('appctx.moved', { n: moved, dir: basename(target) }), 'ok')
        else toast(t('appctx.alreadyInTarget'), 'info')
        clearSelection()
        refresh()
      } catch (e: any) {
        toast(e.message, 'err')
      }
    },
    [clearSelection, refresh, toast]
  )

  const doCopy = useCallback(
    async (paths: string[], target: string) => {
      if (!paths.length) return
      try {
        const rs = await api.fs.copy(paths, target)
        const failed = rs.filter((r: any) => !r.ok)
        if (failed.length) toast(t('appctx.copyFailed', { n: failed.length, err: failed[0].error }), 'err')
        else toast(t('appctx.copied', { n: paths.length, dir: basename(target) }), 'ok')
        refresh()
      } catch (e: any) {
        toast(e.message, 'err')
      }
    },
    [refresh, toast]
  )

  const doSetCover = useCallback(
    async (folderPath: string, coverPath: string | null) => {
      try {
        const m = await api.db.setFolderCover(folderPath, coverPath)
        setFolderMeta((prev) => ({ ...prev, [folderPath]: m }))
        toast(coverPath ? t('appctx.coverSet') : t('appctx.coverRestored'), 'ok')
      } catch (e: any) {
        toast(e.message, 'err')
      }
    },
    [toast]
  )

  const doToggleFavorite = useCallback(
    async (entry: Entry) => {
      const cur = entry.isDir ? folderMeta[entry.path] : itemMeta[entry.path]
      const next = !cur?.favorite
      applyMetaPatch(entry.path, entry.isDir, { favorite: next })
      try {
        await api.db.setFavorite(entry.path, entry.isDir, next)
      } catch (e: any) {
        applyMetaPatch(entry.path, entry.isDir, { favorite: !next })
        toast(e.message, 'err')
      }
    },
    [folderMeta, itemMeta, applyMetaPatch, toast]
  )

  /* ---------------- 索引 ---------------- */
  const refreshIndexStatus = useCallback(async () => {
    try {
      setIndexInfo(await api.index.status())
    } catch {}
  }, [])

  const startScan = useCallback(async () => {
    try {
      await api.index.scan()
      toast(t('appctx.indexUpdated'), 'ok')
      refreshIndexStatus()
    } catch (e: any) {
      toast(e.message, 'err')
    }
  }, [toast, refreshIndexStatus])

  const value: Ctx = {
    roots, settings, patchSettings, addRoot, removeRoot,
    tags, tagGroups, tagMap, reloadTags,
    mode, currentDir, entries, sortedEntries, fileEntries, folderEntries,
    loading, error, navigate, refresh, goUp, goBack, goForward,
    canBack: histPos.current > 0,
    canForward: histPos.current < history.current.length - 1,
    itemMeta, folderMeta, reloadMeta, applyMetaPatch,
    filters, setFilters, resetFilters, activeFilterCount, runSearch,
    activeSortBy, activeSortDir, setActiveSortBy, setActiveSortDir,
    selection, isSelected, toggleSelect, selectRange, selectOnly, selectPaths, selectAll,
    clearSelection, selectedEntries,
    viewerIndex, openViewer, closeViewer, setViewerIndex, viewerList, viewerQueueName,
    streamEntries, albumEntries, albumShown, openAlbum, setFolderView, setFoldersAlbum,
    playlists, loadPlaylists, startPlaylist, addToPlaylist,
    toasts, toast, confirm, prompt, confirmState, promptState,
    doCreateFolder, doRename, doTrash, doMove, doCopy, doSetCover, doToggleFavorite,
    indexProgress, indexInfo, startScan, refreshIndexStatus
  }

  return (
    <AppCtx.Provider value={value}>
      {children}
      <ConfirmHost state={confirmState} clear={() => setConfirmState(null)} />
      <PromptHost state={promptState} clear={() => setPromptState(null)} />
    </AppCtx.Provider>
  )
}

/* ---------------- 确认 / 输入宿主 ---------------- */

function ConfirmHost({ state, clear }: { state: any; clear: () => void }) {
  const [checked, setChecked] = useState(state?.checkbox?.default ?? false)

  useEffect(() => {
    if (!state) return
    setChecked(state.checkbox?.default ?? false)
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        state.resolve(false)
        clear()
      } else if (e.key === 'Enter') {
        state.checkbox?.onConfirm?.(checked)
        state.resolve(true)
        clear()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [state, clear, checked])

  if (!state) return null

  const ok = () => {
    state.checkbox?.onConfirm?.(checked)
    state.resolve(true)
    clear()
  }
  const cancel = () => {
    state.resolve(false)
    clear()
  }

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel()
      }}
    >
      <div className="modal" style={{ width: 420 }}>
        <div className="modal-head">{state.title}</div>
        <div className="modal-body">
          {state.message}
          {state.checkbox && (
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                marginTop: 12,
                fontSize: 13,
                cursor: 'pointer',
                userSelect: 'none'
              }}
            >
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              {state.checkbox.label}
            </label>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={cancel}>
            {t('misc.cancel')}
          </button>
          <button
            className={'btn ' + (state.danger ? 'primary' : 'primary')}
            style={state.danger ? { background: 'var(--danger)' } : undefined}
            onClick={ok}
          >
            {state.confirmText || t('appctx.confirmOk')}
          </button>
        </div>
      </div>
    </div>
  )
}

function PromptHost({ state, clear }: { state: any; clear: () => void }) {
  const [val, setVal] = useState('')
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (state) {
      setVal(state.initial || '')
      setTimeout(() => {
        ref.current?.focus()
        const v = state.initial || ''
        const dot = v.lastIndexOf('.')
        // 重命名文件时只选中主干，扩展名保持不动，少一步手动操作
        if (dot > 0) ref.current?.setSelectionRange(0, dot)
        else ref.current?.select()
      }, 30)
    }
  }, [state])

  if (!state) return null

  const submit = () => {
    state.resolve(val.trim() || null)
    clear()
  }

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          state.resolve(null)
          clear()
        }
      }}
    >
      <div className="modal" style={{ width: 400 }}>
        <div className="modal-head">{state.title}</div>
        <div className="modal-body">
          {state.label && (
            <div style={{ marginBottom: 7, color: 'var(--text-2)', fontSize: 12 }}>
              {state.label}
            </div>
          )}
          <input
            ref={ref}
            value={val}
            placeholder={state.placeholder}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') {
                state.resolve(null)
                clear()
              }
            }}
            style={{ width: '100%', height: 34 }}
          />
        </div>
        <div className="modal-foot">
          <button
            className="btn ghost"
            onClick={() => {
              state.resolve(null)
              clear()
            }}
          >
            {t('misc.cancel')}
          </button>
          <button className="btn primary" onClick={submit} disabled={!val.trim()}>
            {state.confirmText || t('appctx.confirmOk')}
          </button>
        </div>
      </div>
    </div>
  )
}
