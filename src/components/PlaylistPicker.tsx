import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useApp } from '@/store/AppContext'
import { api } from '@/lib/api'
import { IconPlus, IconCheck } from './Icons'
import { t } from '@/i18n/strings'

interface Props {
  paths: string[]
  x: number
  y: number
  onClose: () => void
}

export function PlaylistPicker({ paths, x, y, onClose }: Props) {
  const { playlists, loadPlaylists, addToPlaylist, toast } = useApp()
  const [pos, setPos] = useState({ left: x, top: y })
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadPlaylists().catch(() => {})
  }, [loadPlaylists])

  // 边界翻转
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const m = 8
    let left = x
    if (left + w > window.innerWidth - m) left = x - w
    if (left < m) left = m
    let top = y
    if (top + h > window.innerHeight - m) top = y - h
    if (top < m) top = m
    setPos({ left, top })
  }, [x, y, playlists, creating])

  useEffect(() => {
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

  useEffect(() => {
    if (creating) inputRef.current?.focus()
  }, [creating])

  const addTo = async (id: string) => {
    try {
      await addToPlaylist(id, paths)
      onClose()
    } catch (e: any) {
      toast(e.message || t('playlist.addFailed'), 'err')
    }
  }

  const createAndAdd = async () => {
    const n = newName.trim()
    if (!n) return
    try {
      const pl = await api.db.createPlaylist(n)
      await loadPlaylists()
      setCreating(false)
      setNewName('')
      await addToPlaylist(pl.id, paths)
    } catch (e: any) {
      toast(e.message || t('playlist.createFailed'), 'err')
    }
  }

  return (
    <div ref={ref} className="ctx-menu" style={{ left: pos.left, top: pos.top, minWidth: 210 }}>
      <div className="ctx-label">{t('playlist.addTitle', { n: paths.length })}</div>
      {playlists.length === 0 && !creating && (
        <div className="ctx-label" style={{ textTransform: 'none', fontWeight: 500 }}>
          {t('playlist.empty')}
        </div>
      )}
      {playlists.map((pl) => (
        <div key={pl.id} className="ctx-item" onClick={() => addTo(pl.id)}>
          <IconCheck size={14} style={{ opacity: 0 }} />
          <span className="label" style={{ flex: 1 }}>{pl.name}</span>
          <span className="text-dim" style={{ fontSize: 11 }}>{pl.items.length}</span>
        </div>
      ))}
      {creating ? (
        <div style={{ padding: '5px 6px' }}>
          <input
            ref={inputRef}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') createAndAdd()
              if (e.key === 'Escape') setCreating(false)
            }}
            placeholder={t('playlist.namePlaceholder')}
            style={{ width: '100%', height: 28 }}
          />
        </div>
      ) : (
        <div className="ctx-item" onClick={() => setCreating(true)} style={{ color: 'var(--accent)' }}>
          <IconPlus size={14} />
          <span>{t('playlist.newAndAdd')}</span>
        </div>
      )}
    </div>
  )
}

export default PlaylistPicker
