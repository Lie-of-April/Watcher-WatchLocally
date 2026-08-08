import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { getThumb, peekThumb } from '@/lib/thumbnail'
import { readMediaBytes, parseMultiFrameJpeg, ensureGifLoop } from '@/lib/anim'
import {
  basename,
  clamp,
  formatDate,
  formatDuration,
  formatSize,
  isPlayableVideo,
  kindLabel
} from '@/lib/utils'
import { useApp } from '@/store/AppContext'
import { MangaStrip } from './MangaStrip'
import {
  IconChevronLeft,
  IconChevronRight,
  IconFolderOpen,
  IconHeart,
  IconImage,
  IconInfo,
  IconMaximize,
  IconPause,
  IconPlay,
  IconStar,
  IconTrash,
  IconVideo,
  IconX,
  IconZoomIn,
  IconZoomOut,
  IconQueue
} from './Icons'
import type { Entry, Tag } from '@/types'
import { t } from '@/i18n/strings'

const MIN_ZOOM = 0.2
const MAX_ZOOM = 32
/** 胶片条只渲染当前项前后各 N 项，目录里上万个文件也不会卡 */
const FILM_WINDOW = 30
/** 多帧 JPEG 的帧间隔（毫秒） */
const MJPEG_INTERVAL = 110

/* ---------------- 本地图标 ---------------- */
function IconVol({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5 6 9H2v6h4l5 4V5z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  )
}
function IconVolMute({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5 6 9H2v6h4l5 4V5z" />
      <line x1="22" y1="9" x2="16" y2="15" />
      <line x1="16" y1="9" x2="22" y2="15" />
    </svg>
  )
}
function IconPixel({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}
function IconManga({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <line x1="5" y1="9" x2="19" y2="9" />
      <line x1="5" y1="15" x2="19" y2="15" />
    </svg>
  )
}

/* ---------------- 小工具 ---------------- */

function hexRgb(hex: string): [number, number, number] {
  const s = String(hex || '').replace('#', '').trim()
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s
  const n = parseInt(full, 16)
  if (!/^[0-9a-f]{6}$/i.test(full) || Number.isNaN(n)) return [136, 136, 136]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function chipStyle(color: string): React.CSSProperties {
  const [r, g, b] = hexRgb(color)
  const tint = (c: number) => Math.round(c + (255 - c) * 0.74)
  const ink = (c: number) => Math.round(c * 0.36)
  const [ir, ig, ib] = [ink(r), ink(g), ink(b)]
  const lum = (0.299 * ir + 0.587 * ig + 0.114 * ib) / 255
  return {
    background: `rgba(${tint(r)}, ${tint(g)}, ${tint(b)}, 0.96)`,
    borderColor: `rgba(${r}, ${g}, ${b}, 0.5)`,
    color: lum > 0.45 ? '#1c1e21' : `rgb(${ir}, ${ig}, ${ib})`
  }
}

/** 滑块渐变填充 */
function rangeFill(ratio: number): React.CSSProperties {
  const pct = clamp(ratio, 0, 1) * 100
  return {
    background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, var(--border-strong) ${pct}%, var(--border-strong) 100%)`
  }
}

/* ---------------- 胶片条缩略图 ---------------- */

function FilmThumb({ entry }: { entry: Entry }) {
  const cached = peekThumb(entry)
  const [url, setUrl] = useState<string | null>(cached?.url ?? null)
  const [done, setDone] = useState(!!cached)

  useEffect(() => {
    const hit = peekThumb(entry)
    if (hit) {
      setUrl(hit.url)
      setDone(true)
      return
    }
    setUrl(null)
    setDone(false)
    let cancelled = false
    getThumb(entry).then((r) => {
      if (cancelled) return
      setUrl(r.url)
      setDone(true)
    })
    return () => {
      cancelled = true
    }
  }, [entry.path, entry.mtime, entry.size])

  if (url) return <img src={url} alt="" draggable={false} decoding="async" loading="lazy" onError={() => setUrl(null)} />
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'grid',
        placeItems: 'center',
        color: done ? '#6e747d' : '#4a4e56'
      }}
    >
      {entry.kind === 'video' ? <IconVideo size={16} /> : <IconImage size={16} />}
    </div>
  )
}

/* ---------------- 主体 ---------------- */

export function Viewer({ onContext }: { onContext?: (e: Entry, ev: React.MouseEvent) => void }) {
  const {
    viewerIndex,
    setViewerIndex,
    closeViewer,
    viewerList,
    itemMeta,
    applyMetaPatch,
    tags,
    tagMap,
    reloadTags,
    toast,
    doToggleFavorite,
    doTrash,
    confirmState,
    promptState,
    settings,
    patchSettings,
    viewerQueueName
  } = useApp()

  const entry: Entry | null = viewerIndex == null ? null : viewerList[viewerIndex] || null

  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [anim, setAnim] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [mediaError, setMediaError] = useState(false)
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 })
  const [tagInput, setTagInput] = useState('')
  const [tagBusy, setTagBusy] = useState(false)
  const [freshTags, setFreshTags] = useState<Record<string, Tag>>({})
  const [exif, setExif] = useState<Record<string, string> | null>(null)
  const [spaceMode, setSpaceMode] = useState(false)

  // 像素艺术（硬边缘采样）
  const [pixelArt, setPixelArt] = useState(false)
  // 图片源（GIF 强制循环 / 多帧 JPEG 会换成 blob URL）
  const [imgSrc, setImgSrc] = useState<string | null>(null)
  const [multiFrames, setMultiFrames] = useState<string[] | null>(null)
  const [frameIdx, setFrameIdx] = useState(0)
  // 视频控制条显隐
  const [controlsVisible, setControlsVisible] = useState(true)

  // 视频控制状态
  const [playing, setPlaying] = useState(false)
  // 阅读模式：'horizontal' 横向翻页（默认；滚轮左右切图、Ctrl+滚轮缩放当前图） / 'manga' 套图纵向无缝滚动（漫画式，记忆阅读进度）
  const [readMode, setReadMode] = useState<'horizontal' | 'manga'>('horizontal')
  const mangaScrollRef = useRef<HTMLDivElement | null>(null)
  // 漫画模式页宽（%）：30~120，默认 100 填满宽度；可缩小以便一屏看更多
  const [mangaZoom, setMangaZoom] = useState(100)
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)
  const [vol, setVol] = useState(1)
  const [muted, setMuted] = useState(false)
  const [rate, setRate] = useState(1)
  const [loop, setLoop] = useState(true)
  const [listPlay, setListPlay] = useState(false)
  const [isFs, setIsFs] = useState(false)
  // 漫画模式下：左键点击页面可隐藏/唤出底部图片列表（仿视频左键切换控件）
  const [showFilm, setShowFilm] = useState(true)
  // 音量 / 倍速的隐藏式浮层（默认只显示图标，悬浮/点击才展开）
  const [volOpen, setVolOpen] = useState(false)
  const [volPin, setVolPin] = useState(false)
  const [rateOpen, setRateOpen] = useState(false)
  const [ratePin, setRatePin] = useState(false)

  const stageRef = useRef<HTMLDivElement>(null)
  const viewerRootRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const activeFilmRef = useRef<HTMLButtonElement>(null)
  const filmRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(1)
  const panRef = useRef({ x: 0, y: 0 })
  const dragRef = useRef<{ x: number; y: number; px: number; py: number; onContent: boolean } | null>(null)
  const spaceRef = useRef(false)
  const draggedRef = useRef(false)
  const setRatingRef = useRef<(n: number) => void>(() => {})

  const isImage = !!entry && (entry.kind === 'image' || entry.kind === 'gif')
  const isVideo = !!entry && entry.kind === 'video'
  const videoPlayable = isVideo && isPlayableVideo(entry!.ext)

  // 始终持有最新 settings，供持久化 effect 读取，避免 effect 因 settings 变化而反复重跑
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  useEffect(() => {
    zoomRef.current = zoom
    panRef.current = pan
  }, [zoom, pan])

  /* 切到新项目：缩放/平移/尺寸信息全部归零，否则会带着上一张的状态 */
  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setDragging(false)
    setAnim(false)
    setSpaceMode(false)
    spaceRef.current = false
    draggedRef.current = false
    setDims(null)
    setDuration(null)
    setMediaError(false)
    setTagInput('')
    setPlaying(false)
    setCur(0)
    setDur(0)
    setRate(1)
    setLoop(true)
    setListPlay(false)
    setVolOpen(false)
    setRateOpen(false)
    setShowFilm(true)
    setPixelArt(false)
    setImgSrc(null)
    setMultiFrames(null)
    setFrameIdx(0)
    setControlsVisible(true)
  }, [entry?.path])

  /* 漫画模式页宽只在切换「不同套图」时归位，套图内翻页（entry?.path 变但 albumPath 不变）保持统一，
     这样滚动到新图片不会丢失缩放 */
  useEffect(() => {
    setMangaZoom(100)
  }, [entry?.albumPath])

  /* 套图：进入时按记忆恢复阅读模式（横向 / 漫画）。漫画模式额外恢复到上次读到的页码。
     只在「套图切换」(albumPath 变化，含 null→值、值→值) 时跑；套图内翻页 albumPath 不变，不重跑，
     避免每次切图都被拽回旧进度。 */
  useEffect(() => {
    const ap = entry?.albumPath
    if (!ap) return
    const savedMode = settingsRef.current.albumReadMode?.[ap] || 'horizontal'
    setReadMode(savedMode)
    if (savedMode === 'manga') {
      const prog = settingsRef.current.albumProgress?.[ap]
      if (typeof prog === 'number' && prog >= 0 && prog < viewerList.length) {
        setViewerIndex(prog)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.albumPath])

  /* 套图：阅读模式一旦变化就记忆（每个套图独立） */
  useEffect(() => {
    const ap = entry?.albumPath
    if (!ap) return
    if (settingsRef.current.albumReadMode?.[ap] === readMode) return
    patchSettings({ albumReadMode: { ...(settingsRef.current.albumReadMode || {}), [ap]: readMode } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readMode, entry?.albumPath])

  /* 套图：漫画模式下实时记忆阅读进度（当前页码），下次以漫画模式打开自动恢复到这一页 */
  useEffect(() => {
    const ap = entry?.albumPath
    if (!ap || readMode !== 'manga' || viewerIndex == null) return
    if (settingsRef.current.albumProgress?.[ap] === viewerIndex) return
    patchSettings({ albumProgress: { ...(settingsRef.current.albumProgress || {}), [ap]: viewerIndex } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerIndex, readMode, entry?.albumPath])

  /* 删除、刷新之后列表会变短，下标要跟着收敛，不然会停在空白项上 */
  useEffect(() => {
    if (viewerIndex == null) return
    if (!viewerList.length) {
      closeViewer()
      return
    }
    if (viewerIndex > viewerList.length - 1) setViewerIndex(viewerList.length - 1)
  }, [viewerIndex, viewerList, setViewerIndex, closeViewer])

  /* 舞台尺寸用于算「适应窗口」的比例，窗口缩放时要跟着更新 */
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => setStageSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [viewerIndex == null])

  /* EXIF：图片加载后取一次拍摄信息 */
  useEffect(() => {
    if (!isImage) {
      setExif(null)
      return
    }
    let cancelled = false
    setExif(null)
    api.fs
      .exif(entry!.path)
      .then((r) => {
        if (!cancelled) setExif(r || null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [entry?.path, isImage])

  /* 图片源：GIF 强制循环 / 多帧 JPEG 拆帧 */
  useEffect(() => {
    if (!isImage || !entry) return
    let cancelled = false
    const made: string[] = []
    const cleanup = () => made.forEach((u) => URL.revokeObjectURL(u))
    setImgSrc(api.mediaUrl(entry.path))
    setMultiFrames(null)
    setFrameIdx(0)
    ;(async () => {
      const needGif = entry.kind === 'gif' && settings.loopAnim
      const maybeMulti = entry.kind === 'image' && /\.jpe?g$/i.test(entry.ext)
      if (!needGif && !maybeMulti) return
      try {
        const buf = await readMediaBytes(api.mediaUrl(entry.path))
        if (cancelled) return
        if (needGif) {
          const forced = ensureGifLoop(buf)
          if (forced) {
            made.push(forced)
            setImgSrc(forced)
          }
        } else if (maybeMulti) {
          const frames = parseMultiFrameJpeg(buf)
          if (frames && frames.length > 1) {
            made.push(...frames)
            setImgSrc(frames[0])
            setMultiFrames(frames)
          }
        }
      } catch {
        /* 忽略，退回原图 */
      }
    })()
    return () => {
      cancelled = true
      cleanup()
    }
  }, [entry?.path, isImage, settings.loopAnim])

  /* 多帧 JPEG 轮播 */
  useEffect(() => {
    if (!multiFrames || multiFrames.length < 2) return
    const t = setInterval(() => setFrameIdx((i) => (i + 1) % multiFrames.length), MJPEG_INTERVAL)
    return () => clearInterval(t)
  }, [multiFrames])

  const displaySrc = multiFrames ? multiFrames[frameIdx] : imgSrc

  const fitScale = useMemo(() => {
    if (!dims || !dims.w || !dims.h || !stageSize.w || !stageSize.h) return 1
    return Math.min(1, stageSize.w / dims.w, stageSize.h / dims.h)
  }, [dims, stageSize])

  const clampPan = useCallback(
    (p: { x: number; y: number }, z: number) => {
      if (!dims) return p
      const sw = dims.w * fitScale * z
      const sh = dims.h * fitScale * z
      // 图片比视口小：平移限制在信箱内（图片不超出窗口），可自由摆放但不会被拖出屏幕；
      // 比视口大：按溢出边缘夹紧。两种情形在「正好铺满」处都收敛到 0，
      // 所以 <100% → 100% → >100% 缩放过程中平移连续、不会跳回正中心，焦点得以继承。
      const lx = Math.abs(sw - stageSize.w) / 2
      const ly = Math.abs(sh - stageSize.h) / 2
      return { x: clamp(p.x, -lx, lx), y: clamp(p.y, -ly, ly) }
    },
    [dims, fitScale, stageSize]
  )

  const resetZoom = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  /** cx/cy 是相对舞台中心的缩放锚点，默认取中心；animate 控制是否带过渡动画 */
  const zoomTo = useCallback(
    (next: number, cx = 0, cy = 0, animate = false) => {
      const cur = zoomRef.current
      const z = clamp(next, MIN_ZOOM, MAX_ZOOM)
      if (Math.abs(z - 1) < 0.02) {
        setAnim(animate)
        resetZoom()
        return
      }
      const p = panRef.current
      const k = z / cur
      setZoom(z)
      setAnim(animate)
      setPan(clampPan({ x: cx - k * (cx - p.x), y: cy - k * (cy - p.y) }, z))
    },
    [clampPan, resetZoom]
  )

  /* 底部胶片条：纵向滚轮转横向滚动，方便浏览列表（查看器内滚轮不直接缩放列表） */
  useEffect(() => {
    const el = filmRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.deltaX !== 0) return
      el.scrollLeft += e.deltaY
      e.preventDefault()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  /* 拖动挂在 window 上，指针滑出图片甚至滑出窗口也不会丢掉 mouseup。
     干净点击（无位移）且点在黑边空白区才关闭查看器；点在图片上不关闭。 */
  useEffect(() => {
    if (!dragging) return
    const move = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) draggedRef.current = true
      setPan(clampPan({ x: d.px + dx, y: d.py + dy }, zoomRef.current))
    }
    const up = () => {
      setDragging(false)
      const d = dragRef.current
      dragRef.current = null
      if (d && !draggedRef.current && !d.onContent && !spaceRef.current) closeViewer()
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [dragging, clampPan, closeViewer])

  /* 全屏状态同步 */
  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  /* ---------------- 动作 ---------------- */

  const go = useCallback(
    (delta: number) => {
      if (viewerIndex == null) return
      const next = viewerIndex + delta
      if (next < 0 || next >= viewerList.length) return
      setViewerIndex(next)
    },
    [viewerIndex, viewerList.length, setViewerIndex]
  )

  /* 漫画模式：纵向滚动一屏的 90% */
  const scrollManga = useCallback((dir: number) => {
    const c = mangaScrollRef.current
    if (!c) return
    c.scrollBy({ top: dir * c.clientHeight * 0.9, behavior: 'smooth' })
  }, [])

  /* React 把 wheel 注册成被动监听，preventDefault 会失效，只能自己挂一个非被动的。
     漫画模式也挂载监听（不依赖 isImage），保证首次进入套图时 Ctrl+滚轮就能缩放页宽。
     三种情形：
       - manga 模式：Ctrl+滚轮缩放页宽，普通滚轮交给原生纵向滚动
       - horizontal 模式 + 套图：普通滚轮左右切图，仅 Ctrl+滚轮缩放当前图
       - 其余（单图 / 兜底）：滚轮缩放当前图 */
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    if (!isImage && readMode !== 'manga') return
    const onWheel = (e: WheelEvent) => {
      if (readMode === 'manga') {
        if (e.ctrlKey) {
          e.preventDefault()
          setMangaZoom((z) => clamp(Math.round(z * Math.exp(-e.deltaY * 0.0016)), 30, 400))
        }
        return
      }
      if (readMode === 'horizontal' && entry?.albumPath) {
        e.preventDefault()
        if (e.ctrlKey) {
          const r = el.getBoundingClientRect()
          zoomTo(
            zoomRef.current * Math.exp(-e.deltaY * 0.0016 * (settings.zoomSensitivity || 1)),
            e.clientX - (r.left + r.width / 2),
            e.clientY - (r.top + r.height / 2)
          )
        } else {
          go(e.deltaY > 0 ? 1 : -1)
        }
        return
      }
      // 单图 / 兜底：滚轮缩放
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomTo(
        zoomRef.current * Math.exp(-e.deltaY * 0.0016 * (settings.zoomSensitivity || 1)),
        e.clientX - (r.left + r.width / 2),
        e.clientY - (r.top + r.height / 2)
      )
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [isImage, zoomTo, settings.zoomSensitivity, readMode, go, entry?.albumPath])

  const meta = entry ? itemMeta[entry.path] : undefined
  const tagIds = meta?.tags || []
  const favorite = !!meta?.favorite
  const rating = meta?.rating || 0

  const toggleFit = useCallback(() => {
    if (zoomRef.current !== 1) {
      resetZoom()
      return
    }
    const target = fitScale > 0 ? 1 / fitScale : 1
    if (target > 1.02) zoomTo(target, 0, 0, true)
  }, [fitScale, zoomTo, resetZoom])

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play().catch(() => {})
    else v.pause()
  }, [])

  const seekBy = useCallback(
    (delta: number) => {
      const v = videoRef.current
      if (!v || !Number.isFinite(v.duration)) return
      v.currentTime = clamp(v.currentTime + delta, 0, v.duration)
    },
    []
  )

  const onDelete = useCallback(() => {
    if (entry) doTrash([entry.path])
  }, [entry, doTrash])

  /* 空格：视频交给播放/暂停；图片用于平移/下一张（见下方 space 效果） */
  useEffect(() => {
    if (viewerIndex == null || !entry) return
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      // 只放行文本输入类控件（避免抢走打字）；滑块/下拉/按钮上的方向键照常接管视频控制
      const isTextEntry =
        tag === 'TEXTAREA' ||
        (tag === 'INPUT' && ((t as HTMLInputElement).type === 'text' || (t as HTMLInputElement).type === 'search')) ||
        (t as HTMLElement).isContentEditable
      if (isTextEntry) return
      if (confirmState || promptState) return

      // 视频：空格播放/暂停；左右快进退；Alt+左右切视频；上下调音量
      if (videoPlayable) {
        if (e.code === 'Space') {
          e.preventDefault()
          togglePlay()
        } else if (e.key === 'ArrowLeft' && e.altKey) {
          e.preventDefault()
          go(-1)
        } else if (e.key === 'ArrowRight' && e.altKey) {
          e.preventDefault()
          go(1)
        } else if (e.key === 'ArrowLeft' && !e.altKey) {
          e.preventDefault()
          seekBy(-(settings.videoSeek || 15))
        } else if (e.key === 'ArrowRight' && !e.altKey) {
          e.preventDefault()
          seekBy(settings.videoSeek || 15)
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          const v = videoRef.current
          if (v) {
            v.volume = clamp(v.volume + 0.1, 0, 1)
            setVol(v.volume)
            if (v.volume > 0) setMuted(false)
          }
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          const v = videoRef.current
          if (v) {
            v.volume = clamp(v.volume - 0.1, 0, 1)
            setVol(v.volume)
            setMuted(v.volume === 0)
          }
        } else if (e.key === 'Home') {
          e.preventDefault()
          setViewerIndex(0)
        } else if (e.key === 'End') {
          e.preventDefault()
          setViewerIndex(viewerList.length - 1)
        } else if (e.key === 'Delete') {
          e.preventDefault()
          onDelete()
        } else if (e.key === 'f' || e.key === 'F') {
          e.preventDefault()
          doToggleFavorite(entry)
        } else if (e.key === 'i' || e.key === 'I') {
          e.preventDefault()
          setShowInfo((v) => !v)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          closeViewer()
        }
        return
      }

      // 图片 / GIF：漫画模式（纵向滚动）优先接管方向键
      if (readMode === 'manga') {
        const h = mangaScrollRef.current?.clientHeight || 800
        switch (e.key) {
          case 'ArrowUp':
            e.preventDefault()
            scrollManga(-1)
            return
          case 'ArrowDown':
            e.preventDefault()
            scrollManga(1)
            return
          case 'ArrowLeft':
            e.preventDefault()
            go(-1)
            return
          case 'ArrowRight':
            e.preventDefault()
            go(1)
            return
          case ' ':
            e.preventDefault()
            scrollManga(1)
            return
          case 'Home':
            e.preventDefault()
            setViewerIndex(0)
            return
          case 'End':
            e.preventDefault()
            setViewerIndex(viewerList.length - 1)
            return
          default:
            break
        }
        // 其余键（f/i/Esc/Delete/+/-/0）继续走下面的通用分支
      }

      // 图片 / GIF：左右、上下都可切换（套图/画廊里上下也能翻页）
      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault()
          go(-1)
          break
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault()
          go(1)
          break
        case 'Home':
          e.preventDefault()
          setViewerIndex(0)
          break
        case 'End':
          e.preventDefault()
          setViewerIndex(viewerList.length - 1)
          break
        case 'Escape':
          e.preventDefault()
          closeViewer()
          break
        case 'f':
        case 'F':
          e.preventDefault()
          doToggleFavorite(entry)
          break
        case 'i':
        case 'I':
          e.preventDefault()
          setShowInfo((v) => !v)
          break
        case 'Delete':
          e.preventDefault()
          onDelete()
          break
        case '+':
        case '=':
          e.preventDefault()
          if (isImage) zoomTo(zoomRef.current * 1.25, 0, 0, true)
          break
        case '-':
        case '_':
          e.preventDefault()
          if (isImage) zoomTo(zoomRef.current / 1.25, 0, 0, true)
          break
        case '0':
          e.preventDefault()
          resetZoom()
          break
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
          e.preventDefault()
          if (entry) setRatingRef.current(Number(e.key))
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    viewerIndex,
    entry,
    confirmState,
    promptState,
    go,
    setViewerIndex,
    viewerList.length,
    closeViewer,
    videoPlayable,
    togglePlay,
    seekBy,
    settings.videoSeek,
    doToggleFavorite,
    onDelete,
    isImage,
    zoomTo,
    resetZoom,
    readMode,
    scrollManga
  ])

  /* 空格平移（仅图片）：按住平移，轻点下一张 */
  useEffect(() => {
    if (viewerIndex == null || !entry || videoPlayable || readMode === 'manga') return
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.code === 'Space') {
        e.preventDefault()
        if (!spaceRef.current) {
          spaceRef.current = true
          setSpaceMode(true)
        }
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      const was = spaceRef.current
      spaceRef.current = false
      setSpaceMode(false)
      if (was && !draggedRef.current) go(1)
      draggedRef.current = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [viewerIndex, entry, videoPlayable, readMode, go])

  const onReveal = useCallback(async () => {
    if (!entry) return
    try {
      await api.fs.reveal(entry.path)
    } catch (e: any) {
      toast(e.message || t('viewer.locateFailed'), 'err')
    }
  }, [entry, toast])

  const onOpenExternal = useCallback(async () => {
    if (!entry) return
    try {
      await api.fs.openExternal(entry.path)
    } catch (e: any) {
      toast(e.message || t('viewer.openExtFailed'), 'err')
    }
  }, [entry, toast])

  /* ---------------- 视频控制 ---------------- */

  const onSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current
    if (v) v.currentTime = Number(e.target.value)
  }, [])
  const onVol = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current
    const x = Number(e.target.value)
    if (v) {
      v.volume = x
      v.muted = x === 0
    }
  }, [])
  const onRate = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = videoRef.current
    const x = Number(e.target.value)
    if (v) v.playbackRate = x
    setRate(x)
  }, [])
  // 循环播放 与 按列表播放 二选一：开启其一即关闭另一个
  const toggleLoop = useCallback(() => {
    const next = !loop
    setLoop(next)
    if (next) setListPlay(false)
    if (videoRef.current) videoRef.current.loop = next
  }, [loop])

  const toggleListPlay = useCallback(() => {
    const next = !listPlay
    setListPlay(next)
    if (next) setLoop(false)
    if (videoRef.current) videoRef.current.loop = false
  }, [listPlay])
  const toggleMute = useCallback(() => {
    setMuted((m) => {
      if (videoRef.current) videoRef.current.muted = !m
      return !m
    })
  }, [])
  const toggleFs = useCallback(() => {
    const el = viewerRootRef.current
    if (!el) return
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else el.requestFullscreen?.().catch(() => {})
  }, [])

  /** 视频播完：开启"按列表播放"且还有下一项时，自动切到下一个 */
  const onEnded = useCallback(() => {
    if (listPlay && viewerIndex != null && viewerIndex < viewerList.length - 1) go(1)
  }, [listPlay, viewerIndex, viewerList.length, go])

  /* ---------------- 标签 / 评分 ---------------- */

  const commitTags = useCallback(
    async (next: string[]) => {
      if (!entry) return
      const prev = tagIds
      applyMetaPatch(entry.path, false, { tags: next })
      try {
        await api.db.setItemTags(entry.path, next)
      } catch (e: any) {
        applyMetaPatch(entry.path, false, { tags: prev })
        toast(e.message || t('viewer.tagSaveFailed'), 'err')
      }
    },
    [entry, tagIds, applyMetaPatch, toast]
  )

  const addTagByName = useCallback(
    async (name: string) => {
      const n = name.trim()
      if (!entry || !n || tagBusy) return
      setTagBusy(true)
      try {
        const lower = n.toLowerCase()
        let tag =
          tags.find((t) => t.name.toLowerCase() === lower) ||
          Object.values(freshTags).find((t) => t.name.toLowerCase() === lower)
        if (!tag) {
          tag = await api.db.createTag({ name: n })
          setFreshTags((m) => ({ ...m, [tag!.id]: tag! }))
          reloadTags()
        }
        if (!tagIds.includes(tag.id)) await commitTags([...tagIds, tag.id])
        setTagInput('')
      } catch (e: any) {
        toast(e.message || t('viewer.tagAddFailed'), 'err')
      } finally {
        setTagBusy(false)
      }
    },
    [entry, tagBusy, tags, freshTags, tagIds, commitTags, reloadTags, toast]
  )

  const removeTag = useCallback(
    (id: string) => commitTags(tagIds.filter((t) => t !== id)),
    [commitTags, tagIds]
  )

  const setRating = useCallback(
    async (n: number) => {
      if (!entry) return
      const value = rating === n ? 0 : n
      applyMetaPatch(entry.path, entry.isDir, { rating: value })
      try {
        await api.db.setRating(entry.path, entry.isDir, value)
      } catch (e: any) {
        applyMetaPatch(entry.path, entry.isDir, { rating })
        toast(e.message || t('viewer.ratingSaveFailed'), 'err')
      }
    },
    [entry, rating, applyMetaPatch, toast]
  )
  setRatingRef.current = setRating

  const suggestions = useMemo(() => {
    const q = tagInput.trim().toLowerCase()
    if (!q) return []
    return tags.filter((t) => t.name.toLowerCase().includes(q) && !tagIds.includes(t.id)).slice(0, 8)
  }, [tagInput, tags, tagIds])

  /* ---------------- 快捷键 ---------------- */

  /* 当前项滚进胶片条可视区 */
  useEffect(() => {
    activeFilmRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [viewerIndex])

  if (viewerIndex == null || !entry) return null

  const canPrev = viewerIndex > 0
  const canNext = viewerIndex < viewerList.length - 1
  const zoomed = zoom !== 1
  const from = Math.max(0, viewerIndex - FILM_WINDOW)
  const film = viewerList.slice(from, Math.min(viewerList.length, viewerIndex + FILM_WINDOW + 1))
  const lookupTag = (id: string): Tag | undefined => tagMap[id] || freshTags[id]

  const curLabel = formatDuration(cur)
  const durLabel = formatDuration(dur)
  const volRatio = muted ? 0 : vol

  /* ---------------- 舞台内容 ---------------- */

  let stageContent: React.ReactNode
  if (isVideo && !videoPlayable) {
    stageContent = (
      <div className="empty" style={{ color: '#9aa0a6' }}>
        <IconVideo size={44} className="big" />
        <div className="t" style={{ color: '#e8eaed' }}>
          {t('viewer.containerUnsupported', { ext: entry.ext.replace('.', '').toUpperCase() })}
        </div>
        <div className="d">{t('viewer.containerHint')}</div>
        <div className="row">
          <button className="btn primary" onClick={onOpenExternal}>
            <IconPlay size={14} />
            {t('viewer.openWithPlayer')}
          </button>
          <button className="btn ghost" style={{ color: '#cdd1d6' }} onClick={onReveal}>
            <IconFolderOpen size={14} />
            {t('misc.revealInExplorer')}
          </button>
        </div>
      </div>
    )
  } else if (mediaError) {
    stageContent = (
      <div className="empty" style={{ color: '#9aa0a6' }}>
        <IconImage size={44} className="big" />
        <div className="t" style={{ color: '#e8eaed' }}>{t('viewer.loadFailed')}</div>
        <div className="d">{t('viewer.loadHint')}</div>
        <div className="row">
          <button className="btn ghost" style={{ color: '#cdd1d6' }} onClick={onReveal}>
            <IconFolderOpen size={14} />
            {t('misc.revealInExplorer')}
          </button>
        </div>
      </div>
    )
  } else if (isVideo) {
    stageContent = (
      <div className="v-video-wrap">
        <video
          ref={videoRef}
          key={entry.path}
          src={api.mediaUrl(entry.path)}
          loop={loop}
          muted={muted}
          playsInline
          onClick={() => setControlsVisible((v) => !v)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget
            setDims({ w: v.videoWidth, h: v.videoHeight })
            setDur(v.duration)
            setVol(v.volume)
            setMuted(v.muted)
          }}
          onVolumeChange={(e) => {
            setVol(e.currentTarget.volume)
            setMuted(e.currentTarget.muted)
          }}
          onEnded={onEnded}
          onError={() => setMediaError(true)}
        />
        {controlsVisible && (
          <div className="v-controls" onMouseDown={(e) => e.stopPropagation()}>
            <button className="v-btn" onClick={togglePlay} title={playing ? t('viewer.pauseSpace') : t('viewer.playSpace')}>
              {playing ? <IconPause size={18} /> : <IconPlay size={18} />}
            </button>
            <span className="v-time">{curLabel}</span>
            <input
              className="slider v-seek"
              type="range"
              min={0}
              max={dur || 0}
              step={0.1}
              value={Math.min(cur, dur || 0)}
              style={rangeFill(dur ? cur / dur : 0)}
              onChange={onSeek}
              onMouseUp={(e) => (e.currentTarget as HTMLInputElement).blur()}
            />
            <span className="v-time">{durLabel}</span>

            {/* 音量：默认只显示图标，悬浮/点击才展开滑动条 */}
            <div
              className="v-ctl-group"
              onMouseEnter={() => setVolOpen(true)}
              onMouseLeave={() => { if (!volPin) setVolOpen(false) }}
            >
              <button
                className="v-btn"
                onClick={() => { setVolPin((p) => !p); setVolOpen(true) }}
                title={muted || vol === 0 ? t('viewer.unmute') : t('viewer.volume')}
              >
                {muted || vol === 0 ? <IconVolMute /> : <IconVol />}
              </button>
              {volOpen && (
                <div className="v-pop" onMouseDown={(e) => e.stopPropagation()}>
                  <button className="v-btn" onClick={toggleMute} title={muted ? t('viewer.unmute') : t('viewer.mute')}>
                    {muted || vol === 0 ? <IconVolMute size={15} /> : <IconVol size={15} />}
                  </button>
                  <input
                    className="slider v-vol"
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={volRatio}
                    style={{ ...rangeFill(volRatio), width: 92 }}
                    onChange={onVol}
                    onMouseUp={(e) => (e.currentTarget as HTMLInputElement).blur()}
                  />
                </div>
              )}
            </div>

            {/* 倍速：默认只显示当前倍速，悬浮/点击才展开下拉 */}
            <div
              className="v-ctl-group"
              onMouseEnter={() => setRateOpen(true)}
              onMouseLeave={() => { if (!ratePin) setRateOpen(false) }}
            >
              <button
                className="v-btn v-rate-btn"
                onClick={() => { setRatePin((p) => !p); setRateOpen(true) }}
                title={t('viewer.playbackSpeed')}
              >
                {rate}x
              </button>
              {rateOpen && (
                <div className="v-pop" onMouseDown={(e) => e.stopPropagation()}>
                  <select
                    className="v-rate"
                    value={rate}
                    onChange={(e) => { onRate(e); setRateOpen(false) }}
                  >
                    {[2, 1.5, 1.25, 1, 0.5].map((r) => (
                      <option key={r} value={r}>{r}x</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <button className={'v-btn' + (loop ? ' on' : '')} onClick={toggleLoop} title={t('viewer.loopTitle')}>
              ↻
            </button>
            <button
              className={'v-btn' + (listPlay ? ' on' : '')}
              onClick={toggleListPlay}
              title={t('viewer.listPlayTitle')}
            >
              <IconQueue size={16} />
            </button>
            <button className={'v-btn' + (isFs ? ' on' : '')} onClick={toggleFs} title={t('viewer.fullscreen')}>
              <IconMaximize />
            </button>
          </div>
        )}
      </div>
    )
  } else {
    stageContent = (
      <img
        key={entry.path}
        src={displaySrc || api.mediaUrl(entry.path)}
        alt={entry.name}
        draggable={false}
        decoding="async"
        className={
          (dims ? 'zoomed' : '') +
          (dragging ? ' dragging' : '') +
          (anim && !dragging ? ' anim' : '') +
          (pixelArt || settings.imageSampling === 'nearest' ? ' pixelated' : '')
        }
        style={dims ? { transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom * fitScale})` } : undefined}
        onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        onError={() => setMediaError(true)}
        onDoubleClick={toggleFit}
      />
    )
  }

  return (
    <div
      className="viewer"
      ref={viewerRootRef}
      onContextMenu={(e) => {
        const t = e.target as HTMLElement | null
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
        if (onContext && entry) onContext(entry, e)
      }}
    >
      <div className="viewer-top">
        <span className="v-title" title={entry.path}>
          {viewerQueueName && (
            <span className="v-queue" title={t('viewer.queuePlaying')}>
              ▶ {viewerQueueName}
            </span>
          )}
          {entry.name || basename(entry.path)}
        </span>
        <span className="ext-badge">{entry.ext.replace('.', '').toUpperCase()}</span>
        <span className="v-idx">
          {t('viewer.position', { n: viewerIndex + 1, total: viewerList.length })}
        </span>
        <div className="row" style={{ gap: 2 }}>
          {isImage && readMode !== 'manga' && (
            <button
              className={'v-btn' + (pixelArt ? ' on' : '')}
              title={t('viewer.pixelate')}
              onClick={() => setPixelArt((v) => !v)}
            >
              <IconPixel />
            </button>
          )}
          <button
            className="v-btn"
            title={readMode === 'manga' ? t('viewer.zoomOutManga') : t('viewer.zoomOut')}
            disabled={!isImage}
            onClick={() =>
              readMode === 'manga'
                ? setMangaZoom((z) => clamp(Math.round(z / 1.25), 30, 400))
                : zoomTo(zoom / 1.25, 0, 0, true)
            }
          >
            <IconZoomOut />
          </button>
          <button
            className="v-btn"
            title={readMode === 'manga' ? t('viewer.zoomInManga') : t('viewer.zoomIn')}
            disabled={!isImage}
            onClick={() =>
              readMode === 'manga'
                ? setMangaZoom((z) => clamp(Math.round(z * 1.25), 30, 400))
                : zoomTo(zoom * 1.25, 0, 0, true)
            }
          >
            <IconZoomIn />
          </button>
          {readMode === 'manga' && isImage && (
            <span className="v-zoom-label">{mangaZoom}%</span>
          )}
          <button
            className="v-btn"
            title={readMode === 'manga' ? t('viewer.fitWidth') : t('viewer.fitWindow')}
            onClick={() => (readMode === 'manga' ? setMangaZoom(100) : resetZoom())}
          >
            <IconMaximize />
          </button>
          {entry.albumPath && (
            <button
              className={'v-btn' + (readMode === 'manga' ? ' on' : '')}
              title={readMode === 'manga' ? t('viewer.horizMode') : t('viewer.mangaMode')}
              onClick={() => setReadMode((m) => (m === 'manga' ? 'horizontal' : 'manga'))}
            >
              <IconManga />
            </button>
          )}
          <button
            className={'v-btn' + (favorite ? ' on' : '')}
            style={favorite ? { color: 'var(--danger)' } : undefined}
            title={t('viewer.favTitle')}
            onClick={() => doToggleFavorite(entry)}
          >
            <IconHeart />
          </button>
          <button className={'v-btn' + (showInfo ? ' on' : '')} title={t('viewer.infoTitle')} onClick={() => setShowInfo((v) => !v)}>
            <IconInfo />
          </button>
          <button className="v-btn" title={t('misc.revealInExplorer')} onClick={onReveal}>
            <IconFolderOpen />
          </button>
          <button className="v-btn" title={t('viewer.deleteTitle')} onClick={onDelete}>
            <IconTrash />
          </button>
          <button className="v-btn" title={t('viewer.closeTitle')} onClick={closeViewer}>
            <IconX />
          </button>
        </div>
      </div>

      <div
        className={'viewer-stage' + (spaceMode ? ' space' : '')}
        ref={stageRef}
        onMouseDown={(e) => {
          if (e.button !== 0) return
          if (readMode === 'manga') return
          const onContent = e.target !== e.currentTarget
          if (isImage || spaceMode) {
            e.preventDefault()
            dragRef.current = {
              x: e.clientX,
              y: e.clientY,
              px: panRef.current.x,
              py: panRef.current.y,
              onContent
            }
            draggedRef.current = false
            setDragging(true)
          } else if (!spaceMode && !onContent) {
            closeViewer()
          }
        }}
      >
        {readMode === 'manga' && entry.albumPath ? (
          <MangaStrip
            entries={viewerList}
            currentIndex={viewerIndex}
            onIndexChange={setViewerIndex}
            onContext={onContext}
            scrollRef={mangaScrollRef}
            zoom={mangaZoom}
            onToggleFilm={() => setShowFilm((v) => !v)}
          />
        ) : (
          stageContent
        )}

        {canPrev && readMode !== 'manga' && (
          <button className="v-nav prev" title={t('viewer.prevItem')} onClick={() => go(-1)}>
            <IconChevronLeft size={26} />
          </button>
        )}
        {canNext && readMode !== 'manga' && (
          <button className="v-nav next" title={t('viewer.nextItem')} onClick={() => go(1)}>
            <IconChevronRight size={26} />
          </button>
        )}

        {isImage && readMode !== 'manga' && (
          <div className="viewer-zoom">
            {zoom === 1 ? t('viewer.fitWindowLabel') : `${Math.round(zoom * 100)}%`}
          </div>
        )}
      </div>

      {showInfo && (
        <aside className="viewer-side">
          <div className="info-row">
            <span className="k">{t('viewer.infoName')}</span>
            <span className="v">{entry.name}</span>
          </div>
          <div className="info-row">
            <span className="k">{t('viewer.infoPath')}</span>
            <span className="v">{entry.path}</span>
          </div>
          <div className="info-row">
            <span className="k">{t('viewer.infoType')}</span>
            <span className="v">
              {kindLabel(entry.kind)} · {entry.ext.replace('.', '').toUpperCase()}
            </span>
          </div>
          <div className="info-row">
            <span className="k">{t('viewer.infoSize')}</span>
            <span className="v">{formatSize(entry.size)}</span>
          </div>
          <div className="info-row">
            <span className="k">{t('viewer.infoMtime')}</span>
            <span className="v">{formatDate(entry.mtime)}</span>
          </div>
          <div className="info-row">
            <span className="k">{t('viewer.infoDims')}</span>
            <span className="v">{dims ? `${dims.w} × ${dims.h}` : t('toolbar.reading')}</span>
          </div>
          {isVideo && (
            <div className="info-row">
              <span className="k">{t('viewer.infoDuration')}</span>
              <span className="v">{duration != null ? formatDuration(duration) : t('toolbar.reading')}</span>
            </div>
          )}

          {exif && (
            <>
              <div className="ctx-label" style={{ marginTop: 14 }}>{t('viewer.exif')}</div>
              {Object.entries(exif).map(([k, v]) => (
                <div className="info-row" key={k}>
                  <span className="k">{k}</span>
                  <span className="v">{v}</span>
                </div>
              ))}
            </>
          )}

          <div style={{ marginTop: 16, marginBottom: 6, color: '#8d939c', fontSize: 12 }}>{t('viewer.infoRating')}</div>
          <div className="row" style={{ gap: 2 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                className="v-btn"
                style={{ width: 28, height: 28, color: n <= rating ? 'var(--warn)' : '#5f656e' }}
                title={rating === n ? t('viewer.ratingClear') : t('ctx.nStar', { n })}
                onClick={() => setRating(n)}
              >
                <IconStar size={17} />
              </button>
            ))}
          </div>

          <div style={{ marginTop: 16, marginBottom: 6, color: '#8d939c', fontSize: 12 }}>{t('viewer.infoTags')}</div>
          <div className="tag-wrap">
            {tagIds.map((id) => {
              const tag = lookupTag(id)
              if (!tag) return null
              return (
                <span key={id} className="tag-chip" style={chipStyle(tag.color)}>
                  {tag.name}
                  <span className="x" title={t('viewer.removeTag')} onClick={() => removeTag(id)}>
                    <IconX size={11} />
                  </span>
                </span>
              )
            })}
            {!tagIds.length && <span className="text-dim" style={{ fontSize: 12 }}>{t('viewer.noTags')}</span>}
          </div>

          <input
            value={tagInput}
            disabled={tagBusy}
            placeholder={t('viewer.tagPlaceholder')}
            style={{ width: '100%', marginTop: 10 }}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addTagByName(tagInput)
              if (e.key === 'Escape') {
                e.stopPropagation()
                setTagInput('')
                e.currentTarget.blur()
              }
            }}
          />

          {!!suggestions.length && (
            <div className="tag-wrap" style={{ marginTop: 8 }}>
              {suggestions.map((tag) => (
                <span
                  key={tag.id}
                  className="tag-chip dim"
                  style={chipStyle(tag.color)}
                  title={t('viewer.clickToAdd')}
                  onClick={() => addTagByName(tag.name)}
                >
                  {tag.name}
                </span>
              ))}
            </div>
          )}
        </aside>
      )}

      {(readMode !== 'manga' || showFilm) && (
        <div className="viewer-filmstrip" ref={filmRef}>
          {film.map((e, i) => {
            const idx = from + i
            const active = idx === viewerIndex
            return (
              <button
                key={e.path}
                ref={active ? activeFilmRef : undefined}
                className={'film-item' + (active ? ' active' : '')}
                title={e.name}
                onClick={() => setViewerIndex(idx)}
              >
                <FilmThumb entry={e} />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default Viewer
