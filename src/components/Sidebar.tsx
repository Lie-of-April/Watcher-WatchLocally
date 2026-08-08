import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '@/store/AppContext'
import { api } from '@/lib/api'
import { basename, dirname } from '@/lib/utils'
import { t } from '@/i18n/strings'
import {
  IconFolder, IconFolderOpen, IconChevronRight, IconChevronDown, IconPlus, IconX,
  IconHeart, IconTag, IconLayers, IconSettings, IconTrash, IconHome, IconImage, IconVideo,
  IconPlaylist, IconChevronLeft, IconSort, IconCheck
} from './Icons'
import type { SubDir, Entry } from '@/types'

interface Props {
  onOpenTagManager: () => void
  onOpenSettings: () => void
  onOpenPlaylists: () => void
  onDropToFolder: (targetPath: string, ev: React.DragEvent) => void
  /** 把文件夹节点拖到另一个文件夹上：移动文件夹 */
  onDropFolderToFolder: (srcPath: string, targetPath: string) => void
  /** 文件夹节点右键菜单 */
  onFolderMenu: (node: { path: string; name: string }, ev: React.MouseEvent) => void
  /** 树结构需要整体刷新时（移动/重命名后）自增，触发重建展开状态 */
  treeNonce: number
  /** 收起整个侧边栏 */
  onCollapse?: () => void
}

export function Sidebar({
  onOpenTagManager,
  onOpenSettings,
  onOpenPlaylists,
  onDropToFolder,
  onDropFolderToFolder,
  onFolderMenu,
  treeNonce,
  onCollapse
}: Props) {
  const {
    roots, currentDir, navigate, addRoot, removeRoot, playlists, startPlaylist,
    tags, tagGroups, filters, setFilters, runSearch, resetFilters, mode
  } = useApp()

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [children, setChildren] = useState<Record<string, SubDir[]>>({})
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set())
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [showTags, setShowTags] = useState(true)
  const [showPlaylists, setShowPlaylists] = useState(true)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('wb.sidebar.collapsedGroups')
      return raw ? new Set(JSON.parse(raw)) : new Set()
    } catch {
      return new Set()
    }
  })
  const toggleGroup = (gid: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(gid)) next.delete(gid)
      else next.add(gid)
      return next
    })
  }

  /* 侧边栏文件夹树的排序（独立于主区排序，仅影响左侧目录展示顺序）。
   * 持久化到 localStorage，重启后保持。 */
  const [subSortBy, setSubSortBy] = useState<'name' | 'mtime'>(() => {
    const v = localStorage.getItem('wb.sidebar.sortBy')
    return v === 'name' || v === 'mtime' ? v : 'name'
  })
  const [subSortDir, setSubSortDir] = useState<'asc' | 'desc'>(() => {
    const v = localStorage.getItem('wb.sidebar.sortDir')
    return v === 'asc' || v === 'desc' ? v : 'asc'
  })
  const [sortOpen, setSortOpen] = useState(false)
  useEffect(() => { localStorage.setItem('wb.sidebar.sortBy', subSortBy) }, [subSortBy])
  useEffect(() => { localStorage.setItem('wb.sidebar.sortDir', subSortDir) }, [subSortDir])
  useEffect(() => {
    try { localStorage.setItem('wb.sidebar.collapsedGroups', JSON.stringify([...collapsedGroups])) } catch { /* ignore */ }
  }, [collapsedGroups])

  const sortSubs = useCallback(
    <T extends { name: string; mtime?: number }>(list: T[]): T[] => {
      const arr = [...list]
      arr.sort((a, b) => {
        let r = 0
        if (subSortBy === 'mtime') {
          r = (a.mtime || 0) - (b.mtime || 0)
          // 修改时间相同（如媒体库根列表没有 mtime）时按名称兜底，保证排序确定且有效
          if (r === 0) r = a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
        } else {
          r = a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
        }
        return subSortDir === 'asc' ? r : -r
      })
      return arr
    },
    [subSortBy, subSortDir]
  )

  const loadChildren = useCallback(
    async (p: string, force = false) => {
      if (!force && children[p]) return
      setLoadingPaths((s) => new Set(s).add(p))
      try {
        const subs = await api.fs.listSubdirs(p)
        setChildren((c) => ({ ...c, [p]: subs }))
      } catch {
        setChildren((c) => ({ ...c, [p]: [] }))
      } finally {
        setLoadingPaths((s) => {
          const n = new Set(s)
          n.delete(p)
          return n
        })
      }
    },
    [children]
  )

  const toggleExpand = useCallback(
    (p: string) => {
      setExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(p)) next.delete(p)
        else {
          next.add(p)
          loadChildren(p)
        }
        return next
      })
    },
    [loadChildren]
  )

  // 导航到深层目录时，自动把沿途的树节点展开，让当前位置在树里可见
  useEffect(() => {
    if (!currentDir) return
    const root = roots.find(
      (r) =>
        currentDir.toLowerCase() === r.path.toLowerCase() ||
        currentDir.toLowerCase().startsWith(r.path.toLowerCase() + '/')
    )
    if (!root) return
    const rel = currentDir.slice(root.path.length).split('/').filter(Boolean)
    const toOpen: string[] = [root.path]
    let acc = root.path
    for (const seg of rel.slice(0, -1)) {
      acc = acc + '/' + seg
      toOpen.push(acc)
    }
    setExpanded((prev) => {
      const next = new Set(prev)
      toOpen.forEach((p) => next.add(p))
      return next
    })
    toOpen.forEach((p) => loadChildren(p))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDir, roots])

  // 文件夹被移动/重命名后刷新树：保留用户已经展开的节点，仅强制重新加载这些节点的子目录，
  // 这样拖拽移动后不会把整棵树都收起来。初次挂载不触发（避免清掉初始展开状态）。
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded
  const firstTreeNonce = useRef(true)
  useEffect(() => {
    if (firstTreeNonce.current) {
      firstTreeNonce.current = false
      return
    }
    setChildren({})
    expandedRef.current.forEach((p) => loadChildren(p, true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeNonce])

  const toggleTagFilter = (id: string) => {
    setFilters((f) => {
      const has = f.tagIds.includes(id)
      return { ...f, tagIds: has ? f.tagIds.filter((x) => x !== id) : [...f.tagIds, id] }
    })
  }

  // 标签筛选变化后自动跑搜索
  useEffect(() => {
    if (filters.tagIds.length || filters.favoriteOnly || filters.untaggedOnly) runSearch()
    else if (
      mode === 'search' &&
      !filters.query.trim() &&
      !filters.kinds.length &&
      filters.minRating === 0 &&
      !filters.scopeAll
    )
      resetFilters()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.tagIds, filters.favoriteOnly, filters.untaggedOnly])

  const renderNode = (node: { path: string; name: string; hasChild?: boolean }, depth: number) => {
    const isOpen = expanded.has(node.path)
    const isActive = currentDir?.toLowerCase() === node.path.toLowerCase() && mode === 'browse'
    const kids = sortSubs(children[node.path] || [])
    const loading = loadingPaths.has(node.path)
    const canExpand = node.hasChild !== false

    return (
      <div key={node.path}>
        <div
          className={
            'sb-item' +
            (isActive ? ' active' : '') +
            (dropTarget === node.path ? ' drop-target' : '')
          }
          draggable
          onClick={() => navigate(node.path)}
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-watcher-folder', node.path)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onFolderMenu({ path: node.path, name: node.name }, e)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setDropTarget(node.path)
          }}
          onDragLeave={() => setDropTarget((t) => (t === node.path ? null : t))}
          onDrop={(e) => {
            e.preventDefault()
            setDropTarget(null)
            const folder = e.dataTransfer.getData('application/x-watcher-folder')
            if (folder) onDropFolderToFolder(folder, node.path)
            else onDropToFolder(node.path, e)
          }}
          title={node.path}
        >
          {Array.from({ length: depth }).map((_, i) => (
            <span key={i} className="tree-guide" />
          ))}
          <span
            className={'tree-caret' + (canExpand ? '' : ' leaf')}
            onClick={(e) => {
              e.stopPropagation()
              if (canExpand) toggleExpand(node.path)
            }}
          >
            {loading ? (
              <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
            ) : isOpen ? (
              <IconChevronDown size={12} />
            ) : (
              <IconChevronRight size={12} />
            )}
          </span>
          {isOpen ? <IconFolderOpen size={14} /> : <IconFolder size={14} />}
          <span className="label">{node.name}</span>
        </div>
        {isOpen && kids && kids.map((k) => renderNode(k, depth + 1))}
          {isOpen && kids && kids.length === 0 && (
          <div
            className="text-dim"
            style={{ paddingLeft: 6 + (depth + 1) * 23 + 22, fontSize: 11, padding: '3px 0' }}
          >
            {t('sidebar.noSubfolders')}
          </div>
        )}
      </div>
    )
  }

  const quickFilter = (
    label: string,
    icon: React.ReactNode,
    active: boolean,
    onClick: () => void
  ) => (
    <div className={'sb-item' + (active ? ' active' : '')} onClick={onClick}>
      <span className="tree-caret leaf" />
      {icon}
      <span className="label">{label}</span>
    </div>
  )

  return (
    <aside className="sidebar">
      <div className="sidebar-scroll">
          {/* 媒体库 */}
          <div className="sb-section">
            <div className="sb-title">
              <span>{t('sidebar.library')}</span>
              <div className="acts">
                <div className="sb-sort-wrap">
                  <button
                    className={'btn icon sm' + (sortOpen ? ' on' : '')}
                    onClick={() => setSortOpen((o) => !o)}
                    title={t('sidebar.folderSort')}
                  >
                    <IconSort size={13} />
                  </button>
                  {sortOpen && (
                    <>
                      <div className="pop-overlay" onClick={() => setSortOpen(false)} />
                      <div className="sb-sort-pop">
                        <div className="pop-head">{t('sidebar.folderSort')}</div>
                        {(['name', 'mtime'] as const).map((k) => (
                          <div
                            key={k}
                            className="pop-item"
                            onClick={() => {
                              setSubSortBy(k)
                              setSortOpen(false)
                            }}
                          >
                            <span>{t('sort.' + k)}</span>
                            {subSortBy === k ? <IconCheck size={13} /> : <span style={{ width: 13 }} />}
                          </div>
                        ))}
                        <div className="pop-sep" />
                        {(['asc', 'desc'] as const).map((d) => (
                          <div
                            key={d}
                            className="pop-item"
                            onClick={() => {
                              setSubSortDir(d)
                              setSortOpen(false)
                            }}
                          >
                            <span>{t('sort.' + d)}</span>
                            {subSortDir === d ? <IconCheck size={13} /> : <span style={{ width: 13 }} />}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <button className="btn icon sm" onClick={addRoot} title={t('sidebar.addFolder')}>
                  <IconPlus size={13} />
                </button>
                {onCollapse && (
                  <button className="btn icon sm" onClick={onCollapse} title={t('sidebar.collapse')}>
                    <IconChevronLeft size={13} />
                  </button>
                )}
              </div>
            </div>
            {roots.length === 0 && (
              <div
                className="text-dim"
                style={{ padding: '8px 10px', fontSize: 11.5, lineHeight: 1.7 }}
              >
                {t('sidebar.noRoots')}
                <br />
                <button
                  className="btn sm"
                  style={{ paddingLeft: 0, color: 'var(--accent)' }}
                  onClick={addRoot}
                >
                  {t('sidebar.addNow')}
                </button>
              </div>
            )}
          {sortSubs(roots).map((r) => (
            <div key={r.id}>
              <div
                className={
                  'sb-item' +
                  (currentDir?.toLowerCase() === r.path.toLowerCase() && mode === 'browse'
                    ? ' active'
                    : '') +
                  (dropTarget === r.path ? ' drop-target' : '')
                }
                draggable
                onClick={() => navigate(r.path)}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-watcher-folder', r.path)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onFolderMenu({ path: r.path, name: r.name }, e)
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDropTarget(r.path)
                }}
                onDragLeave={() => setDropTarget((t) => (t === r.path ? null : t))}
                onDrop={(e) => {
                  e.preventDefault()
                  setDropTarget(null)
                  const folder = e.dataTransfer.getData('application/x-watcher-folder')
                  if (folder) onDropFolderToFolder(folder, r.path)
                  else onDropToFolder(r.path, e)
                }}
                title={r.path}
              >
                <span
                  className="tree-caret"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleExpand(r.path)
                  }}
                >
                  {expanded.has(r.path) ? (
                    <IconChevronDown size={12} />
                  ) : (
                    <IconChevronRight size={12} />
                  )}
                </span>
                <IconHome size={14} />
                <span className="label">{r.name}</span>
                <span
                  className="row-act"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeRoot(r.id)
                  }}
                  title={t('sidebar.removeRoot')}
                >
                  <IconX size={12} />
                </span>
              </div>
              {expanded.has(r.path) &&
                sortSubs(children[r.path] || []).map((k) => renderNode(k, 1))}
            </div>
          ))}
        </div>

        {/* 快捷筛选 */}
        <div className="sb-section">
          <div className="sb-title">
            <span>{t('sidebar.quickViews')}</span>
          </div>
          {quickFilter(t('sidebar.fav'), <IconHeart size={14} />, filters.favoriteOnly, () =>
            setFilters((f) => ({ ...f, favoriteOnly: !f.favoriteOnly, untaggedOnly: false }))
          )}
          {quickFilter(t('sidebar.untagged'), <IconLayers size={14} />, filters.untaggedOnly, () =>
            setFilters((f) => ({ ...f, untaggedOnly: !f.untaggedOnly, favoriteOnly: false }))
          )}
          {quickFilter(
            t('sidebar.onlyImages'),
            <IconImage size={14} />,
            filters.kinds.length === 2 && filters.kinds.includes('image'),
            () => {
              const on = filters.kinds.includes('image') && filters.kinds.length === 2
              setFilters((f) => ({ ...f, kinds: on ? [] : ['image', 'gif'] }))
              setTimeout(runSearch, 0)
            }
          )}
          {quickFilter(
            t('sidebar.onlyVideos'),
            <IconVideo size={14} />,
            filters.kinds.length === 1 && filters.kinds[0] === 'video',
            () => {
              const on = filters.kinds.length === 1 && filters.kinds[0] === 'video'
              setFilters((f) => ({ ...f, kinds: on ? [] : ['video'] }))
              setTimeout(runSearch, 0)
            }
          )}
        </div>

        {/* 播放列表：与标签同级的独立分组 */}
        <div className="sb-section">
          <div className="sb-title">
            <span
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
              onClick={() => setShowPlaylists((s) => !s)}
            >
              {showPlaylists ? <IconChevronDown size={11} /> : <IconChevronRight size={11} />}
              {t('sidebar.playlists')} {playlists.length > 0 && `(${playlists.length})`}
            </span>
            <div className="acts">
              <button className="btn icon sm" onClick={onOpenPlaylists} title={t('sidebar.playlistManage')}>
                <IconSettings size={13} />
              </button>
            </div>
          </div>

          {showPlaylists && (
            <>
              {playlists.length === 0 && (
                <div className="text-dim" style={{ padding: '6px 10px', fontSize: 11.5, lineHeight: 1.7 }}>
                  {t('sidebar.noPlaylists')}
                  <br />
                  <button
                    className="btn sm"
                    style={{ paddingLeft: 0, color: 'var(--accent)' }}
                    onClick={onOpenPlaylists}
                  >
                    {t('sidebar.newPlaylist')}
                  </button>
                </div>
              )}
              {playlists.map((p) => (
                <div
                  key={p.id}
                  className="sb-item"
                  onClick={() => startPlaylist(p.id)}
                  title={t('sidebar.playlistTitle', { name: p.name, count: p.items.length })}
                >
                  <span className="tree-caret leaf" />
                  <IconPlaylist size={14} />
                  <span className="label">{p.name}</span>
                  <span className="count">{p.items.length}</span>
                </div>
              ))}
            </>
          )}
        </div>

        {/* 标签 */}
        <div className="sb-section">
          <div className="sb-title">
            <span
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
              onClick={() => setShowTags((s) => !s)}
            >
              {showTags ? <IconChevronDown size={11} /> : <IconChevronRight size={11} />}
              {t('sidebar.tags')} {tags.length > 0 && `(${tags.length})`}
            </span>
            <div className="acts">
              <button className="btn icon sm" onClick={onOpenTagManager} title={t('sidebar.tagManage')}>
                <IconSettings size={13} />
              </button>
            </div>
          </div>

          {showTags && (
            <>
              {filters.tagIds.length > 0 && (
                <div style={{ padding: '2px 8px 8px' }}>
                  <button
                    className="btn sm"
                    style={{ color: 'var(--accent)', paddingLeft: 0 }}
                    onClick={() => setFilters((f) => ({ ...f, tagIds: [] }))}
                  >
                    {t('sidebar.clearFilters', { n: filters.tagIds.length })}
                  </button>
                </div>
              )}
              {tags.length === 0 && (
                <div className="text-dim" style={{ padding: '6px 10px', fontSize: 11.5 }}>
                  {t('sidebar.noTags')}
                </div>
              )}
              {groupTags(tags, tagGroups).map(({ group, list }) => {
                const gid = group?.id || 'ungrouped'
                const collapsed = collapsedGroups.has(gid)
                return (
                  <div key={gid}>
                    <div
                      className="tag-group-head"
                      onClick={() => toggleGroup(gid)}
                      title={collapsed ? t('sidebar.expandGroup') : t('sidebar.collapseGroup')}
                    >
                      {group?.color && (
                        <span
                          style={{
                            width: 9,
                            height: 9,
                            borderRadius: 3,
                            background: group.color,
                            flexShrink: 0
                          }}
                        />
                      )}
                      <span className="tg-name">{group ? group.name : t('sidebar.ungrouped')}</span>
                      {collapsed ? <IconChevronRight size={11} /> : <IconChevronDown size={11} />}
                    </div>
                    {!collapsed &&
                      list.map((t) => (
                        <div
                          key={t.id}
                          className={'sb-item' + (filters.tagIds.includes(t.id) ? ' active' : '')}
                          onClick={() => toggleTagFilter(t.id)}
                          title={t('sidebar.tagCount', { name: t.name, count: t.count || 0 })}
                        >
                          <span className="tree-caret leaf" />
                          <span
                            style={{
                              width: 9,
                              height: 9,
                              borderRadius: 3,
                              background: tagColor(t, tagGroups),
                              flexShrink: 0
                            }}
                          />
                          <span className="label">{t.name}</span>
                          <span className="count">{t.count || 0}</span>
                        </div>
                      ))}
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>

      <div
        style={{
          borderTop: '1px solid var(--border)',
          padding: 8,
          display: 'flex',
          gap: 6
        }}
      >
        <button className="btn grow" onClick={onOpenSettings}>
          <IconSettings size={14} /> {t('sidebar.settings')}
        </button>
      </div>
    </aside>
  )
}

function groupTags(tags: any[], groups: any[]) {
  const sorted = [...groups].sort((a, b) => (a.order || 0) - (b.order || 0))
  const out: { group: any | null; list: any[] }[] = []
  for (const g of sorted) {
    const list = tags.filter((t) => t.groupId === g.id)
    if (list.length) out.push({ group: g, list })
  }
  const un = tags.filter((t) => !t.groupId || !groups.some((g) => g.id === t.groupId))
  if (un.length) out.push({ group: sorted.length ? { id: null, name: t('sidebar.ungrouped') } : null, list: un })
  return out
}

/** 标签的颜色：属于某分类时取分类颜色（分类颜色优先），否则取标签自身颜色 */
function tagColor(t: any, groups: any[]): string {
  if (t.groupId) {
    const g = groups.find((x) => x.id === t.groupId)
    if (g) return g.color
  }
  return t.color
}

export default Sidebar
