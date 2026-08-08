import React, { useEffect, useRef, useState } from 'react'
import { useApp } from '@/store/AppContext'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { t } from '@/i18n/strings'
import {
  IconSearch, IconX, IconSort, IconGrid, IconChevronRight, IconCheck,
  IconFolderPlus, IconScan, IconLayers, IconFilter, IconTag, IconStar, IconChevronDown
} from './Icons'

export function Toolbar() {
  const {
    currentDir, roots, navigate, settings, patchSettings, filters, setFilters,
    runSearch, resetFilters, mode, doCreateFolder, startScan, indexProgress,
    activeFilterCount, entries, loading, tags, tagMap, viewerIndex,
    activeSortBy, activeSortDir, setActiveSortBy, setActiveSortDir
  } = useApp()

  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  // 点击/聚焦搜索框就立即展开筛选栏（范围/标签/评分），不必先敲字触发搜索
  const [searchFocused, setSearchFocused] = useState(false)
  const [q, setQ] = useState(filters.query)
  const timer = useRef<any>(null)
  const sizeSliderRef = useRef<HTMLInputElement>(null)

  useEffect(() => setQ(filters.query), [filters.query])

  /**
   * Ctrl + 滚轮调整缩略图大小。
   * 必须挂在 window 上的非被动监听：React 的 onWheel 默认 passive，preventDefault 失效；
   * 同时只有阻止默认行为，才能拦住 Chromium 把 Ctrl+滚轮当成「页面缩放」吞掉事件。
   */
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      /* 查看器打开时，Ctrl+滚轮交给查看器（缩放图片/漫画），这里不再改缩略图大小 */
      if (viewerIndex != null) return
      if (!e.ctrlKey) return
      e.preventDefault()
      const step = 20
      const base = settings.columnWidth
      const next = Math.max(140, Math.min(420, base + (e.deltaY < 0 ? step : -step)))
      patchSettings({ columnWidth: Math.round(next / 10) * 10 })
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [patchSettings, settings.columnWidth, viewerIndex])

  // 输入停顿后再搜，避免每敲一个字就扫一遍全库
  const onQueryChange = (v: string) => {
    setQ(v)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setFilters((f) => ({ ...f, query: v }))
      if (v.trim()) setTimeout(runSearch, 0)
      else if (
        mode === 'search' &&
        !filters.tagIds.length &&
        !filters.favoriteOnly &&
        !filters.untaggedOnly &&
        filters.minRating === 0 &&
        !filters.scopeAll &&
        !filters.kinds.length
      )
        resetFilters()
    }, 320)
  }

  const crumbs = buildCrumbs(currentDir, roots)

  const openSortMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const items: MenuItem[] = [
      { header: t('toolbar.sortHeader') },
      ...(['name', 'mtime', 'ctime', 'size', 'random', 'rating'] as const).map((k) => ({
        key: k,
        label: t('sort.' + k),
        icon: activeSortBy === k ? <IconCheck size={13} /> : <span style={{ width: 13 }} />,
        onClick: () => setActiveSortBy(k)
      })),
      { separator: true },
      {
        key: 'asc',
        label: t('sort.asc'),
        icon: activeSortDir === 'asc' ? <IconCheck size={13} /> : <span style={{ width: 13 }} />,
        onClick: () => setActiveSortDir('asc')
      },
      {
        key: 'desc',
        label: t('sort.desc'),
        icon: activeSortDir === 'desc' ? <IconCheck size={13} /> : <span style={{ width: 13 }} />,
        onClick: () => setActiveSortDir('desc')
      }
    ]
    setMenu({ x: r.left, y: r.bottom + 4, items })
  }

  const openViewMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const items: MenuItem[] = [
      { header: t('view.showHeader') },
      {
        key: 'folders',
        label: t('view.showFolders'),
        icon: settings.showFolders ? <IconCheck size={13} /> : <span style={{ width: 13 }} />,
        onClick: () => patchSettings({ showFolders: !settings.showFolders })
      },
      {
        key: 'folderFirst',
        label: t('view.folderFirst'),
        icon: settings.folderFirst ? <IconCheck size={13} /> : <span style={{ width: 13 }} />,
        onClick: () => patchSettings({ folderFirst: !settings.folderFirst })
      },
      {
        key: 'recursive',
        label: t('view.recursive'),
        icon: settings.recursive ? <IconCheck size={13} /> : <span style={{ width: 13 }} />,
        onClick: () => patchSettings({ recursive: !settings.recursive })
      },
      { separator: true },
      { header: t('view.hoverHeader') },
      {
        key: 'gif',
        label: t('view.hoverGif'),
        icon: settings.hoverPlayGif ? <IconCheck size={13} /> : <span style={{ width: 13 }} />,
        onClick: () => patchSettings({ hoverPlayGif: !settings.hoverPlayGif })
      },
      {
        key: 'video',
        label: t('view.hoverVideo'),
        icon: settings.hoverPlayVideo ? <IconCheck size={13} /> : <span style={{ width: 13 }} />,
        onClick: () => patchSettings({ hoverPlayVideo: !settings.hoverPlayVideo })
      },
      { separator: true },
      {
        key: 'autoCover',
        label: t('view.autoCover'),
        icon: settings.autoCover ? <IconCheck size={13} /> : <span style={{ width: 13 }} />,
        onClick: () => patchSettings({ autoCover: !settings.autoCover })
      }
    ]
    setMenu({ x: r.left - 60, y: r.bottom + 4, items })
  }

  const fileCount = entries.filter((e) => !e.isDir).length
  const dirCount = entries.filter((e) => e.isDir).length

  return (
    <>
      <div className="toolbar">
        <div className="breadcrumb">
          {mode === 'search' ? (
            <div className="row" style={{ gap: 6 }}>
              <IconFilter size={14} />
              <span style={{ fontWeight: 600 }}>{t('toolbar.searchResults')}</span>
              <span className="text-dim">
                {loading ? t('toolbar.loading') : t('toolbar.fileCount', { files: fileCount, dirs: dirCount ? t('toolbar.dirCount', { n: dirCount }) : '' })}
              </span>
              <button className="btn sm" onClick={resetFilters}>
                <IconX size={12} /> {t('toolbar.exitSearch')}
              </button>
            </div>
          ) : (
            crumbs.map((c, i) => (
              <React.Fragment key={c.path}>
                {i > 0 && (
                  <span className="crumb-sep">
                    <IconChevronRight size={12} />
                  </span>
                )}
                <span
                  className={'crumb' + (i === crumbs.length - 1 ? ' current' : '')}
                  onClick={() => navigate(c.path)}
                  title={c.path}
                >
                  {c.name}
                </span>
              </React.Fragment>
            ))
          )}
        </div>

        {mode === 'browse' && currentDir && (
          <span className="text-dim" style={{ whiteSpace: 'nowrap', fontSize: 11.5 }}>
            {loading ? t('toolbar.reading') : t('toolbar.fileCount', { files: fileCount, dirs: dirCount ? t('toolbar.dirCount', { n: dirCount }) : '' })}
          </span>
        )}

        <div className="divider-v" />

        <div className="search-box">
          <span className="s-icon">
            <IconSearch size={14} />
          </span>
          <input
            value={q}
            placeholder={t('toolbar.searchPlaceholder')}
            onFocus={() => setSearchFocused(true)}
            onBlur={(e) => {
              // 焦点转移到筛选栏内部的控件时（点标签/范围/评分），不要收起筛选栏
              const rt = e.relatedTarget as HTMLElement | null
              if (rt && rt.closest('.filter-bar')) return
              setSearchFocused(false)
            }}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                clearTimeout(timer.current)
                setFilters((f) => ({ ...f, query: q }))
                setTimeout(runSearch, 0)
              }
              if (e.key === 'Escape') {
                onQueryChange('')
                ;(e.target as HTMLInputElement).blur()
              }
            }}
          />
          {q && (
            <button className="s-clear" onClick={() => onQueryChange('')}>
              <IconX size={11} />
            </button>
          )}
        </div>

        <button className="btn icon" onClick={() => doCreateFolder()} title={t('toolbar.newFolder')}>
          <IconFolderPlus size={15} />
        </button>

        <button className="btn icon" onClick={openSortMenu} title={t('toolbar.sortTitle', { by: t('sort.' + activeSortBy), dir: t('sort.' + activeSortDir) })}>
          <IconSort size={15} />
        </button>

        <button className="btn icon" onClick={openViewMenu} title={t('toolbar.viewOptions')}>
          <IconGrid size={15} />
        </button>

        <div className="row" style={{ gap: 5 }} title={t('toolbar.thumbSize')}>
          <input
            ref={sizeSliderRef}
            className="slider"
            type="range"
            min={140}
            max={420}
            step={10}
            value={settings.columnWidth}
            onChange={(e) => patchSettings({ columnWidth: Number(e.target.value) })}
            style={{ width: 84 }}
          />
        </div>

        <button
          className="btn icon"
          onClick={startScan}
          disabled={!!indexProgress}
          title={t('toolbar.rebuildIndex')}
        >
          <IconScan size={15} />
        </button>
      </div>

      {indexProgress && (
        <div className="progress-strip">
          <span className="spinner" style={{ width: 13, height: 13, borderWidth: 2 }} />
          <span>
            {t('toolbar.indexing', { scanned: indexProgress.scanned, found: indexProgress.found })}
          </span>
          <span className="text-dim" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {indexProgress.current}
          </span>
        </div>
      )}

      {(mode === 'search' || searchFocused) && <FilterBar />}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </>
  )
}

function FilterBar() {
  const { filters, setFilters, runSearch, tagMap, resetFilters, currentDir, tags } = useApp()
  const [tagOpen, setTagOpen] = useState(false)
  const tagRef = useRef<HTMLDivElement>(null)

  const rerun = () => setTimeout(runSearch, 0)

  /* 标签弹层：点击外部关闭 */
  useEffect(() => {
    if (!tagOpen) return
    const onDown = (e: MouseEvent) => {
      if (tagRef.current && !tagRef.current.contains(e.target as Node)) setTagOpen(false)
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [tagOpen])

  const toggleTag = (id: string) => {
    setFilters((f) => ({
      ...f,
      tagIds: f.tagIds.includes(id) ? f.tagIds.filter((x) => x !== id) : [...f.tagIds, id]
    }))
    rerun()
  }
  const setRating = (n: number) => {
    setFilters((f) => ({ ...f, minRating: f.minRating === n ? 0 : n }))
    rerun()
  }
  const setScopeAll = (all: boolean) => {
    setFilters((f) => ({ ...f, scopeAll: all }))
    rerun()
  }
  // 默认（scopeAll 未显式开启）即在「当前文件夹」内搜索；没有打开的文件夹时退化为全部
  const effectiveAll = filters.scopeAll || !currentDir

  return (
    <div className="filter-bar">
      <span className="text-dim" style={{ fontWeight: 600 }}>
        {t('toolbar.filter')}
      </span>

      {/* 搜索范围：当前文件夹（默认）/ 全部媒体库 */}
      <span className="fb-label">{t('toolbar.scope')}</span>
      <div className="seg">
        <button
          className={!effectiveAll ? 'on' : ''}
          disabled={!currentDir}
          title={currentDir ? t('toolbar.scopeCurrentTitle', { dir: currentDir }) : t('toolbar.scopeDisabled')}
          onClick={() => setScopeAll(false)}
        >
          {t('toolbar.scopeCurrent')}
        </button>
        <button
          className={effectiveAll ? 'on' : ''}
          disabled={!currentDir}
          title={currentDir ? t('toolbar.scopeAllTitle') : t('toolbar.scopeDisabled')}
          onClick={() => setScopeAll(true)}
        >
          {t('toolbar.scopeAll')}
        </button>
      </div>

      {/* 标签多选 */}
      {tags.length > 0 && (
        <div className="fb-tag-wrap" ref={tagRef}>
          <button
            className={'btn sm' + (filters.tagIds.length ? ' on' : '')}
            onClick={() => setTagOpen((v) => !v)}
            title={t('toolbar.tagFilter')}
          >
            <IconTag size={13} />
            {t('toolbar.tagsFilter', { count: filters.tagIds.length ? ` (${filters.tagIds.length})` : '' })}
            <IconChevronDown size={11} />
          </button>
          {tagOpen && (
            <div className="fb-tag-pop">
              <div className="fb-tag-pop-head">
                <span>{t('toolbar.tagFilter')}</span>
                {filters.tagIds.length > 0 && (
                  <span
                    className="link"
                    onClick={() => {
                      setFilters((f) => ({ ...f, tagIds: [] }))
                      rerun()
                    }}
                  >
                    {t('toolbar.clear')}
                  </span>
                )}
              </div>
              <div className="fb-tag-list">
                {tags.map((t) => {
                  const on = filters.tagIds.includes(t.id)
                  return (
                    <div
                      key={t.id}
                      className={'fb-tag-row' + (on ? ' on' : '')}
                      onClick={() => toggleTag(t.id)}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.color }} />
                      <span className="fb-tag-name">{t.name}</span>
                      {on && <IconCheck size={13} />}
                    </div>
                  )
                })}
              </div>
              {filters.tagIds.length > 1 && (
                <div className="fb-tag-mode">
                  <span className="text-dim" style={{ fontSize: 11 }}>{t('toolbar.tagRelation')}</span>
                  <div className="seg sm">
                    {(['and', 'or', 'not'] as const).map((m) => (
                      <button
                        key={m}
                        className={filters.tagMode === m ? 'on' : ''}
                        onClick={() => {
                          setFilters((f) => ({ ...f, tagMode: m }))
                          rerun()
                        }}
                      >
                        {m === 'and' ? t('toolbar.tagModeAnd') : m === 'or' ? t('toolbar.tagModeOr') : t('toolbar.tagModeNot')}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 已选标签 chips */}
      {filters.tagIds.length > 0 && (
        <div className="tag-wrap">
          {filters.tagIds.map((id) => {
            const t = tagMap[id]
            if (!t) return null
            return (
              <span
                key={id}
                className="tag-chip"
                style={{ background: hexA(t.color, 0.16), color: darken(t.color) }}
              >
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.color }} />
                {t.name}
                <span
                  className="x"
                  onClick={() => {
                    setFilters((f) => ({ ...f, tagIds: f.tagIds.filter((x) => x !== id) }))
                    rerun()
                  }}
                >
                  <IconX size={10} />
                </span>
              </span>
            )
          })}
        </div>
      )}

      {/* 评分：全部 / 未评分 / 已评分 / ★1-5 */}
      <span className="fb-label">{t('toolbar.rating')}</span>
      <div className="seg">
        <button className={filters.minRating === 0 ? 'on' : ''} onClick={() => setRating(0)}>
          {t('toolbar.ratingAll')}
        </button>
        <button className={filters.minRating === -1 ? 'on' : ''} onClick={() => setRating(-1)}>
          {t('toolbar.ratingNone')}
        </button>
        <button className={filters.minRating === -2 ? 'on' : ''} onClick={() => setRating(-2)}>
          {t('toolbar.ratingRated')}
        </button>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            className={filters.minRating === n ? 'on' : ''}
            title={t('toolbar.ratingAtLeast', { n })}
            onClick={() => setRating(n)}
          >
            <IconStar size={11} style={{ color: filters.minRating === n ? 'var(--warn)' : 'inherit' }} />
            <span style={{ fontSize: 10 }}>{n}</span>
          </button>
        ))}
      </div>

      {filters.favoriteOnly && <span className="tag-chip" style={{ background: '#ffe9ec', color: '#c02b3a' }}>{t('toolbar.onlyFav')}</span>}
      {filters.untaggedOnly && <span className="tag-chip" style={{ background: '#eef0f3', color: '#4a5160' }}>{t('toolbar.noTag')}</span>}
      {filters.kinds.length > 0 && (
        <span className="tag-chip" style={{ background: '#e8f2ff', color: '#1a5fb4' }}>
          {filters.kinds.includes('video') ? t('toolbar.onlyVideo') : t('toolbar.onlyImage')}
        </span>
      )}

      <div className="grow" />
      <button className="btn sm" onClick={resetFilters}>
        {t('toolbar.clearAll')}
      </button>
    </div>
  )
}

function buildCrumbs(dir: string | null, roots: any[]) {
  if (!dir) return []
  const root = roots.find(
    (r) => dir.toLowerCase() === r.path.toLowerCase() || dir.toLowerCase().startsWith(r.path.toLowerCase() + '/')
  )
  const out: { name: string; path: string }[] = []
  if (root) {
    out.push({ name: root.name, path: root.path })
    const rest = dir.slice(root.path.length).split('/').filter(Boolean)
    let acc = root.path
    for (const seg of rest) {
      acc += '/' + seg
      out.push({ name: seg, path: acc })
    }
  } else {
    const parts = dir.split('/').filter(Boolean)
    let acc = ''
    parts.forEach((p, i) => {
      acc = i === 0 ? p + '/' : acc + (acc.endsWith('/') ? '' : '/') + p
      out.push({ name: p, path: acc })
    })
  }
  return out
}

export function hexA(hex: string, a: number) {
  const h = String(hex).replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

export function darken(hex: string, amount = 0.42) {
  const h = String(hex).replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  const r = Math.round(((n >> 16) & 255) * (1 - amount))
  const g = Math.round(((n >> 8) & 255) * (1 - amount))
  const b = Math.round((n & 255) * (1 - amount))
  return `rgb(${r}, ${g}, ${b})`
}

export default Toolbar
