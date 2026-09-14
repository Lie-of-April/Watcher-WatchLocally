import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '@/store/AppContext'
import { api } from '@/lib/api'
import { dirname } from '@/lib/utils'
import { useMarquee } from '@/lib/marquee'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { ContextMenu, type MenuItem } from './components/ContextMenu'
import { MasonryGrid, type CellLayout } from './components/MasonryGrid'
import { MediaCard, FolderCard } from './components/Cards'
import { Viewer } from './components/Viewer'
import { TagPicker } from './components/TagPicker'
import { TagManager } from './components/TagManager'
import { PlaylistManager } from './components/PlaylistManager'
import { PlaylistPicker } from './components/PlaylistPicker'
import {
  IconFolderOpen, IconHeart, IconTag, IconImage, IconEdit, IconMove, IconCopy,
  IconExternal, IconTrash, IconRefresh, IconPlus, IconCheck, IconX, IconDatabase, IconPlaylist, IconLayers, IconStar,
  IconChevronDown, IconChevronRight
} from './components/Icons'
import type { Entry } from '@/types'
import { t } from '@/i18n/strings'

export function App() {
  const app = useApp()
  const {
    currentDir, entries, folderEntries, loading, error,
    mode, navigate, refresh, openViewer, viewerIndex,
    isSelected, selectOnly, toggleSelect, selectRange, selectPaths, selectAll, clearSelection, selection, selectedEntries,
    itemMeta, folderMeta, tagMap, applyMetaPatch,
    doToggleFavorite, doRename, doTrash, doMove, doCopy, doSetCover,
    addRoot, toasts, toast, settings, patchSettings, reloadTags,
    openAlbum, setFolderView, setFoldersAlbum, streamEntries, albumShown,
    viewerBorderless
  } = app

  const onToggleFav = doToggleFavorite

  const scrollRef = useRef<HTMLDivElement>(null)
  const selTagBtnRef = useRef<HTMLButtonElement>(null)
  // 框选用：把当前选择镜像到 ref，手势开始时能拿到稳定快照（不随每帧 setState 变化）
  const selectionRef = useRef(selection)
  selectionRef.current = selection

  const [entryMenu, setEntryMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [tagTargets, setTagTargets] = useState<{ path: string; isDir: boolean }[] | null>(null)
  const [tagPos, setTagPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [tagManagerOpen, setTagManagerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [playlistManagerOpen, setPlaylistManagerOpen] = useState(false)
  const [playlistPicker, setPlaylistPicker] = useState<{ x: number; y: number; paths: string[] } | null>(null)
  const [dropFolder, setDropFolder] = useState<Entry | null>(null)
  const [dropActive, setDropActive] = useState(false)
  // 子文件夹区是否展开：子文件夹过多时可收起，避免占掉大片空间（套图封面仍穿插在图片中）
  const [showFolders, setShowFolders] = useState(true)

  // 侧边栏可整体收起 + 鼠标拖动调整宽度（持久化到 localStorage）
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('watcher.sidebar.collapsed') === '1' } catch { return false }
  })
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try { return Math.max(180, Math.min(460, Number(localStorage.getItem('watcher.sidebar.width')) || 248)) } catch { return 248 }
  })
  const sidebarWidthRef = useRef(sidebarWidth)
  sidebarWidthRef.current = sidebarWidth
  useEffect(() => { try { localStorage.setItem('watcher.sidebar.collapsed', sidebarCollapsed ? '1' : '0') } catch { /* ignore */ } }, [sidebarCollapsed])
  useEffect(() => { try { localStorage.setItem('watcher.sidebar.width', String(sidebarWidth)) } catch { /* ignore */ } }, [sidebarWidth])

  const startResizeSidebar = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarWidthRef.current
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(180, Math.min(460, startW + (ev.clientX - startX)))
      setSidebarWidth(w)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.classList.remove('col-resizing')
    }
    document.body.classList.add('col-resizing')
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  /* ---------------- 条目操作 ---------------- */

  const onOpen = useCallback((e: Entry) => {
    if (e.albumPath) {
      openAlbum(e.albumPath)
      return
    }
    if (e.isDir) navigate(e.path)
    else openViewer(e.path)
  }, [navigate, openViewer, openAlbum])

  const onSelect = useCallback((e: Entry, kind: 'single' | 'toggle' | 'range') => {
    if (kind === 'single') selectOnly(e.path)
    else if (kind === 'toggle') toggleSelect(e.path, true)
    else if (kind === 'range') selectRange(e.path)
  }, [selectOnly, toggleSelect, selectRange])

  const openTag = useCallback((targets: Entry[], ev: React.MouseEvent | null) => {
    let x = 200
    let y = 200
    if (ev) {
      x = ev.clientX
      y = ev.clientY
    } else if (selTagBtnRef.current) {
      const r = selTagBtnRef.current.getBoundingClientRect()
      x = r.left
      y = r.bottom + 6
    }
    setTagPos({ x, y })
    setTagTargets(targets.map((t) => ({ path: t.path, isDir: t.isDir })))
  }, [])

  const onTagClick = useCallback((e: Entry, ev: React.MouseEvent) => {
    openTag([e], ev)
  }, [openTag])

  const onRate = useCallback(
    async (e: Entry, value: number) => {
      applyMetaPatch(e.path, e.isDir, { rating: value })
      try {
        await api.db.setRating(e.path, e.isDir, value)
      } catch (err: any) {
        applyMetaPatch(e.path, e.isDir, { rating: e.rating || 0 })
        toast(err.message || t('viewer.ratingSaveFailed'), 'err')
      }
    },
    [applyMetaPatch, toast]
  )

  const onContext = useCallback((e: Entry, ev: React.MouseEvent) => {
    ev.preventDefault()
    const multi = selection.size > 1 && selection.has(e.path)
    const targets: Entry[] = multi ? selectedEntries : [e]
    const paths = targets.map((t) => t.path)
    const single = targets.length === 1 ? targets[0] : null
    const items: MenuItem[] = []

    if (single) {
      items.push({
        key: 'open',
        label: single.isDir ? t('ctx.openFolder') : t('ctx.view'),
        icon: <IconFolderOpen size={14} />,
        onClick: () => onOpen(single)
      })
    }

    if (single) {
      const fav = single.isDir ? folderMeta[single.path]?.favorite : itemMeta[single.path]?.favorite
      items.push({
        key: 'fav',
        label: fav ? t('ctx.unfavorite') : t('ctx.favorite'),
        icon: <IconHeart size={14} />,
        onClick: () => onToggleFav(single)
      })
    }

    items.push({
      key: 'tag',
      label: t('ctx.addTag'),
      icon: <IconTag size={14} />,
      onClick: () => openTag(targets, null)
    })

    /* 评分：折叠进二级菜单，避免右键菜单过长 */
    if (single) {
      const rateSub: MenuItem[] = []
      for (let n = 1; n <= 5; n++) {
        rateSub.push({
          key: 'rate' + n,
          label: t('ctx.nStar', { n }),
          icon: <IconStar size={13} style={{ color: (single.rating || 0) >= n ? 'var(--warn)' : 'inherit' }} />,
          onClick: () => onRate(single, n)
        })
      }
      rateSub.push({ key: 'rate0', label: t('ctx.clearRating'), onClick: () => onRate(single, 0) })
      items.push({ key: 'rate', label: t('ctx.rating'), icon: <IconStar size={14} />, submenu: rateSub })
    }

    items.push({
      key: 'playlist',
      label: t('ctx.addToPlaylist'),
      icon: <IconPlaylist size={14} />,
      onClick: () => setPlaylistPicker({ x: ev.clientX, y: ev.clientY, paths })
    })

    if (single) {
      if (!single.isDir && (single.kind === 'image' || single.kind === 'gif' || single.kind === 'video')) {
        items.push({
          key: 'cover',
          label: t('ctx.setParentCover'),
          icon: <IconImage size={14} />,
          onClick: () => doSetCover(dirname(single.path), single.path)
        })
      }
      if (single.isDir) {
        items.push({
          key: 'coverpick',
          label: t('ctx.pickCover'),
          icon: <IconImage size={14} />,
          onClick: async () => {
            const p = await api.fs.pickFile({})
            if (p) doSetCover(single.path, p)
          }
        })
        if (folderMeta[single.path]?.coverMode === 'manual') {
          items.push({
            key: 'coverauto',
            label: t('ctx.restoreCover'),
            icon: <IconRefresh size={14} />,
            onClick: () => doSetCover(single.path, null)
          })
        }
        const isAlbum = folderMeta[single.path]?.view === 'album'
        items.push({
          key: 'album',
          label: isAlbum ? t('ctx.unsetAlbum') : t('ctx.setAlbum'),
          icon: <IconLayers size={14} />,
          onClick: () => setFolderView(single.path, isAlbum ? 'normal' : 'album')
        })
      }
      /* 在查看器里右键套图内的图片：可直接取消该套图，或把当前图设为套图封面 */
      if (single.albumPath && !single.isDir) {
        items.push({
          key: 'albumoff',
          label: t('ctx.unsetAlbum'),
          icon: <IconLayers size={14} />,
          onClick: () => setFolderView(single.albumPath!, 'normal')
        })
        items.push({
          key: 'albumcover',
          label: t('ctx.setAlbumCover'),
          icon: <IconImage size={14} />,
          onClick: () => doSetCover(single.albumPath!, single.path)
        })
      }
    }

    items.push({ separator: true })

    if (single) {
      items.push({
        key: 'rename',
        label: t('ctx.rename'),
        icon: <IconEdit size={14} />,
        onClick: () => doRename(single)
      })
    }
    items.push({
      key: 'move',
      label: t('ctx.moveTo'),
      icon: <IconMove size={14} />,
      onClick: async () => {
        const p = await api.fs.pickFolder()
        if (p) doMove(paths, p)
      }
    })
    items.push({
      key: 'copy',
      label: t('ctx.copyTo'),
      icon: <IconCopy size={14} />,
      onClick: async () => {
        const p = await api.fs.pickFolder()
        if (p) doCopy(paths, p)
      }
    })

    items.push({ separator: true })
    items.push({
      key: 'reveal',
      label: t('misc.revealInExplorer'),
      icon: <IconExternal size={14} />,
      onClick: async () => {
        try { await api.fs.reveal(single ? single.path : paths[0]) } catch { /* 忽略 */ }
      }
    })
    items.push({
      key: 'trash',
      label: multi ? t('ctx.deleteN', { n: targets.length }) : t('ctx.delete'),
      icon: <IconTrash size={14} />,
      danger: true,
      onClick: () => doTrash(paths)
    })

    setEntryMenu({ x: ev.clientX, y: ev.clientY, items })
  }, [selection, selectedEntries, folderMeta, itemMeta, onOpen, onToggleFav, openTag, doSetCover, doRename, doMove, doCopy, doTrash, setFolderView, onRate])

  /* ---------------- 拖拽 ---------------- */

  const onCardDragStart = useCallback((e: Entry, ev: React.DragEvent) => {
    const paths = selection.size > 1 && selection.has(e.path)
      ? selectedEntries.map((x) => x.path)
      : [e.path]
    ev.dataTransfer.setData('application/x-watcher-paths', JSON.stringify(paths))
    ev.dataTransfer.effectAllowed = 'copyMove'
  }, [selection, selectedEntries])

  const onDragOverFolder = useCallback((target: Entry | null) => setDropFolder(target), [])

  const handleDropFiles = useCallback(async (ev: React.DragEvent, targetPath: string) => {
    ev.preventDefault()
    const raw = ev.dataTransfer.getData('application/x-watcher-paths')
    if (raw) {
      try {
        const paths: string[] = JSON.parse(raw)
        if (paths.length) await doMove(paths, targetPath)
      } catch { /* 解析失败忽略 */ }
      return
    }
    const files = Array.from(ev.dataTransfer.files || [])
    if (files.length) {
      const paths = files
        .map((f) => api.fs.pathForFile(f))
        .filter(Boolean) as string[]
      if (paths.length) await doCopy(paths, targetPath)
    }
  }, [doMove, doCopy])

  const onDropFiles = useCallback((target: Entry, ev: React.DragEvent) => {
    handleDropFiles(ev, target.path)
  }, [handleDropFiles])

  const onContentDrop = useCallback((ev: React.DragEvent) => {
    setDropActive(false)
    if (!currentDir) return
    handleDropFiles(ev, currentDir)
  }, [currentDir, handleDropFiles])

  /* ---------------- 快捷键 ---------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (viewerIndex != null) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'F5') {
        e.preventDefault()
        refresh()
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        if (entries.length) { e.preventDefault(); selectAll() }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.size) {
          e.preventDefault()
          doTrash(selectedEntries.map((p) => p.path))
        }
      } else if (e.key === 'Escape') {
        if (selection.size) clearSelection()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewerIndex, entries, selection, selectedEntries, refresh, selectAll, doTrash, clearSelection])

  /* ---------------- 框选 ---------------- */

  // 在空白处按住左键拖拽出矩形框；以「一次手势」为单位做异或选择 → 连续选择（并集）+ 反选。
  // 查看器打开时让位给它的快捷键。
  const { box: marqueeBox, onMouseDown: onMarqueeDown } = useMarquee(
    scrollRef,
    {
      getBase: () => Array.from(selectionRef.current),
      onResult: (paths) => selectPaths(paths)
    },
    viewerIndex === null
  )

  /* ---------------- 文件夹树（拖拽移动 / 右键菜单） ---------------- */

  // 树结构变动（移动/重命名文件夹）后自增，让侧边栏整棵重建
  const [treeNonce, setTreeNonce] = useState(0)
  const bumpTree = useCallback(() => setTreeNonce((n) => n + 1), [])
  const [folderMenu, setFolderMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)

  const onDropFolderToFolder = useCallback(
    async (srcPath: string, targetPath: string) => {
      if (srcPath === targetPath) return
      await doMove([srcPath], targetPath)
      bumpTree()
    },
    [doMove, bumpTree]
  )

  const onFolderMenu = useCallback(
    (node: { path: string; name: string }, ev: React.MouseEvent) => {
      const isAlbum = folderMeta[node.path]?.view === 'album'
      const items: MenuItem[] = [
        {
          key: 'rename',
          label: t('ctx.rename'),
          icon: <IconEdit size={14} />,
          onClick: async () => {
            const name = await app.prompt({
              title: t('ctx.renameFolderTitle'),
              label: t('ctx.folderNameLabel'),
              initial: node.name,
              confirmText: t('misc.save')
            })
            if (name && name !== node.name) {
              try {
                await api.fs.rename(node.path, name)
                toast(t('ctx.renamed'), 'ok')
                bumpTree()
                refresh()
              } catch (e: any) {
                toast(e.message, 'err')
              }
            }
          }
        },
        {
          key: 'newsub',
          label: t('ctx.newSubfolderTitle'),
          icon: <IconPlus size={14} />,
          onClick: async () => {
            const name = await app.prompt({
              title: t('ctx.newSubfolderTitle'),
              label: t('ctx.folderNameLabel'),
              initial: t('ctx.newFolderInitial'),
              confirmText: t('misc.create')
            })
            if (name) {
              try {
                await api.fs.createFolder(node.path, name)
                toast(t('ctx.folderCreated'), 'ok')
                bumpTree()
              } catch (e: any) {
                toast(e.message, 'err')
              }
            }
          }
        },
        {
          key: 'reveal',
          label: t('misc.revealInExplorer'),
          icon: <IconExternal size={14} />,
          onClick: async () => {
            try {
              await api.fs.reveal(node.path)
            } catch {
              /* 忽略 */
            }
          }
        }
      ]
      if (isAlbum) {
        items.push({
          key: 'unalbum',
          label: t('ctx.unsetAlbum'),
          icon: <IconFolderOpen size={14} />,
          onClick: () => setFolderView(node.path, 'normal')
        })
      } else {
        items.push({
          key: 'album',
          label: t('ctx.setAlbumWindow'),
          icon: <IconFolderOpen size={14} />,
          onClick: () => setFolderView(node.path, 'album')
        })
      }
      items.push({ separator: true })
      items.push({
        key: 'refresh',
        label: t('misc.refresh'),
        icon: <IconRefresh size={14} />,
        onClick: () => {
          refresh()
          bumpTree()
        }
      })
      setFolderMenu({ x: ev.clientX, y: ev.clientY, items })
    },
    [folderMeta, bumpTree, refresh, setFolderView, toast]
  )

  /* ---------------- 渲染内容 ---------------- */

  // 记住每个文件夹的浏览位置：切换走再切回来时不跳回开头
  const scrollMap = useRef<Map<string, number>>(new Map())
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !currentDir) return
    const onScroll = () => {
      if (currentDir) scrollMap.current.set(currentDir, el.scrollTop)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [currentDir])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !currentDir) return
    const restore = () => {
      el.scrollTop = scrollMap.current.get(currentDir) || 0
    }
    restore()
    // 内容异步加载（缩略图/布局）后再次校正，避免被裁到顶部
    const raf = requestAnimationFrame(restore)
    const t = setTimeout(restore, 140)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(t)
    }
  }, [currentDir])

  /* 套图文件夹已在瀑布流里以封面大图出现，此处不再重复；
     但封面还没取到或文件夹为空时仍保留普通卡片，避免它彻底消失、无法取消套图 */
  const normalFolders = folderEntries.filter(
    (e) => folderMeta[e.path]?.view !== 'album' || !albumShown.has(e.path)
  )

  const folderGrid = normalFolders.length > 0 && (
    <>
      <div className="section-head clickable" onClick={() => setShowFolders((s) => !s)}>
        <span>{t('app.folders')}</span>
        <span className="line" />
        <span className="text-dim">{normalFolders.length}</span>
        {showFolders ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
      </div>
      {showFolders && (
        <div
          className="folder-grid"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${Math.min(210, settings.columnWidth)}px, 1fr))` }}
        >
          {normalFolders.map((e) => (
            <FolderCard
              key={e.path}
              entry={e}
              selected={isSelected(e.path)}
              meta={folderMeta[e.path]}
              tagMap={tagMap}
              autoCover={settings.autoCover}
              isDropTarget={dropFolder?.path === e.path}
              onOpen={onOpen}
              onSelect={onSelect}
              onContext={onContext}
              onToggleFav={onToggleFav}
              onTagClick={onTagClick}
              onDragStart={onCardDragStart}
              onDropFiles={onDropFiles}
              onDragOverFolder={onDragOverFolder}
              anySelected={selection.size > 0}
            />
          ))}
        </div>
      )}
    </>
  )

  /* 套图封面与图片按排序穿插在同一瀑布流里（streamEntries = 文件 + 套图封面） */
  const masonry = streamEntries.length > 0 && (
    <MasonryGrid
      entries={streamEntries}
      columnWidth={settings.columnWidth}
      gap={settings.gap}
      scrollRef={scrollRef}
      renderCell={(cell: CellLayout, onDims) => (
        <MediaCard
          key={cell.entry.path}
          cell={cell}
          selected={isSelected(cell.entry.path)}
          meta={itemMeta[cell.entry.path]}
          tagMap={tagMap}
          onDims={onDims}
          hoverPlayGif={settings.hoverPlayGif}
          hoverPlayVideo={settings.hoverPlayVideo}
          hoverPlayJpg={settings.hoverPlayJpg}
          hoverPlayWebp={settings.hoverPlayWebp}
          anySelected={selection.size > 0}
          onOpen={onOpen}
          onSelect={onSelect}
          onContext={onContext}
          onToggleFav={onToggleFav}
          onTagClick={onTagClick}
          onDragStart={onCardDragStart}
        />
      )}
    />
  )

  const isEmpty = !loading && !error && folderEntries.length === 0 && streamEntries.length === 0
  const hasRoots = app.roots.length > 0

  return (
    <div className="app">
      {!viewerBorderless && <TitleBar />}
      <div className="app-body">
        {!sidebarCollapsed && (
          <div className="sidebar-pane" style={{ width: sidebarWidth }}>
            <Sidebar
              onOpenTagManager={() => setTagManagerOpen(true)}
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenPlaylists={() => setPlaylistManagerOpen(true)}
              onDropToFolder={(targetPath, ev) => handleDropFiles(ev, targetPath)}
              onDropFolderToFolder={onDropFolderToFolder}
              onFolderMenu={onFolderMenu}
              treeNonce={treeNonce}
              onCollapse={() => setSidebarCollapsed(true)}
            />
            <div className="sidebar-resizer" onMouseDown={startResizeSidebar} title={t('app.resizeSidebar')} />
          </div>
        )}
        {sidebarCollapsed && (
          <div className="sidebar-rail">
            <button className="btn icon sm" onClick={() => setSidebarCollapsed(false)} title={t('app.expandSidebar')}>
              <IconChevronRight size={15} />
            </button>
          </div>
        )}

        <div className="main-col">
          <Toolbar />
          <div
            className="content"
            ref={scrollRef}
            onMouseDown={onMarqueeDown}
            onDragStartCapture={(e) => {
              // 按住 Shift 时是在框选，别让 HTML5 拖拽插进来
              if (e.shiftKey) e.preventDefault()
            }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes('application/x-watcher-paths') && e.dataTransfer.types.includes('Files')) {
                e.preventDefault()
                setDropActive(true)
              } else if (e.dataTransfer.types.includes('application/x-watcher-paths')) {
                e.preventDefault()
              }
            }}
            onDragLeave={(e) => {
              if (e.target === e.currentTarget) setDropActive(false)
            }}
            onDrop={onContentDrop}
            onClick={(e) => {
              if (e.target === e.currentTarget) clearSelection()
              if ((e.target as HTMLElement)?.classList?.contains('content-inner')) clearSelection()
            }}
          >
            {error && (
              <div className="empty">
                <IconImage size={40} className="big" />
                <div className="t">{t('empty.cannotRead')}</div>
                <div className="d">{error}</div>
                <button className="btn primary" onClick={refresh}><IconRefresh size={14} /> {t('empty.retry')}</button>
              </div>
            )}

            {!error && (
              <div className="content-inner">
                {folderGrid}
                {masonry}

                {isEmpty && (
                  <div className="empty">
                    <IconImage size={40} className="big" />
                    <div className="t">{currentDir ? t('empty.folderEmpty') : t('empty.noLibrary')}</div>
                    <div className="d">
                      {currentDir
                        ? t('empty.folderHint')
                        : t('empty.noLibraryHint')}
                    </div>
                    {!hasRoots && (
                      <button className="btn primary" onClick={addRoot}>
                        <IconPlus size={14} /> {t('app.addLibrary')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {dropActive && currentDir && (
        <div className="dropzone-hint">{t('app.dropHint', { dir: currentDir.split('/').pop() ?? '' })}</div>
      )}

      {marqueeBox && (
        <div
          className="marquee"
          style={{
            left: marqueeBox.left,
            top: marqueeBox.top,
            width: marqueeBox.width,
            height: marqueeBox.height
          }}
        />
      )}

      {selection.size > 0 && (
        <div className="selbar">
          <span>{t('app.selected', { n: selection.size })}</span>
          <span className="divider" />
          <button
            ref={selTagBtnRef}
            className="sb-btn"
            onClick={() => openTag(selectedEntries, null)}
          >
            <IconTag size={14} /> {t('app.tagBtn')}
          </button>
          {(() => {
            const selDirs = selectedEntries.filter((e) => e.isDir)
            if (!selDirs.length) return null
            const allAlbum = selDirs.every((e) => folderMeta[e.path]?.view === 'album')
            return (
              <button
                className="sb-btn"
                onClick={() => setFoldersAlbum(selDirs.map((d) => d.path), allAlbum ? 'normal' : 'album')}
                title={t('app.albumSelTitle')}
              >
                <IconLayers size={14} /> {allAlbum ? t('ctx.unsetAlbum') : t('ctx.setAlbum')}
              </button>
            )
          })()}
          <button
            className="sb-btn"
            onClick={() =>
              setPlaylistPicker({ x: window.innerWidth / 2, y: window.innerHeight - 80, paths: selectedEntries.map((x) => x.path) })
            }
          >
            <IconPlaylist size={14} /> {t('playlist.title')}
          </button>
          <button
            className="sb-btn"
            onClick={async () => {
              const p = await api.fs.pickFolder()
              if (p) doMove(selectedEntries.map((x) => x.path), p)
            }}
          >
            <IconMove size={14} /> {t('app.move')}
          </button>
          <button
            className="sb-btn"
            onClick={async () => {
              const p = await api.fs.pickFolder()
              if (p) doCopy(selectedEntries.map((x) => x.path), p)
            }}
          >
            <IconCopy size={14} /> {t('app.copy')}
          </button>
          <span className="divider" />
          <button
            className="sb-btn danger"
            onClick={() => doTrash(selectedEntries.map((x) => x.path))}
          >
            <IconTrash size={14} /> {t('misc.delete')}
          </button>
          <button className="sb-btn" onClick={clearSelection}>
            <IconX size={14} /> {t('misc.cancel')}
          </button>
        </div>
      )}

      {toasts.length > 0 && (
        <div className="toasts">
          {toasts.map((t) => (
            <div key={t.id} className={'toast ' + (t.type || '')}>{t.text}</div>
          ))}
        </div>
      )}

      {entryMenu && (
        <ContextMenu x={entryMenu.x} y={entryMenu.y} items={entryMenu.items} onClose={() => setEntryMenu(null)} />
      )}

      {folderMenu && (
        <ContextMenu x={folderMenu.x} y={folderMenu.y} items={folderMenu.items} onClose={() => setFolderMenu(null)} />
      )}

      {tagTargets && (
        <TagPicker
          targets={tagTargets}
          x={tagPos.x}
          y={tagPos.y}
          onClose={() => setTagTargets(null)}
          onChanged={() => { /* 标签变更即时同步，无需额外动作 */ }}
        />
      )}

      {tagManagerOpen && <TagManager onClose={() => setTagManagerOpen(false)} />}

      {playlistManagerOpen && <PlaylistManager onClose={() => setPlaylistManagerOpen(false)} />}

      {playlistPicker && (
        <PlaylistPicker
          paths={playlistPicker.paths}
          x={playlistPicker.x}
          y={playlistPicker.y}
          onClose={() => setPlaylistPicker(null)}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          settings={settings}
          patchSettings={patchSettings}
          reloadTags={reloadTags}
          refresh={refresh}
          toast={app.toast}
        />
      )}

      {viewerIndex != null && <Viewer onContext={onContext} />}
    </div>
  )
}

/* ============ 设置弹窗 ============ */

interface SettingsModalProps {
  onClose: () => void
  settings: any
  patchSettings: (p: Record<string, any>) => void
  reloadTags: () => void
  refresh: () => void
  toast: (text: string, type?: 'ok' | 'err' | 'info') => void
}

function SettingsModal({ onClose, settings, patchSettings, reloadTags, refresh, toast }: SettingsModalProps) {
  const SORTS: { k: string; label: string }[] = [
    { k: 'name', label: t('sort.name') },
    { k: 'mtime', label: t('sort.mtime') },
    { k: 'ctime', label: t('sort.ctime') },
    { k: 'size', label: t('sort.size') },
    { k: 'random', label: t('sort.random') }
  ]

  const toggle = (key: string) => patchSettings({ [key]: !settings[key] })

  const onExport = async () => {
    try {
      const data = await api.db.exportData()
      await api.fs.saveJson('watcher-data.json', data)
      toast(t('settings.dataExported'), 'ok')
    } catch (e: any) {
      toast(e.message || t('settings.exportFailed'), 'err')
    }
  }

  const onImport = async () => {
    try {
      const data = await api.fs.openJson()
      if (!data) return
      await api.db.importData(data, true)
      await reloadTags()
      refresh()
      toast(t('settings.dataImported'), 'ok')
    } catch (e: any) {
      toast(e.message || t('settings.importFailed'), 'err')
    }
  }

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width: 460 }}>
        <div className="modal-head">
          <span>{t('misc.settings')}</span>
          <button className="btn icon" onClick={onClose} title={t('misc.close')}><IconX /></button>
        </div>
        <div className="modal-body">
          <div className="ctx-label" style={{ marginTop: 0 }}>{t('settings.appearance')}</div>
          <Row label={t('settings.theme')}>
            <span className="row" style={{ gap: 6 }}>
              <button
                className="btn ghost"
                style={settings.theme === 'light' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
                onClick={() => patchSettings({ theme: 'light' })}
              >
                {t('settings.light')}
              </button>
              <button
                className="btn ghost"
                style={settings.theme === 'dark' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
                onClick={() => patchSettings({ theme: 'dark' })}
              >
                {t('settings.dark')}
              </button>
            </span>
          </Row>
          <Row label={t('settings.accent')}>
            <span className="row" style={{ gap: 8 }}>
              <input
                type="color"
                value={settings.accent}
                onChange={(e) => patchSettings({ accent: e.target.value })}
                style={{ width: 32, height: 28, padding: 2, border: '1px solid var(--border-strong)', borderRadius: 6, background: 'var(--panel)', cursor: 'pointer' }}
              />
              <span style={{ display: 'flex', gap: 5 }}>
                {['#0096fa', '#e05263', '#6fa84f', '#9b5fc0', '#e8a317', '#3f9e8c'].map((c) => (
                  <button
                    key={c}
                    onClick={() => patchSettings({ accent: c })}
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      background: c,
                      border: settings.accent === c ? '2px solid var(--text)' : '2px solid transparent'
                    }}
                  />
                ))}
              </span>
            </span>
          </Row>
          <Row label={t('settings.thumbWidth')}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="range" className="slider" min={140} max={420} step={10}
                value={settings.columnWidth}
                onChange={(e) => patchSettings({ columnWidth: Number(e.target.value) })}
                style={{ width: 150 }}
              />
              <span className="text-dim" style={{ width: 34, textAlign: 'right' }}>{t('misc.px', { n: settings.columnWidth })}</span>
            </span>
          </Row>
          <Row label={t('settings.imageSampling')}>
            <span className="row" style={{ gap: 6 }}>
              <button
                className="btn ghost"
                style={settings.imageSampling === 'smooth' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
                onClick={() => patchSettings({ imageSampling: 'smooth' })}
              >
                {t('settings.bilinear')}
              </button>
              <button
                className="btn ghost"
                style={settings.imageSampling === 'nearest' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
                onClick={() => patchSettings({ imageSampling: 'nearest' })}
                title={t('settings.nearestTitle')}
              >
                {t('settings.nearest')}
              </button>
            </span>
          </Row>
          <Row label={t('settings.cardGap')}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="range" className="slider" min={6} max={28} step={2}
                value={settings.gap}
                onChange={(e) => patchSettings({ gap: Number(e.target.value) })}
                style={{ width: 150 }}
              />
              <span className="text-dim" style={{ width: 34, textAlign: 'right' }}>{t('misc.px', { n: settings.gap })}</span>
            </span>
          </Row>
          <Row label={t('settings.defaultSort')}>
            <span className="row" style={{ gap: 6 }}>
              <select
                value={settings.sortBy}
                onChange={(e) => patchSettings({ sortBy: e.target.value })}
                style={{ height: 30 }}
              >
                {SORTS.map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}
              </select>
              <button className="btn ghost" onClick={() => patchSettings({ sortDir: settings.sortDir === 'asc' ? 'desc' : 'asc' })}>
                {settings.sortDir === 'asc' ? t('sort.asc') : t('sort.desc')}
              </button>
            </span>
          </Row>

          <div className="ctx-label" style={{ marginTop: 14 }}>{t('settings.browse')}</div>
          <Row label={t('view.showFolders')}><Switch on={settings.showFolders} onClick={() => toggle('showFolders')} /></Row>
          <Row label={t('view.folderFirst')}><Switch on={settings.folderFirst} onClick={() => toggle('folderFirst')} /></Row>
          <Row label={t('view.recursive')}><Switch on={settings.recursive} onClick={() => toggle('recursive')} /></Row>
          <Row label={t('view.autoCover')}><Switch on={settings.autoCover} onClick={() => toggle('autoCover')} /></Row>
          <Row label={t('settings.confirmBeforeDelete')}><Switch on={!settings.skipTrashConfirm} onClick={() => toggle('skipTrashConfirm')} /></Row>
          <Row label={t('view.hoverGif')}><Switch on={settings.hoverPlayGif} onClick={() => toggle('hoverPlayGif')} /></Row>
          <Row label={t('view.hoverVideo')}><Switch on={settings.hoverPlayVideo} onClick={() => toggle('hoverPlayVideo')} /></Row>
          <Row label={t('settings.jpgHover')}><Switch on={settings.hoverPlayJpg} onClick={() => toggle('hoverPlayJpg')} /></Row>
          <Row label={t('settings.webpHover')}><Switch on={settings.hoverPlayWebp} onClick={() => toggle('hoverPlayWebp')} /></Row>
          <Row label={t('settings.zoomSensitivity')}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="range" className="slider" min={0.25} max={4} step={0.25}
                value={settings.zoomSensitivity}
                onChange={(e) => patchSettings({ zoomSensitivity: Number(e.target.value) })}
                style={{ width: 150 }}
              />
              <span className="text-dim" style={{ width: 38, textAlign: 'right' }}>{t('misc.x', { n: settings.zoomSensitivity.toFixed(2) })}</span>
            </span>
          </Row>
          <Row label={t('settings.seekStep')}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="range" className="slider" min={1} max={60} step={1}
                value={settings.videoSeek}
                onChange={(e) => patchSettings({ videoSeek: Number(e.target.value) })}
                style={{ width: 150 }}
              />
              <span className="text-dim" style={{ width: 44, textAlign: 'right' }}>{t('misc.seconds', { n: settings.videoSeek })}</span>
            </span>
          </Row>
          <Row label={t('settings.previewHold')}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="range" className="slider" min={300} max={5000} step={100}
                value={settings.videoPreviewHold}
                onChange={(e) => patchSettings({ videoPreviewHold: Number(e.target.value) })}
                style={{ width: 150 }}
              />
              <span className="text-dim" style={{ width: 52, textAlign: 'right' }}>{t('misc.ms', { n: settings.videoPreviewHold })}</span>
            </span>
          </Row>
          <Row label={t('settings.alwaysLoop')}>
            <Switch on={settings.loopAnim} onClick={() => toggle('loopAnim')} />
          </Row>

          <div className="ctx-label" style={{ marginTop: 14 }}>{t('settings.data')}</div>
          <Row label={t('settings.tagsMeta')}>
            <span className="row" style={{ gap: 6 }}>
              <button className="btn sm" onClick={onExport}><IconDatabase size={13} /> {t('settings.export')}</button>
              <button className="btn sm" onClick={onImport}><IconCheck size={13} /> {t('settings.importMerge')}</button>
            </span>
          </Row>
          <div className="text-dim" style={{ fontSize: 11.5, marginTop: 6, lineHeight: 1.6 }}>
            {t('settings.dataNote')}
          </div>
        </div>
      </div>
    </div>
  )
}

/* 这两个组件提到模块作用域，避免每次 patchSettings 触发 SettingsModal 重渲染时
   内联组件被重新创建、滑块 <input> 被卸载重挂，导致拖拽只能走一步 */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ color: 'var(--text-2)' }}>{label}</span>
      <div>{children}</div>
    </div>
  )
}

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 38, height: 22, borderRadius: 12, padding: 2,
        background: on ? 'var(--accent)' : '#cdd1d9', transition: 'background .14s',
        display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start'
      }}
    >
      <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', boxShadow: 'var(--shadow-1)' }} />
    </button>
  )
}

export default App
