import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { useApp } from '@/store/AppContext'
import type { Tag } from '@/types'
import { IconCheck, IconSearch, IconPlus } from '@/components/Icons'
import { t } from '@/i18n/strings'

// 把 hex 转成带透明度的 rgba，用于标签底色（浅色主题下清晰可读）
function hexToRgba(hex: string, a: number): string {
  let h = (hex || '#888').replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r},${g},${b},${a})`
}

type CheckState = 'none' | 'half' | 'all'

function StateBox({ state }: { state: CheckState }) {
  if (state === 'all')
    return (
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: 4,
          background: 'var(--accent)',
          display: 'grid',
          placeItems: 'center',
          color: '#fff',
          flexShrink: 0
        }}
      >
        <IconCheck size={12} />
      </span>
    )
  if (state === 'half')
    return (
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: 4,
          background: 'var(--accent)',
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0
        }}
      >
        <span style={{ width: 8, height: 2, background: '#fff', borderRadius: 1 }} />
      </span>
    )
  return (
    <span
      style={{ width: 16, height: 16, borderRadius: 4, border: '1.5px solid var(--border-strong)', flexShrink: 0 }}
    />
  )
}

interface TagPickerProps {
  targets: { path: string; isDir: boolean }[]
  x: number
  y: number
  onClose: () => void
  onChanged?: () => void
}

export function TagPicker(props: TagPickerProps) {
  const { targets, x, y, onClose, onChanged } = props
  const { tags, tagGroups, itemMeta, folderMeta, applyMetaPatch, reloadTags, toast } = useApp()
  const [q, setQ] = useState('')
  const [pos, setPos] = useState({ left: x, top: y })
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const tagsOf = (path: string, isDir: boolean) =>
    (isDir ? folderMeta[path] : itemMeta[path])?.tags || []

  // 边界修正：浮层若超出右边/下边就向左/向上翻转，保证不被裁掉
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const m = 8
    let left = x
    if (left + w > window.innerWidth - m) left = x - w // 翻转到锚点左侧
    if (left < m) left = m
    let top = y
    if (top + h > window.innerHeight - m) top = y - h
    if (top < m) top = m
    setPos({ left, top })
  }, [x, y, q, tags])

  // 点击浮层外部或按 Esc 关闭（mousedown 排除浮层自身，避免内部点击误关）
  useEffect(() => {
    inputRef.current?.focus()
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return tags
      .filter((t) => !s || t.name.toLowerCase().includes(s))
      // 按创建时间倒序：最近添加的标签排在前面
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  }, [tags, q])

  // 按分组归类，无分组的放最后「未分组」区
  const groups = useMemo(() => {
    const byGroup: Record<string, Tag[]> = {}
    const none: Tag[] = []
    for (const t of filtered) {
      if (t.groupId) (byGroup[t.groupId] ||= []).push(t)
      else none.push(t)
    }
    const sorted = [...tagGroups].sort((a, b) => a.order - b.order)
    const out = sorted
      .filter((g) => byGroup[g.id]?.length)
      .map((g) => ({ group: g, items: byGroup[g.id] }))
    if (none.length) out.push({ group: null, items: none })
    return out
  }, [filtered, tagGroups])

  const stateOf = (tag: Tag): CheckState => {
    const hasAll = targets.every((t) => tagsOf(t.path, t.isDir).includes(tag.id))
    if (hasAll) return 'all'
    const hasSome = targets.some((t) => tagsOf(t.path, t.isDir).includes(tag.id))
    return hasSome ? 'half' : 'none'
  }

  // 提交后按本地当前 tags 推算每个目标的新数组，即时同步 UI，避免全量刷新
  const applyTag = async (tag: Tag, mode: 'add' | 'remove') => {
    if (busy) return
    setBusy(true)
    try {
      await api.db.bulkTag(targets, [tag.id], mode)
      for (const t of targets) {
        const cur = tagsOf(t.path, t.isDir)
        const next =
          mode === 'add'
            ? cur.includes(tag.id)
              ? cur
              : [...cur, tag.id]
            : cur.filter((id) => id !== tag.id)
        applyMetaPatch(t.path, t.isDir, { tags: next })
      }
      onChanged?.()
    } catch (e: any) {
      toast(e.message || t('tags.opFailed'), 'err')
    } finally {
      setBusy(false)
    }
  }

  const onRowClick = (tag: Tag) => {
    const st = stateOf(tag)
    // 全选或半选都表示"已有"，点击 => 从全部 targets 移除；未选 => 添加到全部
    applyTag(tag, st === 'none' ? 'add' : 'remove')
  }

  const showCreate =
    q.trim() && !tags.some((t) => t.name.toLowerCase() === q.trim().toLowerCase())

  const createAndAdd = async () => {
    const name = q.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      const tag = await api.db.createTag({ name })
      await api.db.bulkTag(targets, [tag.id], 'add')
      for (const t of targets) {
        const cur = tagsOf(t.path, t.isDir)
        applyMetaPatch(t.path, t.isDir, { tags: cur.includes(tag.id) ? cur : [...cur, tag.id] })
      }
      await reloadTags()
      setQ('')
      onChanged?.()
    } catch (e: any) {
      toast(e.message || t('tags.createFailed2'), 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: pos.left, top: pos.top, minWidth: 220, maxWidth: 300 }}
    >
      <div className="ctx-label">{t('tags.pickerTitle', { n: targets.length })}</div>
      <div style={{ padding: '4px 6px 8px', position: 'relative' }}>
        <span
          style={{
            position: 'absolute',
            left: 14,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-3)',
            display: 'grid',
            placeItems: 'center',
            pointerEvents: 'none'
          }}
        >
          <IconSearch size={14} />
        </span>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('tags.pickerPlaceholder')}
          style={{ width: '100%', height: 30, paddingLeft: 30, borderRadius: 7, border: '1px solid var(--border-strong)', background: 'var(--panel-2)' }}
        />
      </div>

      {showCreate && (
        <div className="ctx-item" onClick={createAndAdd} style={{ color: 'var(--accent)' }}>
          <IconPlus size={14} />
          <span>{t('tags.pickerCreate', { q: q.trim() })}</span>
        </div>
      )}

      <div style={{ maxHeight: '52vh', overflowY: 'auto' }}>
        {groups.length === 0 && !showCreate && (
          <div className="ctx-label" style={{ textTransform: 'none', fontWeight: 500 }}>
            {t('tags.pickerNoMatch')}
          </div>
        )}
        {groups.map(({ group, items }) => (
          <div key={group?.id || '__none'}>
            <div className="ctx-label">{group ? group.name : t('tags.ungrouped')}</div>
            {items.map((tag) => {
              const st = stateOf(tag)
              return (
                <div key={tag.id} className="ctx-item" onClick={() => onRowClick(tag)}>
                  <StateBox state={st} />
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '2px 8px',
                      borderRadius: 10,
                      background: hexToRgba(tag.color, 0.16),
                      maxWidth: '100%'
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: tag.color, flexShrink: 0 }} />
                    <span
                      style={{
                        color: 'var(--text)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {tag.name}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
