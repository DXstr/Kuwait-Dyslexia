import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource/noto-naskh-arabic/400.css'
import '@fontsource/noto-naskh-arabic/600.css'
import '@fontsource/noto-naskh-arabic/700.css'
import { AppRoutes } from './App'
import { AuthProvider } from './auth/AuthProvider'
import { startBrowserAuth } from './auth/runtime'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Application root element is missing')

const runtime = startBrowserAuth(import.meta.env)
import.meta.hot?.dispose(() => runtime.dispose())

createRoot(root).render(
  <StrictMode>
    <AuthProvider controller={runtime.controller}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
)
