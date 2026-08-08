import React, { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useApp } from '@/store/AppContext'
import { t } from '@/i18n/strings'
import brandIcon from '@/assets/icon-brand.png'
import {
  IconArrowLeft, IconArrowRight, IconArrowUp, IconRefresh,
  IconWinMin, IconWinMax, IconWinRestore, IconWinClose
} from './Icons'

export function TitleBar() {
  const { goBack, goForward, goUp, refresh, currentDir } = useApp()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    api.win.isMaximized().then(setMaximized).catch(() => {})
    return api.win.onState((s: any) => {
      if (typeof s?.maximized === 'boolean') setMaximized(s.maximized)
    })
  }, [])

  return (
    <div className="titlebar">
      <div className="brand">
        <img className="brand-dot" src={brandIcon} alt={t('titlebar.brand')} draggable={false} />
        <span>{t('titlebar.brand')}</span>
      </div>

      <div className="nav-btns">
        <button className="btn icon" onClick={goBack} title={t('titlebar.back')}>
          <IconArrowLeft size={15} />
        </button>
        <button className="btn icon" onClick={goForward} title={t('titlebar.forward')}>
          <IconArrowRight size={15} />
        </button>
        <button className="btn icon" onClick={goUp} title={t('titlebar.up')} disabled={!currentDir}>
          <IconArrowUp size={15} />
        </button>
        <button className="btn icon" onClick={refresh} title={t('titlebar.refresh')}>
          <IconRefresh size={15} />
        </button>
      </div>

      <div className="spacer" />

      <div className="win-btns">
        <button className="win-btn" onClick={() => api.win.minimize()} title={t('titlebar.minimize')}>
          <IconWinMin />
        </button>
        <button
          className="win-btn"
          onClick={() => api.win.toggleMaximize().then(setMaximized)}
          title={maximized ? t('titlebar.restore') : t('titlebar.maximize')}
        >
          {maximized ? <IconWinRestore /> : <IconWinMax />}
        </button>
        <button className="win-btn close" onClick={() => api.win.close()} title={t('titlebar.close')}>
          <IconWinClose />
        </button>
      </div>
    </div>
  )
}

export default TitleBar
