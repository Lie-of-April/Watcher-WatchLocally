'use strict'

const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.bmp', '.avif', '.jfif', '.jpe', '.ico', '.svg', '.tif', '.tiff'
])
const GIF_EXTS = new Set(['.gif', '.apng'])
const VIDEO_EXTS = new Set([
  '.mp4', '.webm', '.mkv', '.mov', '.avi', '.m4v', '.wmv', '.flv', '.ts', '.mpg', '.mpeg', '.3gp', '.ogv'
])
const AUDIO_EXTS = new Set(['.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.wma'])

/** 浏览器 <video> 原生可播放的容器；其余标记为需外部播放 */
const PLAYABLE_VIDEO_EXTS = new Set(['.mp4', '.webm', '.m4v', '.mov', '.ogv'])

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.jpe': 'image/jpeg',
  '.png': 'image/png',
  '.apng': 'image/apng',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.ts': 'video/mp2t',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.3gp': 'video/3gpp',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.wma': 'audio/x-ms-wma'
}

function kindOf(ext) {
  const e = String(ext || '').toLowerCase()
  if (GIF_EXTS.has(e)) return 'gif'
  if (IMAGE_EXTS.has(e)) return 'image'
  if (VIDEO_EXTS.has(e)) return 'video'
  if (AUDIO_EXTS.has(e)) return 'audio'
  return 'other'
}

function isMediaExt(ext) {
  const k = kindOf(ext)
  return k === 'image' || k === 'gif' || k === 'video'
}

function mimeOf(ext) {
  return MIME[String(ext || '').toLowerCase()] || 'application/octet-stream'
}

module.exports = {
  IMAGE_EXTS,
  GIF_EXTS,
  VIDEO_EXTS,
  AUDIO_EXTS,
  PLAYABLE_VIDEO_EXTS,
  kindOf,
  isMediaExt,
  mimeOf
}
