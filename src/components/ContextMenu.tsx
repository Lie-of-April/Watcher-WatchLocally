import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuItem {
  key?: string
  label?: string
  icon?: React.ReactNode
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  separator?: boolean
  header?: string
  onClick?: () => void
  /** 二级菜单：存在时该项右侧展开子菜单（hover 触发） */
  submenu?: MenuItem[]
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
  /** 整链关闭（点击任意子项后调用），默认等于 onClose */
  rootOnClose?: () => void
  /** 子菜单是否向左展开（父菜单贴近右边缘时） */
  flip?: boolean
}

/** 通用右键菜单：自动做边界翻转，保证靠近屏幕边缘时也完整可见；支持二级菜单 */
export function ContextMenu({ x, y, items, onClose, rootOnClose, flip }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y, visible: false })
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  const itemEls = useRef<Record<string, HTMLDivElement | null>>({})
  const closeRoot = rootOnClose || onClose

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const pad = 8
    let left = x
    let top = y
    if (left + width + pad > window.innerWidth) left = Math.max(pad, x - width)
    if (top + height + pad > window.innerHeight) top = Math.max(pad, window.innerHeight - height - pad)
    setPos({ left, top, visible: true })
  }, [x, y, items])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onScroll = () => onClose()
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onScroll)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: pos.left, top: pos.top, opacity: pos.visible ? 1 : 0 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => {
        if (it.separator) return <div key={i} className="ctx-sep" />
        if (it.header)
          return (
            <div key={i} className="ctx-label">
              {it.header}
            </div>
          )

        if (it.submenu) {
          const open = hoverKey === (it.key || String(i))
          const key = it.key || String(i)
          return (
            <div
              key={key}
              ref={(el) => (itemEls.current[key] = el)}
              className={'ctx-item ctx-has-sub' + (open ? ' open' : '')}
              onMouseEnter={() => setHoverKey(key)}
              onMouseLeave={() => setHoverKey((k) => (k === key ? null : k))}
            >
              {it.icon && <span style={{ display: 'grid', placeItems: 'center' }}>{it.icon}</span>}
              <span>{it.label}</span>
              <span className="ctx-arrow">▸</span>
              {open &&
                (() => {
                  const el = itemEls.current[key]
                  if (!el) return null
                  const r = el.getBoundingClientRect()
                  const doFlip = r.right + 210 > window.innerWidth
                  return (
                    <ContextMenu
                      x={doFlip ? r.left : r.right}
                      y={r.top}
                      items={it.submenu}
                      onClose={() => setHoverKey(null)}
                      rootOnClose={closeRoot}
                      flip={doFlip}
                    />
                  )
                })()}
            </div>
          )
        }

        return (
          <div
            key={it.key || i}
            className={'ctx-item' + (it.danger ? ' danger' : '')}
            style={it.disabled ? { opacity: 0.4, pointerEvents: 'none' } : undefined}
            onClick={() => {
              closeRoot()
              setTimeout(() => it.onClick?.(), 0)
            }}
          >
            {it.icon && <span style={{ display: 'grid', placeItems: 'center' }}>{it.icon}</span>}
            <span>{it.label}</span>
            {it.shortcut && <span className="sc">{it.shortcut}</span>}
          </div>
        )
      })}
    </div>
  )
}

export default ContextMenu
