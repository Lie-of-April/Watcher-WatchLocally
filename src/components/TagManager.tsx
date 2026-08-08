import React, { useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { useApp } from '@/store/AppContext'
import type { Tag, TagGroup } from '@/types'
import { t } from '@/i18n/strings'
import {
  IconX, IconPlus, IconEdit, IconTrash, IconMove, IconTag, IconTags
} from '@/components/Icons'

// 把 hex 转成带透明度的 rgba，用于标签底色
function hexToRgba(hex: string, a: number): string {
  let h = (hex || '#888').replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r},${g},${b},${a})`
}

// 10 个协调的预设颜色，供改色时快速点选
const PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#22c55e', '#10b981',
  '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899'
]

// 分类（分组）专用色板，分类颜色会作为该分类下所有标签的底色
const GROUP_PALETTE = [
  '#e05263', '#e07a3f', '#d9a441', '#6fa84f', '#3f9e8c',
  '#4a8fd4', '#6b6fd4', '#9b5fc0', '#c25f9e', '#7a8794'
]

type Sel = 'all' | 'none' | string

/* ---------- 单个标签行（独立组件，避免父组件重渲染丢失编辑态） ---------- */
function TagRow({ tag }: { tag: Tag }) {
  const { reloadTags, confirm, toast, tagGroups } = useApp()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(tag.name)
  const [colorOpen, setColorOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const saveName = async () => {
    const n = name.trim()
    if (!n || n === tag.name) {
      setRenaming(false)
      setName(tag.name)
      return
    }
    setBusy(true)
    try {
      await api.db.updateTag(tag.id, { name: n })
      await reloadTags()
      setRenaming(false)
    } catch (e: any) {
      toast(e.message || t('tags.renameFailed'), 'err')
    } finally {
      setBusy(false)
    }
  }

  const setColor = async (color: string) => {
    try {
      await api.db.updateTag(tag.id, { color })
      await reloadTags()
    } catch (e: any) {
      toast(e.message || t('tags.colorFailed'), 'err')
    } finally {
      setColorOpen(false)
    }
  }

  const moveTo = async (groupId: string | null) => {
    try {
      await api.db.updateTag(tag.id, { groupId })
      await reloadTags()
    } catch (e: any) {
      toast(e.message || t('tags.moveFailed'), 'err')
    } finally {
      setMoveOpen(false)
    }
  }

  const del = async () => {
    const ok = await confirm({
      title: t('tags.deleteTitle'),
      message: (
        <>
          {t('tags.deleteMsg1')}<b>{tag.name}</b>{t('tags.deleteMsg2')}<b>{tag.count ?? 0}</b>{t('tags.deleteMsg3')}
        </>
      ),
      confirmText: t('tags.deleteConfirm'),
      danger: true
    })
    if (!ok) return
    try {
      await api.db.deleteTag(tag.id)
      await reloadTags()
      toast(t('tags.deleted'), 'ok')
    } catch (e: any) {
      toast(e.message || t('tags.deleteFailed'), 'err')
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <div className="row" style={{ alignItems: 'center', gap: 8, padding: '6px 4px', borderRadius: 8 }}>
        <span
          style={{
            width: 14,
            height: 14,
            borderRadius: 4,
            background: tag.color,
            flexShrink: 0,
            border: '1px solid rgba(0,0,0,0.12)'
          }}
        />
        {renaming ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveName()
              if (e.key === 'Escape') {
                setRenaming(false)
                setName(tag.name)
              }
            }}
            style={{ flex: 1, height: 28 }}
          />
        ) : (
          <span
            style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            onDoubleClick={() => {
              setName(tag.name)
              setRenaming(true)
            }}
            title={t('tags.dblRename')}
          >
            {tag.name}
          </span>
        )}
        {tag.count != null && (
          <span className="text-dim" style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
            {tag.count}
          </span>
        )}
        <div className="row" style={{ gap: 2 }}>
          <button className="btn icon sm" title={t('tags.rename')} onClick={() => { setName(tag.name); setRenaming(true) }}>
            <IconEdit size={14} />
          </button>
          <button className="btn icon sm" title={t('tags.color')} onClick={() => setColorOpen((v) => !v)}>
            <span style={{ width: 13, height: 13, borderRadius: '50%', background: tag.color, display: 'inline-block' }} />
          </button>
          <button className="btn icon sm" title={t('tags.moveToGroup')} onClick={() => setMoveOpen((v) => !v)}>
            <IconMove size={14} />
          </button>
          <button className="btn icon sm danger" title={t('tags.deleteBtn')} onClick={del}>
            <IconTrash size={14} />
          </button>
        </div>
      </div>

      {colorOpen && (
        <div
          style={{
            position: 'absolute',
            right: 6,
            top: 40,
            zIndex: 5,
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 8,
            boxShadow: 'var(--shadow-2)',
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 6
          }}
        >
          {PALETTE.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: c,
                border: tag.color === c ? '2px solid var(--text)' : '2px solid transparent'
              }}
            />
          ))}
        </div>
      )}

      {moveOpen && (
        <div
          style={{
            position: 'absolute',
            right: 6,
            top: 40,
            zIndex: 5,
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 5,
            boxShadow: 'var(--shadow-2)',
            minWidth: 140
          }}
        >
          <div className="ctx-label">{t('tags.moveTo')}</div>
          <div className="ctx-item" onClick={() => moveTo(null)}>
            <IconTag size={14} />
            <span className="label">{t('tags.ungrouped')}</span>
          </div>
          {tagGroups.map((g) => (
            <div key={g.id} className="ctx-item" onClick={() => moveTo(g.id)}>
              <span className="label">{g.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ---------- 标签管理主弹窗 ---------- */
export function TagManager({ onClose }: { onClose: () => void }) {
  const { tags, tagGroups, reloadTags, confirm, toast } = useApp()
  const [sel, setSel] = useState<Sel>('all')
  const [q, setQ] = useState('')
  const [newTag, setNewTag] = useState('')
  const [newGroup, setNewGroup] = useState('')
  const [editGroup, setEditGroup] = useState<{ id: string; name: string } | null>(null)
  const [groupColorOpen, setGroupColorOpen] = useState<string | null>(null)

  const ql = q.trim().toLowerCase()
  const visible = useMemo(
    () => tags.filter((t) => !ql || t.name.toLowerCase().includes(ql)),
    [tags, ql]
  )

  const sortedGroups = useMemo(
    () => [...tagGroups].sort((a, b) => a.order - b.order),
    [tagGroups]
  )
  const ungroupedCount = tags.filter((t) => !t.groupId).length
  const groupCount = (id: string) => tags.filter((t) => t.groupId === id).length

  const list = useMemo(() => {
    if (sel === 'all') return visible
    if (sel === 'none') return visible.filter((t) => !t.groupId)
    return visible.filter((t) => t.groupId === sel)
  }, [visible, sel])

  const createTag = async () => {
    const n = newTag.trim()
    if (!n) return
    const groupId = sel === 'all' || sel === 'none' ? null : sel
    try {
      await api.db.createTag({ name: n, groupId })
      await reloadTags()
      setNewTag('')
    } catch (e: any) {
      toast(e.message || t('tags.createFailed'), 'err')
    }
  }

  const createGroup = async () => {
    const n = newGroup.trim()
    if (!n) return
    try {
      await api.db.createTagGroup({ name: n })
      await reloadTags()
      setNewGroup('')
    } catch (e: any) {
      toast(e.message || t('tags.createFailed'), 'err')
    }
  }

  // 编辑态放在父组件（非独立组件），避免内联重渲染丢失输入
  const saveGroup = async () => {
    if (!editGroup) return
    const n = editGroup.name.trim()
    const g = tagGroups.find((x) => x.id === editGroup.id)
    if (n && n !== g?.name) {
      try {
        await api.db.updateTagGroup(editGroup.id, { name: n })
        await reloadTags()
      } catch (e: any) {
        toast(e.message || t('tags.renameFailed'), 'err')
      }
    }
    setEditGroup(null)
  }

  const setGroupColor = async (id: string, color: string) => {
    try {
      await api.db.updateTagGroup(id, { color })
      await reloadTags()
      setGroupColorOpen(null)
    } catch (e: any) {
      toast(e.message || t('tags.colorFailed'), 'err')
    }
  }

  const deleteGroup = async (g: TagGroup) => {
    const ok = await confirm({
      title: t('tags.deleteGroupTitle'),
      message: (
        <>
          {t('tags.deleteGroupMsg1')}<b>{g.name}</b>{t('tags.deleteGroupMsg2')}{groupCount(g.id)}{t('tags.deleteGroupMsg3')}
          <br />
          <span className="text-dim">{t('tags.deleteGroupHint')}</span>
        </>
      ),
      confirmText: t('tags.deleteGroupConfirm'),
      danger: true
    })
    if (!ok) return
    try {
      await api.db.deleteTagGroup(g.id)
      if (sel === g.id) setSel('all')
      await reloadTags()
      toast(t('tags.deletedGroup'), 'ok')
    } catch (e: any) {
      toast(e.message || t('tags.deleteFailed'), 'err')
    }
  }

  const leftCol = (
    <div
      style={{
        width: 212,
        borderRight: '1px solid var(--border)',
        paddingRight: 12,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0
      }}
    >
      <div className="ctx-label" style={{ marginBottom: 4 }}>{t('tags.groups')}</div>
      <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
        <div className={'sb-item' + (sel === 'all' ? ' active' : '')} onClick={() => setSel('all')}>
          <IconTags size={15} />
          <span className="label">{t('tags.allTags')}</span>
          <span className="count">{tags.length}</span>
        </div>
        <div className={'sb-item' + (sel === 'none' ? ' active' : '')} onClick={() => setSel('none')}>
          <IconTag size={15} />
          <span className="label">{t('tags.ungrouped')}</span>
          <span className="count">{ungroupedCount}</span>
        </div>
        {sortedGroups.map((g) =>
          editGroup?.id === g.id ? (
            <div key={g.id} className="sb-item" style={{ paddingRight: 6 }}>
              <input
                autoFocus
                value={editGroup.name}
                onChange={(e) => setEditGroup({ id: g.id, name: e.target.value })}
                onBlur={saveGroup}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveGroup()
                  if (e.key === 'Escape') setEditGroup(null)
                }}
                style={{ flex: 1, height: 24 }}
              />
            </div>
          ) : (
            <div
              key={g.id}
              className={'sb-item' + (sel === g.id ? ' active' : '')}
              onClick={() => setSel(g.id)}
            >
              <span
                className="row-act"
                title={t('tags.groupColorTitle')}
                onClick={(e) => {
                  e.stopPropagation()
                  setGroupColorOpen(groupColorOpen === g.id ? null : g.id)
                }}
                style={{ display: 'grid', placeItems: 'center' }}
              >
                <span
                  style={{
                    width: 11,
                    height: 11,
                    borderRadius: 3,
                    background: g.color,
                    border: '1px solid rgba(128,128,128,0.4)'
                  }}
                />
              </span>
              <span className="label">{g.name}</span>
              <span className="count">{groupCount(g.id)}</span>
              <span
                className="row-act"
                onClick={(e) => {
                  e.stopPropagation()
                  setEditGroup({ id: g.id, name: g.name })
                }}
              >
                <IconEdit size={13} />
              </span>
              <span
                className="row-act"
                onClick={(e) => {
                  e.stopPropagation()
                  deleteGroup(g)
                }}
              >
                <IconTrash size={13} />
              </span>
              {groupColorOpen === g.id && (
                <div className="grp-color-pop" onClick={(e) => e.stopPropagation()}>
                  {GROUP_PALETTE.map((c) => (
                    <button
                      key={c}
                      className="sw"
                      style={{
                        background: c,
                        outline: g.color === c ? '2px solid var(--text)' : '2px solid transparent'
                      }}
                      onClick={() => setGroupColor(g.id, c)}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        )}
      </div>
      <div className="row" style={{ marginTop: 8, gap: 6 }}>
        <input
          value={newGroup}
          onChange={(e) => setNewGroup(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && createGroup()}
          placeholder={t('tags.newGroupName')}
          style={{ flex: 1, height: 28 }}
        />
        <button className="btn sm primary" onClick={createGroup} title={t('tags.newGroup')}>
          <IconPlus size={14} />
        </button>
      </div>
    </div>
  )

  const rightCol = (
    <div className="col grow" style={{ minWidth: 0, minHeight: 0 }}>
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <span
          style={{
            position: 'absolute',
            left: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-3)',
            display: 'grid',
            placeItems: 'center',
            pointerEvents: 'none'
          }}
        >
          <IconTag size={14} />
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('tags.searchPlaceholder')}
          style={{ width: '100%', height: 32, paddingLeft: 30, borderRadius: 8, background: 'var(--panel-2)' }}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {list.length === 0 ? (
          <div className="empty">
            <IconTag size={34} className="big" />
            <div className="t">{sel === 'none' ? t('tags.noUngroupedTags') : t('tags.noTags')}</div>
            <div className="d">{t('tags.emptyHint')}</div>
          </div>
        ) : (
          list.map((t) => <TagRow key={t.id} tag={t} />)
        )}
      </div>

      <div className="row" style={{ marginTop: 10, gap: 6 }}>
        <input
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && createTag()}
          placeholder={t('tags.newTagName')}
          style={{ flex: 1, height: 30, borderRadius: 8 }}
        />
        <button className="btn primary" onClick={createTag}>
          <IconPlus size={14} />
          {t('tags.newTag')}
        </button>
      </div>
    </div>
  )

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal wide">
        <div className="modal-head">
          <span>{t('tags.manage')}</span>
          <button className="btn icon" onClick={onClose} title={t('misc.close')}>
            <IconX />
          </button>
        </div>
        <div className="modal-body">
          <div
            className="row"
            style={{ alignItems: 'stretch', gap: 0, height: '60vh', maxHeight: 560, minHeight: 380 }}
          >
            {leftCol}
            <div style={{ width: 16 }} />
            {rightCol}
          </div>
        </div>
      </div>
    </div>
  )
}
