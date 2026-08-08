'use strict'

/**
 * 自定义 media:// 协议。
 * 渲染进程不能直接用 file:// 读任意磁盘文件（会被沙箱与 CSP 拦），
 * 所以这里自建一条流式通道，并手动实现 HTTP Range，
 * 否则视频无法拖动进度条、大文件会一次性灌进内存。
 *
 * URL 形态：media://local/<encodeURIComponent(绝对路径)>
 */

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { Readable } = require('node:stream')
const { protocol } = require('electron')
const { mimeOf } = require('./consts')

const SCHEME = 'media'

function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
        corsEnabled: true
      }
    }
  ])
}

function toMediaUrl(filePath) {
  return `${SCHEME}://local/${encodeURIComponent(String(filePath).replace(/\\/g, '/'))}`
}

function fromMediaUrl(url) {
  try {
    const u = new URL(url)
    let p = decodeURIComponent(u.pathname.replace(/^\//, ''))
    if (!p) return null
    return path.normalize(p)
  } catch {
    return null
  }
}

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim())
  if (!m) return null
  const hasStart = m[1] !== ''
  const hasEnd = m[2] !== ''
  if (!hasStart && !hasEnd) return null
  let start
  let end
  if (hasStart) {
    start = parseInt(m[1], 10)
    end = hasEnd ? parseInt(m[2], 10) : size - 1
  } else {
    // bytes=-500 → 末尾 500 字节
    const suffix = parseInt(m[2], 10)
    start = Math.max(0, size - suffix)
    end = size - 1
  }
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  end = Math.min(end, size - 1)
  if (start > end || start >= size) return null
  return { start, end }
}

function handle() {
  protocol.handle(SCHEME, async (request) => {
    const filePath = fromMediaUrl(request.url)
    if (!filePath) {
      return new Response('Bad Request', { status: 400 })
    }

    let stat
    try {
      stat = await fsp.stat(filePath)
      if (!stat.isFile()) throw new Error('not a file')
    } catch {
      return new Response('Not Found', { status: 404 })
    }

    const mime = mimeOf(path.extname(filePath))
    const rangeHeader = request.headers.get('range') || request.headers.get('Range')

    if (rangeHeader) {
      const range = parseRange(rangeHeader, stat.size)
      if (!range) {
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${stat.size}` }
        })
      }
      const stream = fs.createReadStream(filePath, { start: range.start, end: range.end })
      return new Response(Readable.toWeb(stream), {
        status: 206,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(range.end - range.start + 1),
          'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache'
        }
      })
    }

    const stream = fs.createReadStream(filePath)
    return new Response(Readable.toWeb(stream), {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(stat.size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache'
      }
    })
  })
}

module.exports = { registerScheme, handle, toMediaUrl, fromMediaUrl, SCHEME }
