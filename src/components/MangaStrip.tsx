import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { Entry } from '@/types'

interface MangaStripProps {
  entries: Entry[]
  currentIndex: number
  onIndexChange: (i: number) => void
  onContext?: (e: Entry, ev: React.MouseEvent) => void
  scrollRef: React.MutableRefObject<HTMLDivElement | null>
  /** 页宽百分比：30~120，默认 100（填满宽度）。缩小可一屏看更多页 */
  zoom?: number
  /** 在漫画页上「干净左键点击」（非拖拽滚动）时触发，供外层隐藏/唤出底部图片列表 */
  onToggleFilm?: () => void
}

/** 默认估算高宽比（竖版漫画常见比例） */
const DEFAULT_AR = 1.4
/** 虚拟化：视口外额外预渲染的像素高度 */
const BUFFER = 1500
/** 滚轮加速倍率：>1 加速，=1 原生速度 */
const WHEEL_SPEED = 2

/**
 * 漫画式纵向浏览：把套图里的图片无缝纵向陈列（width:100% 保比例，不做任何拉伸），
 * 用滚轮原生滚动，也可按住拖拽抓取滚动。滚动到哪一页就把那一页设为"当前项"，
 * 这样侧栏的标签 / 评分 / 信息始终跟着你正在看的那张图。
 *
 * 性能优化：
 *  - DOM 虚拟化 — 只渲染视口 ± buffer 内的页面，远处用等高占位 div 代替
 *  * 二分查找 — onScroll 用 O(log n) 定位当前页，替代 O(n) 线性扫描
 *  * 图片按需加载 — 仅可见区域附近的页面持有 <img>，减少并发请求与显存占用
 */
export function MangaStrip({ entries, currentIndex, onIndexChange, onContext, scrollRef, zoom = 100, onToggleFilm }: MangaStripProps) {
  const localRef = useRef<HTMLDivElement>(null)
  const imgRefs = useRef<(HTMLElement | null)[]>([])
  const rafRef = useRef(0)
  const scrollFromUserRef = useRef(false)
  const currentIndexRef = useRef(currentIndex)
  const [grabbing, setGrabbing] = useState(false)
  const dragRef = useRef<{ y: number; top: number; moved: boolean } | null>(null)
  const anchorRef = useRef<{ offset: number } | null>(null)

  currentIndexRef.current = currentIndex

  /* ========================= 虚拟化状态 ========================= */
  const heightsRef = useRef<Map<number, number>>(new Map())
  const [, setMeasuredNonce] = useState(0)
  const containerWRef = useRef(800)
  const viewportHRef = useRef(600)
  const scrollTopRef = useRef(0)
  const [, setViewportNonce] = useState(0)
  /** 记录上一次渲染的偏移表条目数，用于在测量导致布局变化时修正滚动位置 */
  const prevOffsetCountRef = useRef(0)

  /* ---------- ResizeObserver：测量已渲染页面的真实高度 ---------- */
  const roRef = useRef<ResizeObserver | null>(null)
  if (!roRef.current) {
    roRef.current = new ResizeObserver((entries) => {
      let changed = false
      for (const e of entries) {
        const idx = Number((e.target as HTMLElement).dataset.mangaIdx)
        if (isNaN(idx)) continue
        const h = e.contentRect.height
        if (h > 0 && heightsRef.current.get(idx) !== h) {
          heightsRef.current.set(idx, h)
          changed = true
        }
      }
      if (changed) setMeasuredNonce((n) => n + 1)
    })
  }

  /* ---------- 计算每页偏移表（已测量用真实高度，未测量用估算值） ---------- */
  const offsets = useMemo(() => {
    const w = containerWRef.current
    const estH = Math.round(w * DEFAULT_AR)
    const arr = new Array(entries.length + 1)
    arr[0] = 0
    for (let i = 0; i < entries.length; i++) {
      arr[i + 1] = arr[i] + (heightsRef.current.get(i) ?? estH)
    }
    return arr
  }, [entries.length, heightsRef.current, containerWRef.current])

  /* ---------- 二分查找：定位 scroll position 对应的页 ---------- */
  const findPageAt = (pos: number): number => {
    let lo = 0, hi = entries.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (offsets[mid + 1] <= pos) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  /* ---------- 计算可见范围 + 渲染范围 ---------- */
  const { visStart, visEnd, renderStart, renderEnd } = useMemo(() => {
    const st = scrollTopRef.current
    const vh = viewportHRef.current
    const buf = BUFFER

    let lo = 0, hi = entries.length - 1
    while (lo < hi) { const mid = (lo + hi) >> 1; if (offsets[mid + 1] <= st) lo = mid + 1; else hi = mid }
    const vs = lo

    lo = vs; hi = entries.length - 1
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (offsets[mid] >= st + vh) hi = mid - 1; else lo = mid }
    const ve = lo

    lo = 0; hi = ve
    while (lo < hi) { const mid = (lo + hi) >> 1; if (offsets[mid + 1] <= st - buf) lo = mid + 1; else hi = mid }
    const rs = lo

    lo = vs; hi = entries.length - 1
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (offsets[mid] >= st + vh + buf) hi = mid - 1; else lo = mid }
    let re = lo

    if (entries.length > 0 && offsets[re + 1] + buf < offsets[entries.length]) {
      re = entries.length - 1
    }

    return { visStart: vs, visEnd: ve, renderStart: rs, renderEnd: re }
  }, [entries.length, offsets, scrollTopRef.current, viewportHRef.current])

  /* ---------- 测量已渲染页面（每次渲染后兜底校准） ---------- */
  useLayoutEffect(() => {
    let changed = false
    for (let i = renderStart; i <= renderEnd; i++) {
      const el = imgRefs.current[i]
      if (!el) continue
      const h = el.getBoundingClientRect().height
      if (h > 0 && heightsRef.current.get(i) !== h) {
        heightsRef.current.set(i, h)
        changed = true
      }
    }
    if (changed) setMeasuredNonce((n) => n + 1)
  })

  /* ---------- 滚动位置稳定：测量更新高度后修正 scrollTop ---------- */
  useLayoutEffect(() => {
    const prevCount = prevOffsetCountRef.current
    prevOffsetCountRef.current = offsets.length

    if (prevCount !== offsets.length && prevCount > 0) {
      const cont = localRef.current
      if (!cont) return
      const ci = currentIndexRef.current
      if (ci < 0 || ci >= entries.length) return

      const w = containerWRef.current
      const estH = Math.round(w * DEFAULT_AR)
      let oldAt = 0
      for (let i = 0; i < ci; i++) oldAt += heightsRef.current.get(i) ?? estH
      const newAt = offsets[ci]
      const diff = newAt - oldAt
      if (Math.abs(diff) > 1) cont.scrollTop += diff
    }
  }, [offsets, entries.length])

  /* ---------- 容器尺寸 / 滚动位置追踪 ---------- */
  useLayoutEffect(() => {
    const cont = localRef.current
    if (!cont) return
    const sync = () => {
      const w = cont.clientWidth
      const h = cont.clientHeight
      if (w !== containerWRef.current || h !== viewportHRef.current) {
        containerWRef.current = w
        viewportHRef.current = h
        setViewportNonce((n) => n + 1)
      }
      scrollTopRef.current = cont.scrollTop
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(cont)
    return () => ro.disconnect()
  }, [])

  /* ---------- 缩放锚点 ---------- */
  useLayoutEffect(() => {
    const c = localRef.current
    const el = imgRefs.current[currentIndexRef.current]
    if (!c || !el) return
    const cRect = c.getBoundingClientRect()
    const eRect = el.getBoundingClientRect()
    const prevOffset = anchorRef.current ? anchorRef.current.offset : eRect.top - cRect.top
    const newAbsTop = eRect.top - cRect.top + c.scrollTop
    c.scrollTop = newAbsTop - prevOffset
    const cRect2 = c.getBoundingClientRect()
    const eRect2 = el.getBoundingClientRect()
    anchorRef.current = { offset: eRect2.top - cRect2.top }
  }, [zoom])

  useEffect(() => {
    scrollRef.current = localRef.current
    return () => { scrollRef.current = null }
  }, [scrollRef])

  /* ---------- 外部改变 currentIndex 时滚动到对应图片 ---------- */
  useEffect(() => {
    if (scrollFromUserRef.current) {
      scrollFromUserRef.current = false
      return
    }
    const cont = localRef.current
    const idx = currentIndex
    if (!cont || idx < 0 || idx >= entries.length) return
    // 使用 smooth 滚动（仅键盘 / 胶片条跳转时触发）
    cont.scrollTo({ top: offsets[idx], behavior: 'smooth' })
    const id = requestAnimationFrame(() => {
      const c = localRef.current
      if (c) {
        c.scrollTop = offsets[idx]
        const el = imgRefs.current[idx]
        if (el) anchorRef.current = { offset: el.getBoundingClientRect().top - c.getBoundingClientRect().top }
      }
    })
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex])

  /* ---------- 滚动处理：二分查找当前页 ---------- */
  const onScroll = () => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      const cont = localRef.current
      if (!cont) return
      scrollTopRef.current = cont.scrollTop
      const y = cont.scrollTop + cont.clientHeight * 0.35
      const best = findPageAt(y)
      if (best !== currentIndexRef.current) {
        scrollFromUserRef.current = true
        onIndexChange(best)
      }
      const curEl = imgRefs.current[best]
      if (curEl) {
        const cc = cont.getBoundingClientRect()
        const ee = curEl.getBoundingClientRect()
        anchorRef.current = { offset: ee.top - cc.top }
      }
      setViewportNonce((n) => n + 1)
    })
  }

  /* ---------- 滚轮加速：拦截 wheel 事件，放大 delta 后手动滚动 ---------- */
  useEffect(() => {
    const el = localRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      el.scrollTop += e.deltaY * WHEEL_SPEED
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  /* ---------- 拖拽滚动 ---------- */
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    const cont = localRef.current
    if (!cont) return
    dragRef.current = { y: e.clientY, top: cont.scrollTop, moved: false }
    setGrabbing(true)
    e.preventDefault()
    e.stopPropagation()
  }

  useEffect(() => {
    if (!grabbing) return
    const move = (e: MouseEvent) => {
      const d = dragRef.current
      const cont = localRef.current
      if (!d || !cont) return
      if (Math.abs(e.clientY - d.y) > 4) d.moved = true
      cont.scrollTop = d.top - (e.clientY - d.y)
    }
    const up = () => {
      const d = dragRef.current
      if (d && !d.moved && onToggleFilm) onToggleFilm()
      setGrabbing(false)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [grabbing, onToggleFilm])

  /* ========================= 虚拟化渲染 ========================= */
  const spacerTopH = offsets[renderStart]
  const spacerBottomH = offsets[entries.length] - offsets[renderEnd + 1]
  imgRefs.current.length = entries.length

  /* ---------- 连接 ResizeObserver 到已渲染的页面元素 ---------- */
  useLayoutEffect(() => {
    const ro = roRef.current
    if (!ro) return
    for (let i = renderStart; i <= renderEnd; i++) {
      const el = imgRefs.current[i]
      if (el) ro.observe(el)
    }
    return () => {
      for (let i = renderStart; i <= renderEnd; i++) {
        const el = imgRefs.current[i]
        if (el) ro.unobserve(el)
      }
    }
  })

  return (
    <div
      className={'manga-strip' + (grabbing ? ' grabbing' : '')}
      ref={localRef}
      onScroll={onScroll}
      onMouseDown={onMouseDown}
      onContextMenu={(e) => {
        const t = e.target as HTMLElement
        const wrap = t.closest('[data-manga-idx]') as HTMLElement | null
        const idx = wrap?.dataset.mangaIdx != null ? Number(wrap.dataset.mangaIdx) : currentIndexRef.current
        const entry = entries[idx]
        if (entry && onContext) {
          e.preventDefault()
          e.stopPropagation()
          onContext(entry, e)
        }
      }}
    >
      {spacerTopH > 0 && <div className="manga-spacer" style={{ height: spacerTopH }} />}
      {Array.from({ length: renderEnd - renderStart + 1 }, (_, k) => {
        const i = renderStart + k
        const e = entries[i]
        return (
          <div
            className="manga-page"
            key={e.path}
            data-manga-idx={i}
            ref={(el) => { imgRefs.current[i] = el }}
            style={{ width: `${zoom}%` }}
          >
            {e.kind === 'video' ? (
              <video src={api.mediaUrl(e.path)} controls style={{ width: '100%', display: 'block', background: '#000' }} />
            ) : (
              <img
                src={api.mediaUrl(e.path)}
                alt={e.name}
                draggable={false}
                decoding="async"
              />
            )}
          </div>
        )
      })}
      {spacerBottomH > 0 && <div className="manga-spacer" style={{ height: spacerBottomH }} />}
    </div>
  )
}

export default MangaStrip
