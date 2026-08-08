import React, { useEffect, useRef, useState } from 'react'
import { getThumb, peekThumb } from '@/lib/thumbnail'
import { api } from '@/lib/api'
import { isPlayableVideo } from '@/lib/utils'
import { readMediaBytes, parseMultiFrameJpeg, ensureGifLoop } from '@/lib/anim'
import { useApp } from '@/store/AppContext'
import { IconImage, IconVideo, IconPlay } from './Icons'
import { t } from '@/i18n/strings'
import type { Entry } from '@/types'

interface Props {
  entry: Entry
  /** 拿到真实宽高后回调，供瀑布流修正行高 */
  onDims?: (path: string, w: number, h: number) => void
  hoverPlay?: boolean
  hovering?: boolean
  eager?: boolean
}

/**
 * 单张缩略图。
 * 生成走全局队列，这里只管展示三种状态：骨架屏 / 成功 / 失败占位。
 */
export const Thumb = React.memo(function Thumb({
  entry,
  onDims,
  hoverPlay,
  hovering,
  eager
}: Props) {
  const cached = peekThumb(entry)
  const [url, setUrl] = useState<string | null>(cached?.url ?? null)
  const [failed, setFailed] = useState(!!cached?.failed)
  const [loading, setLoading] = useState(!cached)
  const alive = useRef(true)
  const { settings } = useApp()
  const px = settings?.imageSampling === 'nearest' ? ' pixelated' : ''

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    const hit = peekThumb(entry)
    if (hit) {
      setUrl(hit.url)
      setFailed(!!hit.failed)
      setLoading(false)
      if (hit.w && hit.h) onDims?.(entry.path, hit.w, hit.h)
      return
    }
    setLoading(true)
    setFailed(false)
    setUrl(null)
    let cancelled = false
    getThumb(entry).then((r) => {
      if (cancelled || !alive.current) return
      setUrl(r.url)
      setFailed(!!r.failed)
      setLoading(false)
      if (r.w && r.h) onDims?.(entry.path, r.w, r.h)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.path, entry.mtime, entry.size])

  // 悬停预览：GIF 强制循环 / 视频切片跳播 / 多帧 JPEG 动画 / 动图 WebP
  const showLive = hoverPlay && hovering
  const isGif = entry.kind === 'gif'
  const isVideo = entry.kind === 'video'
  const isJpg = entry.kind === 'image' && /\.jpe?g$/i.test(entry.ext)
  const isWebp = entry.kind === 'image' && /\.webp$/i.test(entry.ext)

  if (showLive && isVideo && isPlayableVideo(entry.ext)) {
    return <VideoScrub entry={entry} />
  }
  if (showLive && isGif) {
    return <LiveGif entry={entry} />
  }
  if (showLive && isJpg) {
    return <LiveMjpeg entry={entry} />
  }
  if (showLive && isWebp) {
    return <LiveWebp entry={entry} />
  }

  return (
    <div className="m-thumb">
      {loading && <div className="skeleton" />}
      {!loading && url && (
        <img
          src={url}
          alt=""
          draggable={false}
          loading={eager ? 'eager' : 'lazy'}
          className={px}
          onError={() => setFailed(true)}
        />
      )}
      {!loading && (!url || failed) && (
        <div className="broken">
          {isVideo ? <IconVideo size={26} /> : <IconImage size={26} />}
          <span>{isVideo ? t('thumb.cannotDecode') : t('thumb.cannotPreview')}</span>
        </div>
      )}
    </div>
  )
})

/** 视频悬停预览：保留"只加载元数据"的时长限制，但一段段跳着播，预览更全面 */
function VideoScrub({ entry }: { entry: Entry }) {
  const { settings } = useApp()
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    if (!v) return
    let i = 0
    let cancelled = false
    const hold = settings?.videoPreviewHold || 1500
    const tick = () => {
      if (cancelled || !v.duration || !Number.isFinite(v.duration)) return
      const N = 9
      const seg = ((i % N) / N) * v.duration
      try {
        v.currentTime = seg
      } catch {
        /* 偶发 seek 失败忽略 */
      }
      i++
    }
    v.play().catch(() => {})
    const id = window.setInterval(tick, hold)
    return () => {
      cancelled = true
      clearInterval(id)
      v.pause()
    }
  }, [settings?.videoPreviewHold])
  return (
    <div className="m-thumb">
      <video ref={ref} src={api.mediaUrl(entry.path)} muted loop playsInline preload="metadata" />
    </div>
  )
}

/** GIF 悬停预览：无视文件内嵌的"播放一次"，注入循环扩展始终循环 */
function LiveGif({ entry }: { entry: Entry }) {
  const { settings } = useApp()
  const px = settings?.imageSampling === 'nearest' ? ' pixelated' : ''
  const [src, setSrc] = useState<string>(() => api.mediaUrl(entry.path))
  useEffect(() => {
    let cancelled = false
    let made: string | null = null
    readMediaBytes(api.mediaUrl(entry.path))
      .then((buf) => {
        if (cancelled) return
        const forced = ensureGifLoop(buf)
        if (forced) {
          made = forced
          setSrc(forced)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (made) URL.revokeObjectURL(made)
    }
  }, [entry.path])
  return (
    <div className="m-thumb">
      <img src={src} alt="" draggable={false} className={px} />
    </div>
  )
}

/** 多帧 JPEG 悬停预览：把拼接的多张图逐帧播放，像 GIF 一样动起来 */
function LiveMjpeg({ entry }: { entry: Entry }) {
  const { settings } = useApp()
  const px = settings?.imageSampling === 'nearest' ? ' pixelated' : ''
  const [frames, setFrames] = useState<string[] | null>(null)
  useEffect(() => {
    let cancelled = false
    let urls: string[] = []
    readMediaBytes(api.mediaUrl(entry.path))
      .then((buf) => {
        if (cancelled) return
        const f = parseMultiFrameJpeg(buf)
        if (f && f.length > 1) {
          urls = f
          setFrames(f)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
      urls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [entry.path])
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    if (!frames || frames.length < 2) return
    const t = window.setInterval(() => setIdx((i) => (i + 1) % frames.length), 110)
    return () => clearInterval(t)
  }, [frames])
  return (
    <div className="m-thumb">
      {frames ? (
        <img src={frames[idx]} alt="" draggable={false} className={px} />
      ) : (
        <img src={api.mediaUrl(entry.path)} alt="" draggable={false} className={px} />
      )}
    </div>
  )
}

/** 动图 WebP 悬停预览：浏览器原生支持动画 WebP，直接用原文件 <img> 即可播放 */
function LiveWebp({ entry }: { entry: Entry }) {
  const { settings } = useApp()
  const px = settings?.imageSampling === 'nearest' ? ' pixelated' : ''
  return (
    <div className="m-thumb">
      <img src={api.mediaUrl(entry.path)} alt="" draggable={false} className={px} />
    </div>
  )
}

/** 文件夹封面：路径由外部算好传进来 */
export const CoverImage = React.memo(function CoverImage({
  coverPath,
  manual
}: {
  coverPath: string | null
  manual?: boolean
}) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [coverPath])

  if (!coverPath || broken) {
    return (
      <div className="folder-cover">
        <div className="fallback">
          <IconImage size={30} />
        </div>
      </div>
    )
  }
  return (
    <div className="folder-cover">
      <CoverInner path={coverPath} onBroken={() => setBroken(true)} />
      {manual && <div className="cover-badge">{t('thumb.cover')}</div>}
    </div>
  )
})

function CoverInner({ path, onBroken }: { path: string; onBroken: () => void }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // 封面也走缩略图缓存，避免直接加载几十 MB 的原图
    ;(async () => {
      try {
        const fake: Entry = {
          name: '',
          path,
          isDir: false,
          ext: path.slice(path.lastIndexOf('.')).toLowerCase(),
          kind: /\.(mp4|webm|mkv|mov|avi|m4v|wmv|flv|ts|mpg|mpeg|3gp|ogv)$/i.test(path)
            ? 'video'
            : 'image',
          size: 0,
          mtime: 0,
          ctime: 0
        }
        const r = await getThumb(fake)
        if (cancelled) return
        if (r.url) setUrl(r.url)
        else setUrl(api.mediaUrl(path))
      } catch {
        if (!cancelled) setUrl(api.mediaUrl(path))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [path])

  if (!url) return <div className="skeleton" style={{ position: 'absolute', inset: 0 }} />
  return <img src={url} alt="" draggable={false} onError={onBroken} />
}
