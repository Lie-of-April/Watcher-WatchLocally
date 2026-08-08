import React, { useEffect, useState } from 'react'
import { Thumb, CoverImage } from './Thumb'
import { api } from '@/lib/api'
import { formatSize, formatDuration, basename } from '@/lib/utils'
import { IconCheck, IconHeart, IconTag, IconFolder, IconPicture, IconPlay } from './Icons'
import { useAnimated } from '@/lib/animated'
import { t } from '@/i18n/strings'
import type { CellLayout } from './MasonryGrid'
import type { Entry, ItemMeta, FolderMeta, Tag } from '@/types'

interface CommonHandlers {
  onOpen: (e: Entry) => void
  onSelect: (e: Entry, mode: 'single' | 'toggle' | 'range') => void
  onContext: (e: Entry, ev: React.MouseEvent) => void
  onToggleFav: (e: Entry) => void
  onTagClick: (e: Entry, ev: React.MouseEvent) => void
  onDragStart: (e: Entry, ev: React.DragEvent) => void
}

/* ---------------- 媒体卡片 ---------------- */

interface MediaCardProps extends CommonHandlers {
  cell: CellLayout
  selected: boolean
  meta?: ItemMeta
  tagMap: Record<string, Tag>
  onDims: (p: string, w: number, h: number) => void
  hoverPlayGif: boolean
  hoverPlayVideo: boolean
  hoverPlayJpg: boolean
  hoverPlayWebp: boolean
  anySelected: boolean
}

export const MediaCard = React.memo(function MediaCard({
  cell,
  selected,
  meta,
  tagMap,
  onDims,
  hoverPlayGif,
  hoverPlayVideo,
  hoverPlayJpg,
  hoverPlayWebp,
  anySelected,
  onOpen,
  onSelect,
  onContext,
  onToggleFav,
  onTagClick,
  onDragStart
}: MediaCardProps) {
  const { entry, x, y, w, h } = cell
  const [hover, setHover] = useState(false)

  // 这张图要不要动（GIF/动画WebP/APNG/多帧JPEG）？按需读文件头判定
  const animated = useAnimated(entry)

  const isJpg = entry.kind === 'image' && /\.jpe?g$/i.test(entry.ext)
  const isWebp = entry.kind === 'image' && /\.webp$/i.test(entry.ext)
  const hoverPlay =
    !entry.albumPath &&
    ((entry.kind === 'gif' && hoverPlayGif) ||
      (entry.kind === 'video' && hoverPlayVideo) ||
      (isJpg && hoverPlayJpg) ||
      (isWebp && hoverPlayWebp))

  // 正在播放预览时，角标让路，别挡着画面
  const previewing = hoverPlay && hover
  const isMotion = animated && !entry.albumPath && entry.kind !== 'video'
  // 动图角标统一显示大写 GIF（不论底层是 gif / 动画 webp / apng / 多帧 jpg）
  const motionLabel = t('cards.gif')

  const click = (ev: React.MouseEvent) => {
    if (ev.shiftKey) onSelect(entry, 'range')
    else if (ev.ctrlKey || ev.metaKey) onSelect(entry, 'toggle')
    else if (anySelected) onSelect(entry, 'single')
    else onOpen(entry)
  }

  const tagIds = meta?.tags || []

  return (
    <div
      className={'m-card' + (selected ? ' selected' : '')}
      style={{ transform: `translate(${x}px, ${y}px)`, width: w, height: h }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={click}
      onDoubleClick={(ev) => {
        ev.stopPropagation()
        onOpen(entry)
      }}
      onContextMenu={(ev) => onContext(entry, ev)}
      draggable
      onDragStart={(ev) => onDragStart(entry, ev)}
      data-path={entry.path}
    >
      <Thumb entry={entry} onDims={onDims} hoverPlay={hoverPlay} hovering={hover} />

      {isMotion && (
        <div className={'badge tl motion-badge' + (previewing ? ' hide' : '')}>
          <IconPlay size={9} />
          {motionLabel}
        </div>
      )}
      {!isMotion && entry.kind === 'gif' && <div className="badge tl">{t('cards.gif')}</div>}
      {entry.kind === 'video' && (
        <div className="badge tl">
          {formatSize(entry.size)}
        </div>
      )}
      {entry.albumPath && (
        <div className="badge album-badge">{t('cards.albumBadge', { count: entry.albumCount ? ` · ${entry.albumCount}` : '' })}</div>
      )}

      <div
        className={'select-check' + (selected ? ' on' : '')}
        onClick={(ev) => {
          ev.stopPropagation()
          onSelect(entry, 'toggle')
        }}
        title={t('cards.select')}
      >
        {selected && <IconCheck size={12} strokeWidth={3} />}
      </div>

      <div className="m-actions">
        <button
          className={'m-act' + (meta?.favorite ? ' on' : '')}
          onClick={(ev) => {
            ev.stopPropagation()
            onToggleFav(entry)
          }}
          title={t('cards.fav')}
        >
          <IconHeart size={13} />
        </button>
        <button
          className="m-act"
          onClick={(ev) => {
            ev.stopPropagation()
            onTagClick(entry, ev)
          }}
          title={t('cards.tag')}
        >
          <IconTag size={13} />
        </button>
      </div>

      {tagIds.length > 0 && (
        <div className="m-tags">
          {tagIds.slice(0, 6).map((id) => {
            const t = tagMap[id]
            if (!t) return null
            return <span key={id} className="tag-dot" style={{ background: t.color }} title={t.name} />
          })}
        </div>
      )}

      {/* 悬浮文件名：只在卡片内显示，不用 title 属性，避免鼠标旁再冒一个系统 tooltip */}
      <div className="m-overlay">
        <div className="n">{entry.albumPath ? basename(entry.albumPath) : entry.name}</div>
      </div>
    </div>
  )
})

/* ---------------- 文件夹卡片 ---------------- */

interface FolderCardProps extends CommonHandlers {
  entry: Entry
  selected: boolean
  meta?: FolderMeta
  tagMap: Record<string, Tag>
  autoCover: boolean
  isDropTarget: boolean
  onDropFiles: (target: Entry, ev: React.DragEvent) => void
  onDragOverFolder: (target: Entry | null) => void
  anySelected: boolean
}

export const FolderCard = React.memo(function FolderCard({
  entry,
  selected,
  meta,
  tagMap,
  autoCover,
  isDropTarget,
  onOpen,
  onSelect,
  onContext,
  onToggleFav,
  onTagClick,
  onDragStart,
  onDropFiles,
  onDragOverFolder,
  anySelected
}: FolderCardProps) {
  const [cover, setCover] = useState<string | null>(meta?.cover || null)
  const [count, setCount] = useState<{ files: number; dirs: number } | null>(null)
  const manual = meta?.coverMode === 'manual' && !!meta?.cover

  // 手动封面优先；没设过就按需去文件夹里找第一张图
  useEffect(() => {
    let cancelled = false
    if (meta?.cover) {
      setCover(meta.cover)
      return
    }
    setCover(null)
    if (!autoCover) return
    api.fs
      .autoCover(entry.path)
      .then((p) => {
        if (!cancelled) setCover(p)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [entry.path, meta?.cover, autoCover])

  useEffect(() => {
    let cancelled = false
    api.fs
      .countMedia(entry.path)
      .then((c) => {
        if (!cancelled) setCount(c)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [entry.path])

  const click = (ev: React.MouseEvent) => {
    if (ev.shiftKey) onSelect(entry, 'range')
    else if (ev.ctrlKey || ev.metaKey) onSelect(entry, 'toggle')
    else if (anySelected) onSelect(entry, 'single')
    else onOpen(entry)
  }

  const tagIds = meta?.tags || []

  return (
    <div
      className={
        'folder-card' + (selected ? ' selected' : '') + (isDropTarget ? ' drop-target' : '')
      }
      onClick={click}
      onDoubleClick={(ev) => {
        ev.stopPropagation()
        onOpen(entry)
      }}
      onContextMenu={(ev) => onContext(entry, ev)}
      draggable
      onDragStart={(ev) => onDragStart(entry, ev)}
      onDragOver={(ev) => {
        ev.preventDefault()
        ev.dataTransfer.dropEffect = 'move'
        onDragOverFolder(entry)
      }}
      onDragLeave={() => onDragOverFolder(null)}
      onDrop={(ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        onDragOverFolder(null)
        onDropFiles(entry, ev)
      }}
      data-path={entry.path}
    >
      <CoverImage coverPath={cover} manual={manual} />

      <div
        className={'select-check' + (selected ? ' on' : '')}
        onClick={(ev) => {
          ev.stopPropagation()
          onSelect(entry, 'toggle')
        }}
      >
        {selected && <IconCheck size={12} strokeWidth={3} />}
      </div>

      <div className="m-actions">
        <button
          className={'m-act' + (meta?.favorite ? ' on' : '')}
          onClick={(ev) => {
            ev.stopPropagation()
            onToggleFav(entry)
          }}
          title={t('cards.fav')}
        >
          <IconHeart size={13} />
        </button>
        <button
          className="m-act"
          onClick={(ev) => {
            ev.stopPropagation()
            onTagClick(entry, ev)
          }}
          title={t('cards.tag')}
        >
          <IconTag size={13} />
        </button>
      </div>

      <div className="folder-meta">
        <div className="folder-name" title={entry.name}>{entry.name}</div>
        <div className="folder-sub">
          <IconFolder size={11} />
          <span>
            {count
              ? t('cards.folderItems', { files: count.files, sub: count.dirs ? t('cards.folderSubdirs', { n: count.dirs }) : '' })
              : t('cards.loading')}
          </span>
          {tagIds.length > 0 && (
            <span style={{ display: 'flex', gap: 3, marginLeft: 'auto' }}>
              {tagIds.slice(0, 4).map((id) => {
                const t = tagMap[id]
                if (!t) return null
                return (
                  <span
                    key={id}
                    className="tag-dot"
                    style={{ background: t.color, boxShadow: 'none' }}
                    title={t.name}
                  />
                )
              })}
            </span>
          )}
        </div>
      </div>
    </div>
  )
})
