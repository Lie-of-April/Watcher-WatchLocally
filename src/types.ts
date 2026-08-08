export type Kind = 'image' | 'gif' | 'video' | 'audio' | 'dir' | 'other'

export interface Entry {
  name: string
  path: string
  isDir: boolean
  ext: string
  kind: Kind
  size: number
  mtime: number
  ctime: number
  /** 套图（album）封面项：标记该 Entry 来自某个被设为"套图"的子文件夹，点击应打开套图浏览 */
  albumPath?: string
  /** 套图内媒体数量（仅封面项有） */
  albumCount?: number
  /** 评分（0 = 未评分，1–5 星） */
  rating?: number
}

export interface SubDir {
  name: string
  path: string
  isDir: true
  hasChild: boolean
  /** 文件夹修改时间（ms），用于侧边栏按修改时间排序 */
  mtime?: number
}

export interface Tag {
  id: string
  name: string
  color: string
  groupId: string | null
  createdAt: number
  count?: number
}

export interface TagGroup {
  id: string
  name: string
  color: string
  order: number
}

export interface ItemMeta {
  path: string
  tags: string[]
  favorite?: boolean
  rating?: number
  note?: string
  updatedAt: number
}

export interface FolderMeta extends ItemMeta {
  cover?: string | null
  coverMode?: 'manual' | 'auto'
  /** 呈现方式：normal=普通文件夹；album=套图（以大图封面出现在瀑布流，点进去独立看图） */
  view?: 'normal' | 'album'
  /** 套图封面与内部排序方式，默认 name */
  albumSort?: 'name' | 'mtime' | 'ctime' | 'size' | 'random'
}

export interface LibraryRoot {
  id: string
  path: string
  name: string
  addedAt: number
}

export interface Settings {
  columnWidth: number
  gap: number
  sortBy: 'name' | 'mtime' | 'size' | 'ctime' | 'random' | 'rating'
  sortDir: 'asc' | 'desc'
  showFolders: boolean
  folderFirst: boolean
  autoCover: boolean
  hoverPlayGif: boolean
  hoverPlayVideo: boolean
  recursive: boolean
  zoomSensitivity: number
  lastDir: string | null
  theme: 'light' | 'dark'
  accent: string
  /** 始终循环播放 GIF / 动图（忽略文件内嵌的"播放一次"信息） */
  loopAnim: boolean
  /** 视频快进/快退步长（秒），左右方向键使用 */
  videoSeek: number
  /** 图像采样方法：smooth=双线性（默认，适合照片）；nearest=最近邻硬边缘（适合像素画） */
  imageSampling: 'smooth' | 'nearest'
  /** 多帧 JPEG（拼接式动图）悬停播放 */
  hoverPlayJpg: boolean
  /** 动图 WebP 悬停播放 */
  hoverPlayWebp: boolean
  /** 视频悬停预览：每帧采样停留时长（毫秒） */
  videoPreviewHold: number
  /** 每个文件夹独立记住的排序方式（key=文件夹路径）。有覆盖时优先用覆盖值，否则回退到下面的全局默认。
   *  这样切换文件夹不会互相"继承"排序，而是各自记住上次的选择。 */
  folderSort: Record<string, { sortBy: 'name' | 'mtime' | 'size' | 'ctime' | 'random' | 'rating'; sortDir: 'asc' | 'desc' }>
  /** 每个套图独立记住的阅读模式（key=套图文件夹路径）：horizontal=横向翻页，manga=纵向无缝滚动（漫画式）。缺省按 'horizontal' 处理 */
  albumReadMode: Record<string, 'horizontal' | 'manga'>
  /** 每个套图在漫画模式下记住的阅读进度（key=套图文件夹路径，值为当前页码下标）。下次以漫画模式打开时自动恢复 */
  albumProgress: Record<string, number>
  /** 删除时不再弹出"移到回收站"确认框（勾选"以后不再提示"后开启） */
  skipTrashConfirm: boolean
}

export interface SearchOpts {
  query?: string
  tagIds?: string[]
  tagMode?: 'and' | 'or' | 'not'
  untaggedOnly?: boolean
  kinds?: Kind[]
  scopeDir?: string | null
  favoriteOnly?: boolean
  minRating?: number
  includeFolders?: boolean
  limit?: number
}

export interface ThumbInfo {
  file: string | null
  w: number
  h: number
}

export interface Playlist {
  id: string
  name: string
  items: string[]
  createdAt: number
  updatedAt: number
}
