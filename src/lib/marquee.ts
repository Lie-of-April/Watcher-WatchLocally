import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'

/** 屏幕坐标下的选框，直接喂给 fixed 定位的指示层 */
export interface MarqueeBox {
  left: number
  top: number
  width: number
  height: number
}

interface Rect {
  l: number
  t: number
  r: number
  b: number
}

/** 拖出多远才算「在框选」而不是「点了一下」 */
const THRESHOLD = 5
/** 靠近容器上下边缘多少像素开始自动滚动 */
const EDGE = 44
const EDGE_MAX_SPEED = 26

/**
 * 桌面式矩形框选（在空白处按住左键拖拽）。
 *
 * 两个容易踩的坑，这里都处理了：
 * 1. 卡片是虚拟化渲染的，滚出视口就从 DOM 消失。所以拖拽期间把每个卡片的
 *    「内容坐标」几何快照下来，滚过去的卡片依然能参与命中判定，反向收框也能正确取消。
 * 2. 起点必须落在空白处（非卡片、非交互控件）。点在图片/文件夹卡片上时交给卡片自己的
 *    点击逻辑，不拦截；只有位移超过阈值才接管为框选，并吞掉这一次 click，
 *    否则松手瞬间会被卡片的点击逻辑冲掉框选结果。
 *
 * 选择语义（回调里实现）：以「一次手势」为单位。
 * - 手势开始时快照当前选择为 base；
 * - 拖拽过程中（每帧）计算 resolved = base XOR 命中项，整体写回选择；
 * - 鼠标松开时定稿（isFinal=true）。
 * 因此：连续选择 = 第二次框选不清空第一次（base 已是首次结果，取并集）；
 *       反选 = 框选框覆盖到已选中的项时该项被取消（XOR 命中即移除）。
 * 关键：每帧都是「基于 base 整体重算」，而不是在上一帧结果上再异或，避免来回抖动。
 */
export interface MarqueeCallbacks {
  /** 手势开始时返回当前选择快照（用于做 XOR 基准） */
  getBase: () => string[]
  /** 每帧 / 定稿时返回计算结果；isFinal=true 表示鼠标已松开 */
  onResult: (resolved: string[], isFinal: boolean) => void
}

/** 异或：base 里有的、hits 里也有的 → 移除；hits 里有、base 里没有的 → 加入 */
function xor(base: string[], hits: string[]): string[] {
  const set = new Set(base)
  const out = new Set(base)
  for (const h of hits) {
    if (set.has(h)) out.delete(h)
    else out.add(h)
  }
  return Array.from(out)
}

export function useMarquee(
  scrollRef: RefObject<HTMLElement>,
  callbacks: MarqueeCallbacks,
  enabled = true
) {
  const [box, setBox] = useState<MarqueeBox | null>(null)
  const cbRef = useRef(callbacks)
  cbRef.current = callbacks

  const st = useRef<{
    sx: number
    sy: number
    cx: number
    cy: number
    clientX: number
    clientY: number
    active: boolean
    speed: number
    raf: number
    base: string[]
    hits: string[]
    geom: Map<string, Rect>
    cleanup: (() => void) | null
  } | null>(null)

  const stop = useCallback(() => {
    const s = st.current
    if (!s) return
    if (s.raf) cancelAnimationFrame(s.raf)
    s.cleanup?.()
    st.current = null
    setBox(null)
  }, [])

  useEffect(() => stop, [stop])

  const onMouseDown = useCallback(
    (ev: ReactMouseEvent) => {
      if (!enabled || ev.button !== 0 || ev.ctrlKey || ev.metaKey) return
      const el = scrollRef.current
      if (!el) return
      // 交互控件（收藏、打标签、勾选框）保持原有点击行为
      const t = ev.target as HTMLElement | null
      if (t?.closest('button, input, textarea, .select-check, .m-act')) return
      // 起点落在卡片（图片/文件夹）上时不框选，交给卡片自己的点击处理
      if (t?.closest('[data-path]')) return

      const r = el.getBoundingClientRect()
      const sx = ev.clientX - r.left + el.scrollLeft
      const sy = ev.clientY - r.top + el.scrollTop

      const s = {
        sx,
        sy,
        cx: sx,
        cy: sy,
        clientX: ev.clientX,
        clientY: ev.clientY,
        active: false,
        speed: 0,
        raf: 0,
        // 关键：在手势开始时立刻快照「当前选择」作为 XOR 基准，
        // 而不是在首帧才惰性获取——否则首帧刚被框选选中的最近卡片会同时出现在
        // base 与 hits 里，被 XOR 对称差移除，表现为「先选中又被反选」的抖动。
        base: cbRef.current.getBase(),
        hits: [] as string[],
        geom: new Map<string, Rect>(),
        lastScroll: el.scrollTop,
        cleanup: null as (() => void) | null
      }
      st.current = s

      /** 采集当前 DOM 里所有卡片的内容坐标，累积到快照表 */
      const snapshot = () => {
        const rc = el.getBoundingClientRect()
        const nodes = el.querySelectorAll<HTMLElement>('[data-path]')
        nodes.forEach((n) => {
          const p = n.dataset.path
          if (!p) return
          const b = n.getBoundingClientRect()
          s.geom.set(p, {
            l: b.left - rc.left + el.scrollLeft,
            t: b.top - rc.top + el.scrollTop,
            r: b.right - rc.left + el.scrollLeft,
            b: b.bottom - rc.top + el.scrollTop
          })
        })
      }
      // 手势开始先采一次（此刻鼠标仍在空白处，卡片尚未变化）
      snapshot()

      const commit = (final: boolean) => {
        const resolved = xor(s.base, s.hits)
        cbRef.current.onResult(resolved, final)
      }

      const apply = () => {
        const rc = el.getBoundingClientRect()
        const l = Math.min(s.sx, s.cx)
        const rr = Math.max(s.sx, s.cx)
        const tp = Math.min(s.sy, s.cy)
        const bt = Math.max(s.sy, s.cy)

        // 仅在容器发生滚动（自动贴边滚 / 脚本滚动）时重采几何，避免每帧
        // 全量 getBoundingClientRect 触发布局重排导致掉帧。普通拖拽（不滚动）复用快照。
        if (el.scrollTop !== s.lastScroll) {
          snapshot()
          s.lastScroll = el.scrollTop
        }
        const hits: string[] = []
        s.geom.forEach((g, p) => {
          if (g.r >= l && g.l <= rr && g.b >= tp && g.t <= bt) hits.push(p)
        })
        s.hits = hits
        commit(false)

        // 选框画在视口坐标系里，并裁进内容区，免得盖到工具栏上
        const vl = Math.max(rc.left, rc.left + l - el.scrollLeft)
        const vt = Math.max(rc.top, rc.top + tp - el.scrollTop)
        const vr = Math.min(rc.right, rc.left + rr - el.scrollLeft)
        const vb = Math.min(rc.bottom, rc.top + bt - el.scrollTop)
        setBox({
          left: vl,
          top: vt,
          width: Math.max(0, vr - vl),
          height: Math.max(0, vb - vt)
        })
      }

      const tick = () => {
        const cur = st.current
        if (!cur) return
        if (cur.speed) {
          const before = el.scrollTop
          el.scrollTop = Math.max(
            0,
            Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + cur.speed)
          )
          if (el.scrollTop !== before) {
            const rc = el.getBoundingClientRect()
            cur.cy = cur.clientY - rc.top + el.scrollTop
            apply()
          }
        }
        cur.raf = requestAnimationFrame(tick)
      }

      const onMove = (e: MouseEvent) => {
        const cur = st.current
        if (!cur) return
        const rc = el.getBoundingClientRect()
        cur.clientX = e.clientX
        cur.clientY = e.clientY
        cur.cx = e.clientX - rc.left + el.scrollLeft
        cur.cy = e.clientY - rc.top + el.scrollTop

        if (!cur.active) {
          if (Math.abs(cur.cx - cur.sx) < THRESHOLD && Math.abs(cur.cy - cur.sy) < THRESHOLD) return
          cur.active = true
          document.body.classList.add('marquee-on')
          cur.raf = requestAnimationFrame(tick)
        }

        // 贴边自动滚动，速度随贴近程度递增
        const dTop = e.clientY - rc.top
        const dBot = rc.bottom - e.clientY
        if (dTop < EDGE) cur.speed = -Math.ceil(((EDGE - Math.max(0, dTop)) / EDGE) * EDGE_MAX_SPEED)
        else if (dBot < EDGE) cur.speed = Math.ceil(((EDGE - Math.max(0, dBot)) / EDGE) * EDGE_MAX_SPEED)
        else cur.speed = 0

        apply()
      }

      const onUp = () => {
        const cur = st.current
        const wasActive = !!cur?.active
        stop()
        document.body.classList.remove('marquee-on')
        if (wasActive) {
          // 定稿：用最终命中框再算一次（兜底），然后吞掉这次 click，
          // 否则卡片的 shift+click 区间选择会把框选结果冲掉
          if (cur) commit(true)
          const swallow = (e: MouseEvent) => {
            e.stopPropagation()
            e.preventDefault()
          }
          window.addEventListener('click', swallow, { capture: true, once: true })
          setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
        }
      }

      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          stop()
          document.body.classList.remove('marquee-on')
        }
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      window.addEventListener('keydown', onKey)
      s.cleanup = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        window.removeEventListener('keydown', onKey)
      }

      // 阻止原生文本选择和 HTML5 拖拽
      ev.preventDefault()
    },
    [enabled, scrollRef, stop]
  )

  return { box, onMouseDown }
}
