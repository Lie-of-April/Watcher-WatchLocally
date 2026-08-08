import { api } from './api'
import type { Entry } from '@/types'

export interface ThumbResult {
  url: string | null
  w: number
  h: number
  failed?: boolean
}

const THUMB_MAX = 520
const JPEG_QUALITY = 0.82
const VIDEO_TIMEOUT = 9000
const IMAGE_TIMEOUT = 15000

const memCache = new Map<string, ThumbResult>()
const pending = new Map<string, Promise<ThumbResult>>()

function keyOf(e: Entry) {
  return `${e.path}|${Math.round(e.mtime)}|${e.size}`
}

/**
 * 任务队列。
 * 用 LIFO：用户快速滚动时，最新进入视口的图先出结果，
 * 比 FIFO 那种"先把已经划过去的图慢慢渲染完"体验好得多。
 */
class Lane {
  private stack: (() => void)[] = []
  private active = 0
  constructor(private limit: number) {}

  push(job: () => Promise<void>) {
    const run = () => {
      this.active++
      job().finally(() => {
        this.active--
        this.next()
      })
    }
    this.stack.push(run)
    this.next()
  }

  private next() {
    while (this.active < this.limit && this.stack.length) {
      const run = this.stack.pop()!
      run()
    }
  }
}

const imageLane = new Lane(6)
const videoLane = new Lane(2)

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} 超时`)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

function drawToDataUrl(
  source: CanvasImageSource,
  sw: number,
  sh: number
): { dataUrl: string; w: number; h: number } {
  const scale = Math.min(1, THUMB_MAX / Math.max(sw, sh))
  const dw = Math.max(1, Math.round(sw * scale))
  const dh = Math.max(1, Math.round(sh * scale))
  const canvas = document.createElement('canvas')
  canvas.width = dw
  canvas.height = dh
  const ctx = canvas.getContext('2d', { alpha: false })!
  // 透明 PNG 直接转 JPEG 会变黑，先铺白底
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, dw, dh)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, dw, dh)
  return { dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY), w: sw, h: sh }
}

async function makeImageThumb(entry: Entry): Promise<ThumbResult> {
  const url = api.mediaUrl(entry.path)
  const img = new Image()
  img.decoding = 'async'
  img.src = url

  await withTimeout(
    new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('图片解码失败'))
    }),
    IMAGE_TIMEOUT,
    '图片加载'
  )

  const sw = img.naturalWidth || img.width
  const sh = img.naturalHeight || img.height
  if (!sw || !sh) throw new Error('无法获取图片尺寸')

  const { dataUrl } = drawToDataUrl(img, sw, sh)
  const saved = await api.thumb.save(entry.path, entry.mtime, entry.size, dataUrl, sw, sh)
  return { url: api.mediaUrl(saved.file!), w: sw, h: sh }
}

async function makeVideoThumb(entry: Entry): Promise<ThumbResult> {
  const url = api.mediaUrl(entry.path)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.crossOrigin = 'anonymous'
  video.src = url

  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve()
        video.onerror = () => reject(new Error('视频格式不支持解码'))
      }),
      VIDEO_TIMEOUT,
      '视频元信息'
    )

    const sw = video.videoWidth
    const sh = video.videoHeight
    if (!sw || !sh) throw new Error('无法获取视频尺寸')

    // 开头常是黑帧或台标，往后挪一点更有代表性
    const target = Math.min(
      Math.max(0.1, (video.duration || 10) * 0.08),
      Math.max(0.1, (video.duration || 10) - 0.1)
    )

    await withTimeout(
      new Promise<void>((resolve, reject) => {
        let done = false
        video.onseeked = () => {
          if (done) return
          done = true
          resolve()
        }
        video.onerror = () => reject(new Error('视频跳转失败'))
        try {
          video.currentTime = Number.isFinite(target) ? target : 0
        } catch {
          resolve()
        }
      }),
      VIDEO_TIMEOUT,
      '视频抽帧'
    )

    const { dataUrl } = drawToDataUrl(video, sw, sh)
    const saved = await api.thumb.save(entry.path, entry.mtime, entry.size, dataUrl, sw, sh)
    return { url: api.mediaUrl(saved.file!), w: sw, h: sh }
  } finally {
    video.removeAttribute('src')
    video.load()
  }
}

export function peekThumb(entry: Entry): ThumbResult | undefined {
  return memCache.get(keyOf(entry))
}

export async function getThumb(entry: Entry): Promise<ThumbResult> {
  const key = keyOf(entry)
  const cached = memCache.get(key)
  if (cached) return cached
  const inflight = pending.get(key)
  if (inflight) return inflight

  const task = (async (): Promise<ThumbResult> => {
    // 先问磁盘缓存，命中就完全不用解码
    try {
      const hit = await api.thumb.get(entry.path, entry.mtime, entry.size)
      if (hit && hit.file) {
        const r = { url: api.mediaUrl(hit.file), w: hit.w, h: hit.h }
        memCache.set(key, r)
        return r
      }
    } catch {
      /* 缓存不可用不影响后续生成 */
    }

    const isVideo = entry.kind === 'video'
    const lane = isVideo ? videoLane : imageLane

    return new Promise<ThumbResult>((resolve) => {
      lane.push(async () => {
        let result: ThumbResult
        try {
          result = isVideo ? await makeVideoThumb(entry) : await makeImageThumb(entry)
        } catch (e) {
          result = { url: null, w: 0, h: 0, failed: true }
        }
        memCache.set(key, result)
        resolve(result)
      })
    })
  })()

  pending.set(key, task)
  try {
    return await task
  } finally {
    pending.delete(key)
  }
}

export function clearThumbMemCache() {
  memCache.clear()
  pending.clear()
}

/** 布局用的宽高比；未知时给个偏竖的默认值，最接近常见插画比例 */
export function aspectOf(entry: Entry, fallback = 0.75): number {
  const t = memCache.get(keyOf(entry))
  if (t && t.w && t.h) return t.w / t.h
  return fallback
}
