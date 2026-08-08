import type { Entry, Settings } from '@/types'
import { t } from '@/i18n/strings'

export function formatSize(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`
}

export function formatDate(ms: number): string {
  if (!ms) return '-'
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const s = Math.floor(sec % 60)
  const m = Math.floor((sec / 60) % 60)
  const h = Math.floor(sec / 3600)
  const p = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`
}

export function basename(p: string): string {
  if (!p) return ''
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || p
}

export function dirname(p: string): string {
  const s = p.replace(/\\/g, '/')
  const i = s.lastIndexOf('/')
  if (i <= 0) return s
  return s.slice(0, i)
}

export function stripExt(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}

/** 稳定的伪随机：同一路径每次得到同样的序号，避免"随机排序"每次重排晃眼 */
function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

export function sortEntries(entries: Entry[], settings: Settings): Entry[] {
  const { sortBy, sortDir, folderFirst } = settings
  const dir = sortDir === 'desc' ? -1 : 1
  const arr = [...entries]
  arr.sort((a, b) => {
    if (folderFirst && a.isDir !== b.isDir) return a.isDir ? -1 : 1
    let r = 0
    switch (sortBy) {
      case 'mtime':
        r = a.mtime - b.mtime
        break
      case 'ctime':
        r = a.ctime - b.ctime
        break
      case 'size':
        r = a.size - b.size
        break
      case 'random':
        r = hashCode(a.path) - hashCode(b.path)
        break
      case 'rating':
        r = (a.rating || 0) - (b.rating || 0)
        break
      default:
        r = collator.compare(a.name, b.name)
    }
    if (r === 0) r = collator.compare(a.name, b.name)
    return r * dir
  })
  return arr
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number) {
  let t: any
  return (...args: Parameters<T>) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}

/** 浏览器 <video> 能直接播的容器；其它交给外部播放器 */
const PLAYABLE = new Set(['.mp4', '.webm', '.m4v', '.mov', '.ogv'])
export function isPlayableVideo(ext: string): boolean {
  return PLAYABLE.has(String(ext).toLowerCase())
}

export function kindLabel(kind: string): string {
  return (
    {
      image: t('misc.kindImage'),
      gif: t('misc.kindGif'),
      video: t('misc.kindVideo'),
      dir: t('misc.kindFolder'),
      audio: t('misc.kindAudio'),
      other: t('misc.kindOther')
    } as any
  )[kind] || kind
}

/** 仅由扩展名推断媒体种类（用于播放列表等只持有路径的场景） */
export function kindFromExt(ext: string): 'image' | 'gif' | 'video' | 'other' {
  const e = String(ext || '').toLowerCase()
  if (e === '.gif') return 'gif'
  if (isPlayableVideo(e)) return 'video'
  if (['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.avif', '.tiff', '.tif', '.heic', '.heif'].includes(e))
    return 'image'
  if (['.mp4', '.webm', '.m4v', '.mov', '.ogv', '.mkv', '.avi', '.flv', '.ts', '.mpg', '.mpeg', '.3gp', '.wmv'].includes(e))
    return 'video'
  return 'other'
}
