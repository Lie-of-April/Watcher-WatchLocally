import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { Entry } from '@/types'

export interface CellLayout {
  entry: Entry
  x: number
  y: number
  w: number
  h: number
  index: number
}

interface Props {
  entries: Entry[]
  columnWidth: number
  gap: number
  /** 滚动容器，虚拟化需要读它的 scrollTop */
  scrollRef: React.RefObject<HTMLElement>
  renderCell: (cell: CellLayout, onDims: (p: string, w: number, h: number) => void) => React.ReactNode
}

// 极端比例的图（长条漫、超宽全景）会撑爆版面，这里把行高约束在合理区间
const MIN_ASPECT = 0.42
const MAX_ASPECT = 3.0
const DEFAULT_ASPECT = 0.75

/**
 * 瀑布流：贪心把每张图放进当前最矮的一列，再按视口做虚拟化。
 * 宽高比优先用磁盘缓存里的真实尺寸，避免图片陆续解码时版面反复跳动。
 */
export function MasonryGrid({ entries, columnWidth, gap, scrollRef, renderCell }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [aspects, setAspects] = useState<Record<string, number>>({})
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(800)

  /* 容器宽度 */
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((es) => {
      const w = es[0].contentRect.width
      setWidth((prev) => (Math.abs(prev - w) > 0.5 ? w : prev))
    })
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  /* 滚动位置（rAF 节流，避免每个滚动事件都触发 React 更新） */
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        ticking = false
        setScrollTop(el.scrollTop)
        setViewH(el.clientHeight)
      })
    }
    setViewH(el.clientHeight)
    setScrollTop(el.scrollTop)
    el.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(() => setViewH(el.clientHeight))
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [scrollRef])

  /* 批量预取已缓存的尺寸：一次 IPC 换整页稳定布局 */
  useEffect(() => {
    if (!entries.length) return
    let cancelled = false
    const list = entries.map((e) => ({ path: e.path, mtime: e.mtime, size: e.size }))
    api.thumb
      .dimsBatch(list)
      .then((map) => {
        if (cancelled || !map) return
        const next: Record<string, number> = {}
        for (const [p, wh] of Object.entries(map)) {
          if (wh && wh[0] && wh[1]) next[p] = wh[0] / wh[1]
        }
        if (Object.keys(next).length) setAspects((prev) => ({ ...prev, ...next }))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [entries])

  /* 缩略图解码后回填真实比例，合并到一帧里统一 setState */
  const pending = useRef<Record<string, number>>({})
  const scheduled = useRef(false)
  const onDims = useCallback((path: string, w: number, h: number) => {
    if (!w || !h) return
    const a = w / h
    setAspects((prev) => {
      if (prev[path] && Math.abs(prev[path] - a) < 0.001) return prev
      pending.current[path] = a
      if (!scheduled.current) {
        scheduled.current = true
        requestAnimationFrame(() => {
          scheduled.current = false
          const patch = pending.current
          pending.current = {}
          if (Object.keys(patch).length) setAspects((p) => ({ ...p, ...patch }))
        })
      }
      return prev
    })
  }, [])

  /* 布局计算 */
  const { cells, totalHeight, colCount } = useMemo(() => {
    if (width <= 0 || !entries.length) {
      return { cells: [] as CellLayout[], totalHeight: 0, colCount: 1 }
    }
    const cols = Math.max(1, Math.floor((width + gap) / (columnWidth + gap)))
    const colW = (width - gap * (cols - 1)) / cols
    const heights = new Array(cols).fill(0)
    const out: CellLayout[] = []

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]
      let a = aspects[e.path] || DEFAULT_ASPECT
      if (!Number.isFinite(a) || a <= 0) a = DEFAULT_ASPECT
      a = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, a))
      const h = Math.round(colW / a)

      let ci = 0
      for (let c = 1; c < cols; c++) if (heights[c] < heights[ci]) ci = c

      out.push({
        entry: e,
        x: Math.round(ci * (colW + gap)),
        y: Math.round(heights[ci]),
        w: Math.round(colW),
        h,
        index: i
      })
      heights[ci] += h + gap
    }

    return { cells: out, totalHeight: Math.max(0, Math.max(...heights) - gap), colCount: cols }
  }, [entries, aspects, width, columnWidth, gap])

  /* 虚拟化：上下各留一屏缓冲，滚动时不会出现空白 */
  const visible = useMemo(() => {
    if (!cells.length) return cells
    const wrapTop = wrapRef.current?.offsetTop ?? 0
    const top = scrollTop - wrapTop - viewH
    const bottom = scrollTop - wrapTop + viewH * 2
    return cells.filter((c) => c.y + c.h >= top && c.y <= bottom)
  }, [cells, scrollTop, viewH])

  return (
    <div ref={wrapRef} className="masonry" style={{ height: totalHeight }} data-cols={colCount}>
      {visible.map((cell) => (
        <React.Fragment key={cell.entry.path}>{renderCell(cell, onDims)}</React.Fragment>
      ))}
    </div>
  )
}

export default MasonryGrid
