import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
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

/**
 * 漫画式纵向浏览：把套图里的图片无缝纵向陈列（width:100% 保比例，不做任何拉伸），
 * 用滚轮原生滚动，也可按住拖拽抓取滚动。滚动到哪一页就把那一页设为"当前项"，
 * 这样侧栏的标签 / 评分 / 信息始终跟着你正在看的那张图。
 */
export function MangaStrip({ entries, currentIndex, onIndexChange, onContext, scrollRef, zoom = 100, onToggleFilm }: MangaStripProps) {
  const localRef = useRef<HTMLDivElement>(null)
  const imgRefs = useRef<(HTMLElement | null)[]>([])
  const rafRef = useRef(0)
  const scrollFromUserRef = useRef(false)
  const currentIndexRef = useRef(currentIndex)
  const [grabbing, setGrabbing] = useState(false)
  const dragRef = useRef<{ y: number; top: number; moved: boolean } | null>(null)
  // 记录「当前正在看的页」顶部在视口中的屏幕偏移，缩放时据此把该页锁定在同一位置。
  // 关键：锚点必须在滚动 / 切图时持续刷新，否则缩放时会锁到旧的页上导致跳图。
  const anchorRef = useRef<{ offset: number } | null>(null)

  currentIndexRef.current = currentIndex
  imgRefs.current.length = entries.length

  /* 缩放变化：锁定「当前正在看的页」，保持它缩放前后在屏幕上不动。
     做法：以该页顶部相对视口的屏幕位置 offset 为锚；缩放后该页的绝对顶部变了，
     把滚动量调整到让该页顶部仍停在原来的 offset 处，于是图片看起来原地不动。 */
  useLayoutEffect(() => {
    const c = localRef.current
    const el = imgRefs.current[currentIndexRef.current]
    if (!c || !el) return
    const cRect = c.getBoundingClientRect()
    const eRect = el.getBoundingClientRect()
    // 若该页锚点还没记录（如刚进漫画模式就缩放），用当前屏幕位置临时兜底
    const prevOffset = anchorRef.current ? anchorRef.current.offset : eRect.top - cRect.top
    // 该页在「新布局」下的绝对顶部 = 当前屏幕位置 + 当前滚动量
    const newAbsTop = eRect.top - cRect.top + c.scrollTop
    // 调整滚动，使该页顶部回到 prevOffset 这个屏幕位置
    c.scrollTop = newAbsTop - prevOffset
    // 用更新后的滚动量重新记录锚点，保证下一次缩放连续
    const cRect2 = c.getBoundingClientRect()
    const eRect2 = el.getBoundingClientRect()
    anchorRef.current = { offset: eRect2.top - cRect2.top }
  }, [zoom])

  useEffect(() => {
    scrollRef.current = localRef.current
    return () => {
      scrollRef.current = null
    }
  }, [scrollRef])

  /* 外部（方向键 / 胶片条点击 / 进入漫画模式）改变当前项时，滚动到对应图片 */
  useEffect(() => {
    if (scrollFromUserRef.current) {
      scrollFromUserRef.current = false
      return
    }
    const cont = localRef.current
    const el = imgRefs.current[currentIndex]
    if (cont && el) {
      const top = el.getBoundingClientRect().top - cont.getBoundingClientRect().top + cont.scrollTop
      cont.scrollTop = top
    }
    // 进入漫画模式后首帧布局可能还没稳定，再校一次
    const id = requestAnimationFrame(() => {
      const c = localRef.current
      const e = imgRefs.current[currentIndex]
      if (c && e) {
        const t = e.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop
        c.scrollTop = t
        anchorRef.current = { offset: e.getBoundingClientRect().top - c.getBoundingClientRect().top }
      }
    })
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex])

  /* 滚动时找出离视口上方 35% 处最近的图片，作为"当前项" */
  const onScroll = () => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      const cont = localRef.current
      if (!cont) return
      const y = cont.scrollTop + cont.clientHeight * 0.35
      let best = 0
      let bestD = Infinity
      for (let i = 0; i < imgRefs.current.length; i++) {
        const el = imgRefs.current[i]
        if (!el) continue
        const c = el.offsetTop + el.offsetHeight / 2
        const d = Math.abs(c - y)
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
      if (best !== currentIndexRef.current) {
        scrollFromUserRef.current = true
        onIndexChange(best)
      }
      // 持续刷新锚点：把「当前页」顶部在视口中的屏幕偏移记下来，
      // 这样无论用户滚到哪张图，接下来缩放都能锁定到这张，而不是旧的
      const curEl = imgRefs.current[best]
      if (curEl) {
        const cc = cont.getBoundingClientRect()
        const ee = curEl.getBoundingClientRect()
        anchorRef.current = { offset: ee.top - cc.top }
      }
    })
  }

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
      // 干净点击（几乎没移动）视为切换底部图片列表的显隐，而不是滚动
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
      {entries.map((e, i) => (
        <div
          className="manga-page"
          key={e.path}
          data-manga-idx={i}
          ref={(el) => {
            imgRefs.current[i] = el
          }}
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
              loading={i < 40 ? 'eager' : 'lazy'}
            />
          )}
        </div>
      ))}
    </div>
  )
}

export default MangaStrip
