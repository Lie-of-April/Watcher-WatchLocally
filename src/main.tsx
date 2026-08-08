import React from 'react'
import ReactDOM from 'react-dom/client'
import { AppProvider } from '@/store/AppContext'
import { App } from './App'
import '@/styles/global.css'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('未找到 #root 挂载点')

ReactDOM.createRoot(rootEl).render(
  <AppProvider>
    <App />
  </AppProvider>
)
