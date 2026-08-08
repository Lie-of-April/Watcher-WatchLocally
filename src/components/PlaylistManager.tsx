import React, { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { useApp } from '@/store/AppContext'
import { basename } from '@/lib/utils'
import { IconX, IconPlus, IconEdit, IconTrash, IconPlay, IconChevronUp, IconChevronDown } from './Icons'
import type { Playlist } from '@/types'
import { t } from '@/i18n/strings'

export function PlaylistManager({ onClose }: { onClose: () => void }) {
  const { playlists, loadPlaylists, startPlaylist, confirm, toast } = useApp()
  const [selId, setSelId] = useState<string | null>(playlists[0]?.id ?? null)
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)

  // 打开时拉一次最新数据
  useEffect(() => {
    loadPlaylists().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const active: Playlist | undefined = useMemo(
    () => playlists.find((p) => p.id === selId),
    [playlists, selId]
  )

  const create = async () => {
    const n = newName.trim()
    if (!n || busy) return
    setBusy(true)
    try {
      const pl = await api.db.createPlaylist(n)
      await loadPlaylists()
      setSelId(pl.id)
      setNewName('')
    } catch (e: any) {
      toast(e.message || t('playlist.createFailed'), 'err')
    } finally {
      setBusy(false)
    }
  }

  const saveRename = async () => {
    if (!renaming) return
    const n = renaming.name.trim()
    const g = playlists.find((x) => x.id === renaming.id)
    if (n && n !== g?.name) {
      try {
        await api.db.renamePlaylist(renaming.id, n)
        await loadPlaylists()
      } catch (e: any) {
        toast(e.message || t('playlist.renameFailed'), 'err')
      }
    }
    setRenaming(null)
  }

  const del = async (pl: Playlist) => {
    const ok = await confirm({
      title: t('playlist.deleteTitle'),
      message: (
        <>
          {t('playlist.deleteMsg1')}<b>{pl.name}</b>{t('playlist.deleteMsg2')}{pl.items.length}{t('playlist.deleteMsg3')}
        </>
      ),
      confirmText: t('misc.delete'),
      danger: true
    })
    if (!ok) return
    try {
      await api.db.deletePlaylist(pl.id)
      if (selId === pl.id) setSelId(null)
      await loadPlaylists()
    } catch (e: any) {
      toast(e.message || t('playlist.deleteFailed'), 'err')
    }
  }

  const removeItem = async (index: number) => {
    if (!active) return
    try {
      await api.db.removePlaylistItem(active.id, index)
      await loadPlaylists()
    } catch (e: any) {
      toast(e.message || t('playlist.removeFailed'), 'err')
    }
  }

  const moveItem = async (index: number, dir: -1 | 1) => {
    if (!active) return
    const to = index + dir
    if (to < 0 || to >= active.items.length) return
    try {
      await api.db.reorderPlaylist(active.id, index, to)
      await loadPlaylists()
    } catch (e: any) {
      toast(e.message || t('playlist.reorderFailed'), 'err')
    }
  }

  const clearItems = async () => {
    if (!active) return
    const ok = await confirm({
      title: t('playlist.clearTitle'),
      message: <>{t('playlist.clearMsg1')}<b>{active.name}</b>{t('playlist.clearMsg2')}</>,
      confirmText: t('playlist.clearConfirm'),
      danger: true
    })
    if (!ok) return
    try {
      await api.db.clearPlaylist(active.id)
      await loadPlaylists()
    } catch (e: any) {
      toast(e.message || t('playlist.clearFailed'), 'err')
    }
  }

  const play = () => {
    if (!active) return
    startPlaylist(active.id)
    onClose()
  }

  const left = (
    <div className="pl-list">
      <div className="ctx-label" style={{ marginTop: 0 }}>{t('playlist.title')}</div>
      <div className="pl-scroll">
        {playlists.length === 0 && (
          <div className="text-dim" style={{ padding: '10px 8px', fontSize: 11.5 }}>
            {t('playlist.empty')}
          </div>
        )}
        {playlists.map((pl) =>
          renaming?.id === pl.id ? (
            <div key={pl.id} className="pl-row" style={{ paddingRight: 6 }}>
              <input
                autoFocus
                value={renaming.name}
                onChange={(e) => setRenaming({ id: pl.id, name: e.target.value })}
                onBlur={saveRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveRename()
                  if (e.key === 'Escape') setRenaming(null)
                }}
                style={{ flex: 1, height: 24 }}
              />
            </div>
          ) : (
            <div
              key={pl.id}
              className={'pl-row' + (selId === pl.id ? ' active' : '')}
              onClick={() => setSelId(pl.id)}
            >
              <span className="label">{pl.name}</span>
              <span className="count">{pl.items.length}</span>
              <span
                className="row-act"
                onClick={(e) => {
                  e.stopPropagation()
                  setRenaming({ id: pl.id, name: pl.name })
                }}
              >
                <IconEdit size={13} />
              </span>
              <span
                className="row-act"
                onClick={(e) => {
                  e.stopPropagation()
                  del(pl)
                }}
              >
                <IconTrash size={13} />
              </span>
            </div>
          )
        )}
      </div>
      <div className="row" style={{ marginTop: 8, gap: 6 }}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
          placeholder={t('playlist.newNamePlaceholder')}
          style={{ flex: 1, height: 28 }}
        />
        <button className="btn sm primary" onClick={create} title={t('playlist.newTitle')}>
          <IconPlus size={14} />
        </button>
      </div>
    </div>
  )

  const right = (
    <div className="pl-main">
      {!active ? (
        <div className="empty">
          <IconPlay size={36} className="big" />
          <div className="t">{t('playlist.selectOne')}</div>
          <div className="d">{t('playlist.emptyHint')}</div>
        </div>
      ) : (
        <>
          <div className="pl-main-head">
            <span className="name">{active.name}</span>
            <span className="text-dim" style={{ fontSize: 12 }}>{t('playlist.videoCount', { n: active.items.length })}</span>
            <div className="grow" />
            <button className="btn sm primary" onClick={play} disabled={!active.items.length}>
              <IconPlay size={13} /> {t('playlist.play')}
            </button>
            <button className="btn sm" onClick={clearItems} disabled={!active.items.length}>
              {t('playlist.clearConfirm')}
            </button>
          </div>
          <div className="pl-items">
            {active.items.length === 0 ? (
              <div className="empty" style={{ padding: '50px 20px' }}>
                <div className="t">{t('playlist.listEmpty')}</div>
                <div className="d">{t('playlist.listEmptyHint')}</div>
              </div>
            ) : (
              active.items.map((p, i) => (
                <div key={p} className="pl-item">
                  <span className="idx">{i + 1}</span>
                  <span className="pname" title={p}>{basename(p)}</span>
                  <span className="pacts">
                    <button
                      className="btn icon"
                      title={t('playlist.moveUp')}
                      disabled={i === 0}
                      onClick={() => moveItem(i, -1)}
                    >
                      <IconChevronUp size={14} />
                    </button>
                    <button
                      className="btn icon"
                      title={t('playlist.moveDown')}
                      disabled={i === active.items.length - 1}
                      onClick={() => moveItem(i, 1)}
                    >
                      <IconChevronDown size={14} />
                    </button>
                    <button className="btn icon" title={t('playlist.remove')} onClick={() => removeItem(i)}>
                      <IconX size={14} />
                    </button>
                  </span>
                </div>
              ))
            )}
          </div>
        </>
      )}
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
          <span>{t('playlist.title')}</span>
          <button className="btn icon" onClick={onClose} title={t('misc.close')}>
            <IconX />
          </button>
        </div>
        <div className="modal-body">
          <div className="pl-manager">
            {left}
            {right}
          </div>
        </div>
      </div>
    </div>
  )
}

export default PlaylistManager
