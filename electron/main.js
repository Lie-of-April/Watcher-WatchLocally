'use strict'

const { app, BrowserWindow, shell, nativeTheme } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const mediaProtocol = require('./lib/media-protocol')
const { Store } = require('./lib/store')
const thumbs = require('./lib/thumbs')
const animflag = require('./lib/animflag')
const { createDbApi } = require('./lib/dbapi')
const { registerIpc } = require('./ipc')

const isDev = process.env.NODE_ENV === 'development'
const DEV_URL = 'http://localhost:5199'

// 必须在 app ready 之前声明，否则协议拿不到 stream / fetch 权限
mediaProtocol.registerScheme()

// 单实例：重复启动时聚焦已有窗口，而不是开出第二个库
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let mainWindow = null
let store = null
let db = null

function createWindow() {
  // 自定义应用图标：assets/icon.png 已打进安装包；文件不存在时回退为 exe 内嵌图标（build.icon）
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png')
  const iconOpt = fs.existsSync(iconPath) ? iconPath : undefined
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 940,
    minHeight: 600,
    show: false,
    backgroundColor: '#f5f6f8',
    icon: iconOpt,
    title: 'Watcher',
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  const send = (ch, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ch, payload)
  }
  mainWindow.on('maximize', () => send('window:state', { maximized: true }))
  mainWindow.on('unmaximize', () => send('window:state', { maximized: false }))
  mainWindow.on('enter-full-screen', () => send('window:state', { fullscreen: true }))
  mainWindow.on('leave-full-screen', () => send('window:state', { fullscreen: false }))

  // 外链一律交给系统浏览器，不在应用内开新窗
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    mainWindow.loadURL(DEV_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'light'

  const dataDir = path.join(app.getPath('userData'), 'data')
  store = new Store(dataDir)
  await store.init()
  await thumbs.init(path.join(app.getPath('userData'), 'thumbs'))
  await animflag.init(path.join(app.getPath('userData'), 'thumbs'))
  db = createDbApi(store)

  mediaProtocol.handle()
  registerIpc({ store, db, getWindow: () => mainWindow })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  // 关掉所有辅助窗口（如开发模式下 detach 的 DevTools），否则 window-all-closed 不会触发，
  // 导致 app.quit() 不被调用、进程残留在控制台。
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      try {
        if (w.webContents && w.webContents.isDevToolsOpened()) w.webContents.closeDevTools()
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  try {
    store?.flushSync()
  } catch (e) {
    console.error('[main] 退出前落盘失败:', e)
  }
})

// 兜底：某些情况下（仍有辅助窗口）window-all-closed 不触发，这里确保彻底退出
app.on('will-quit', () => {
  try {
    store?.flushSync()
  } catch { /* ignore */ }
})

process.on('uncaughtException', (err) => {
  console.error('[main] 未捕获异常:', err)
})
