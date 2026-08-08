import { useEffect, useState } from 'react'
import { api } from './api'
import type { Entry } from '@/types'

/**
 * 「这张图会不会动」的查询层。
 *
 * 判定要读文件头，整目录一次性扫会把几千个文件全读一遍，所以走按需 + 合批：
 * 只有真正渲染出来的卡片（瀑布流已虚拟化，约等于视口附近）才发起查询，
 * 30ms 内的请求合并成一次 IPC，结果按 路径+mtime+size 常驻内存缓存。
 */

const CANDIDATE = /\.(gif|webp|png|apng|jpe?g|jfif)$/i

const cache = new Map<string, boolean>()
const waiting = new Map<string, ((v: boolean) => void)[]>()
let queue: { path: string; mtime: number; size: number; key: string }[] = []
let timer: number | null = null

function keyOf(e: { path: string; mtime: number; size: number }) {
  return `${e.path}|${e.mtime}|${e.size}`
}

function flush() {
  timer = null
  const batch = queue
  queue = []
  if (!batch.length) return
  api.thumb
    .animatedBatch(batch.map((b) => ({ path: b.path, mtime: b.mtime, size: b.size })))
    .then((map) => {
      for (const b of batch) {
        const v = !!(map && map[b.path])
        cache.set(b.key, v)
        waiting.get(b.key)?.forEach((fn) => fn(v))
        waiting.delete(b.key)
      }
    })
    .catch(() => {
      // 失败不写缓存，下次滚回来还有机会重试
      for (const b of batch) {
        waiting.get(b.key)?.forEach((fn) => fn(false))
        waiting.delete(b.key)
      }
    })
}

function query(e: { path: string; mtime: number; size: number }, cb: (v: boolean) => void) {
  const key = keyOf(e)
  const hit = cache.get(key)
  if (hit !== undefined) {
    cb(hit)
    return
  }
  const list = waiting.get(key)
  if (list) {
    list.push(cb)
    return
  }
  waiting.set(key, [cb])
  queue.push({ ...e, key })
  if (timer === null) timer = window.setTimeout(flush, 30)
}

/** 卡片挂载时按需查询自己是不是动图 */
export function useAnimated(entry: Entry): boolean {
  const [animated, setAnimated] = useState(() => cache.get(keyOf(entry)) ?? false)

  useEffect(() => {
    if (entry.isDir || !CANDIDATE.test(entry.ext)) {
      setAnimated(false)
      return
    }
    const hit = cache.get(keyOf(entry))
    if (hit !== undefined) {
      setAnimated(hit)
      return
    }
    let alive = true
    setAnimated(false)
    query(entry, (v) => {
      if (alive) setAnimated(v)
    })
    return () => {
      alive = false
    }
  }, [entry.path, entry.mtime, entry.size, entry.ext, entry.isDir])

  return animated
}

/** 清缓存（清理缩略图缓存时同步调用） */
export function clearAnimatedCache() {
  cache.clear()
}
