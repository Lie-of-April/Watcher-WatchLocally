/**
 * 动图相关纯前端解析工具（零原生依赖）。
 * - parseMultiFrameJpeg：把"多图序列 JPEG"（多个 JPEG 拼接而成）拆成逐帧 blob URL，像 GIF 一样播放。
 * - ensureGifLoop：给没有循环扩展的 GIF 注入 NETSCAPE2.0 循环扩展（loop=0 = 无限），
 *   从而无视文件里"播放一次"的信息，始终循环。
 */

const SOI = [0xff, 0xd8, 0xff]
const EOI = [0xff, 0xd9]

function findAll(hay: Uint8Array, needle: number[]): number[] {
  const out: number[] = []
  let i = 0
  const n = hay.length
  const last = n - needle.length
  while (i <= last) {
    let ok = true
    for (let k = 0; k < needle.length; k++) {
      if (hay[i + k] !== needle[k]) {
        ok = false
        break
      }
    }
    if (ok) {
      out.push(i)
      i += needle.length
    } else {
      i++
    }
  }
  return out
}

/**
 * 扫描拼接式多帧 JPEG。
 * 注意：EXIF 缩略图内部也含一个 FFD8FF，但它紧跟在首个 SOI 之后且很小，
 * 真正的"多帧"第二帧通常隔了几十 KB 以上，所以用 50KB 阈值把缩略图误判挡掉。
 */
export function parseMultiFrameJpeg(buf: ArrayBuffer): string[] | null {
  const bytes = new Uint8Array(buf)
  if (bytes.length < 64) return null
  // 必须以 JPEG SOI 开头
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) return null
  // 必须以 EOI 结尾
  if (!(bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9)) return null

  const sois = findAll(bytes, SOI)
  if (sois.length < 2) return null
  // 第二帧离首帧太近 → 基本是 EXIF 缩略图，不当作多帧
  if (sois[1] - sois[0] < 50000) return null

  const urls: string[] = []
  for (let i = 0; i < sois.length; i++) {
    const start = sois[i]
    // 后续帧的结束 = 下一个 SOI 之前（截到前一个 EOI），最后一帧截到文件末尾
    let end = i + 1 < sois.length ? sois[i + 1] : bytes.length
    // 若 end 不是 EOI，向前找最近的 EOI
    if (!(bytes[end - 2] === 0xff && bytes[end - 1] === 0xd9)) {
      const eoi = findAll(bytes.subarray(start, end), EOI)
      if (eoi.length) end = start + eoi[eoi.length - 1] + 2
    }
    if (end - start < 100) continue
    const frame = bytes.subarray(start, end)
    urls.push(URL.createObjectURL(new Blob([frame], { type: 'image/jpeg' })))
    if (urls.length >= 240) break
  }
  return urls.length >= 2 ? urls : null
}

/** 判断 GIF 是否已有 NETSCAPE 循环扩展 */
function hasLoopExt(bytes: Uint8Array): boolean {
  const sig = [0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30] // NETSCAPE2.0
  for (let i = 0; i + 12 < bytes.length; i++) {
    if (bytes[i] === 0x21 && bytes[i + 1] === 0xff && bytes[i + 2] === 0x0b) {
      let ok = true
      for (let k = 0; k < sig.length; k++) {
        if (bytes[i + 3 + k] !== sig[k]) {
          ok = false
          break
        }
      }
      if (ok) return true
    }
  }
  return false
}

/**
 * 给 GIF 注入无限循环扩展。返回新的 blob URL；若本来就带循环扩展返回 null（直接用原文件）。
 */
export function ensureGifLoop(buf: ArrayBuffer): string | null {
  const bytes = new Uint8Array(buf)
  if (bytes.length < 13) return null
  const head = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5])
  if (head !== 'GIF87a' && head !== 'GIF89a') return null
  if (hasLoopExt(bytes)) return null

  const packed = bytes[10]
  const gctFlag = (packed & 0x80) !== 0
  const gctSize = gctFlag ? 2 << (packed & 0x07) : 0
  const insertAt = 13 + gctSize * 3
  if (insertAt >= bytes.length) return null

  // NETSCAPE2.0 循环扩展（loop count = 0 → 无限）
  const ext = new Uint8Array([
    0x21, 0xff, 0x0b,
    0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30,
    0x03, 0x01, 0x00, 0x00,
    0x00
  ])

  const out = new Uint8Array(bytes.length + ext.length)
  out.set(bytes.subarray(0, insertAt), 0)
  out.set(ext, insertAt)
  out.set(bytes.subarray(insertAt), insertAt + ext.length)
  return URL.createObjectURL(new Blob([out], { type: 'image/gif' }))
}

/** 读取媒体文件字节（经自定义 media:// 协议） */
export async function readMediaBytes(mediaUrl: string): Promise<ArrayBuffer> {
  const res = await fetch(mediaUrl)
  if (!res.ok) throw new Error('无法读取文件字节')
  return res.arrayBuffer()
}
