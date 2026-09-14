import React from 'react'

interface P {
  size?: number
  className?: string
  strokeWidth?: number
  style?: React.CSSProperties
}

const base = (size: number, sw: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: sw,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
})

const mk =
  (path: React.ReactNode, defaultSize = 16) =>
  ({ size = defaultSize, className, strokeWidth = 1.8, style }: P) =>
    (
      <svg {...base(size, strokeWidth)} className={className} style={style}>
        {path}
      </svg>
    )

export const IconFolder = mk(
  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
)
export const IconFolderOpen = mk(
  <>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1" />
    <path d="M3 9h18l-2.2 8.4A2 2 0 0 1 16.9 19H5.4a2 2 0 0 1-1.9-1.4z" />
  </>
)
export const IconImage = mk(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.6" />
    <path d="m21 15-4.5-4.5L7 20" />
  </>
)
export const IconVideo = mk(
  <>
    <rect x="2.5" y="5" width="14" height="14" rx="2" />
    <path d="m16.5 10 5-3v10l-5-3z" />
  </>
)
export const IconPlay = mk(<path d="M7 4.5v15l12-7.5z" />)
export const IconPause = mk(
  <>
    <rect x="7" y="5" width="3.5" height="14" rx="1" />
    <rect x="13.5" y="5" width="3.5" height="14" rx="1" />
  </>
)
export const IconSearch = mk(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>
)
export const IconX = mk(<path d="M18 6 6 18M6 6l12 12" />)
export const IconPlus = mk(<path d="M12 5v14M5 12h14" />)
export const IconMinus = mk(<path d="M5 12h14" />)
export const IconCheck = mk(<path d="m20 6-11 11-5-5" />)
export const IconChevronRight = mk(<path d="m9 5 7 7-7 7" />)
export const IconChevronLeft = mk(<path d="m15 5-7 7 7 7" />)
export const IconChevronDown = mk(<path d="m5 9 7 7 7-7" />)
export const IconChevronUp = mk(<path d="m5 15 7-7 7 7" />)
export const IconArrowLeft = mk(<path d="M19 12H5m0 0 6-6m-6 6 6 6" />)
export const IconArrowRight = mk(<path d="M5 12h14m0 0-6-6m6 6-6 6" />)
export const IconArrowUp = mk(<path d="M12 19V5m0 0-6 6m6-6 6 6" />)
export const IconTag = mk(
  <>
    <path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9z" />
    <circle cx="7.5" cy="7.5" r="1.3" />
  </>
)
export const IconTags = mk(
  <>
    <path d="M2 11V6a2 2 0 0 1 2-2h5l8 8-7 7z" />
    <path d="m13 4 8 8-4.5 4.5" />
  </>
)
export const IconTrash = mk(
  <>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7" />
    <path d="M10 11v6M14 11v6" />
  </>
)
export const IconEdit = mk(
  <>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </>
)
export const IconMove = mk(
  <>
    <path d="M5 9V6a1 1 0 0 1 1-1h3" />
    <path d="M9 21H6a1 1 0 0 1-1-1v-3" />
    <rect x="10" y="10" width="11" height="11" rx="2" />
  </>
)
export const IconCopy = mk(
  <>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </>
)
export const IconStar = mk(<path d="m12 3 2.7 5.7 6.3.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.3-.9z" />)
export const IconHeart = mk(
  <path d="M12 20s-7.5-4.6-7.5-9.5A4.5 4.5 0 0 1 12 7.6a4.5 4.5 0 0 1 7.5 2.9C19.5 15.4 12 20 12 20z" />
)
export const IconInfo = mk(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-4M12 8h.01" />
  </>
)
export const IconSettings = mk(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
  </>
)
export const IconRefresh = mk(
  <>
    <path d="M21 12a9 9 0 1 1-2.6-6.4" />
    <path d="M21 3v6h-6" />
  </>
)
export const IconExternal = mk(
  <>
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </>
)
export const IconGrid = mk(
  <>
    <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
  </>
)
export const IconSort = mk(
  <>
    <path d="M7 4v16m0 0-3.5-3.5M7 20l3.5-3.5" />
    <path d="M14 7h7M14 12h5M14 17h3" />
  </>
)
export const IconFilter = mk(<path d="M3 5h18l-7 8v6l-4 2v-8z" />)
export const IconZoomIn = mk(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5M11 8v6M8 11h6" />
  </>
)
export const IconZoomOut = mk(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5M8 11h6" />
  </>
)
export const IconMaximize = mk(
  <>
    <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3" />
  </>
)
export const IconEye = mk(
  <>
    <path d="M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </>
)
export const IconLayers = mk(
  <>
    <path d="m12 3 9 5-9 5-9-5z" />
    <path d="m3 13 9 5 9-5" />
  </>
)
export const IconDatabase = mk(
  <>
    <ellipse cx="12" cy="6" rx="8" ry="3" />
    <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
    <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
  </>
)
export const IconHome = mk(
  <>
    <path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M9 21v-7h6v7" />
  </>
)
export const IconMore = mk(
  <>
    <circle cx="12" cy="5" r="1.4" fill="currentColor" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    <circle cx="12" cy="19" r="1.4" fill="currentColor" />
  </>
)
export const IconWinMin = ({ size = 10 }: P) => (
  <svg width={size} height={size} viewBox="0 0 10 10">
    <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
  </svg>
)
export const IconWinMax = ({ size = 10 }: P) => (
  <svg width={size} height={size} viewBox="0 0 10 10">
    <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" />
  </svg>
)
export const IconWinRestore = ({ size = 10 }: P) => (
  <svg width={size} height={size} viewBox="0 0 10 10">
    <rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" />
    <path d="M2.5 2.5V0.5h7v7h-2" fill="none" stroke="currentColor" />
  </svg>
)
export const IconWinClose = ({ size = 10 }: P) => (
  <svg width={size} height={size} viewBox="0 0 10 10">
    <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" stroke="currentColor" strokeWidth="1.1" />
  </svg>
)
export const IconPicture = mk(
  <>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="8" cy="10" r="1.5" />
    <path d="m21 16-5-5-9 8" />
  </>
)
export const IconFolderPlus = mk(
  <>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M12 11v6M9 14h6" />
  </>
)
export const IconScan = mk(
  <>
    <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
    <path d="M3 12h18" />
  </>
)
export const IconLoader = ({ size = 16, className }: P) => (
  <svg {...base(size, 2)} className={className}>
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
  </svg>
)
export const IconPlaylist = mk(
  <>
    <path d="M4 6h11M4 12h11M4 18h7" />
    <path d="M18 14v6M18 20a2 2 0 1 0 2-2" />
    <circle cx="20" cy="16" r="0.1" />
  </>
)
export const IconQueue = mk(
  <>
    <path d="M4 7h13M4 12h13M4 17h9" />
    <path d="M19 9v9M19 18a2 2 0 1 0 2-2" />
  </>
)
export const IconBorderless = mk(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18" />
  </>
)
