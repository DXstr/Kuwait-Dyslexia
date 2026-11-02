import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource/noto-naskh-arabic/400.css'
import '@fontsource/noto-naskh-arabic/600.css'
import '@fontsource/noto-naskh-arabic/700.css'
import { AppRoutes } from './App'
import { AuthProvider } from './auth/AuthProvider'
import { startBrowserAuth } from './auth/runtime'
import { ScorerProvider } from './scorer/ScorerProvider'
import { startScorerRuntime } from './scorer/runtime'
import { AssessmentProvider } from './assessment/AssessmentProvider'
import { createAssessmentRuntime } from './assessment/runtime'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Application root element is missing')

const runtime = startBrowserAuth(import.meta.env)
const scorer = startScorerRuntime(import.meta.env, runtime.controller)
const assessment = createAssessmentRuntime(runtime.client, runtime.controller, scorer.getClient())
import.meta.hot?.dispose(() => { assessment.dispose(); scorer.dispose(); runtime.dispose() })

createRoot(root).render(
  <StrictMode>
    <AuthProvider controller={runtime.controller}>
      <ScorerProvider runtime={scorer}>
        <AssessmentProvider runtime={assessment}>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </AssessmentProvider>
      </ScorerProvider>
    </AuthProvider>
  </StrictMode>,
)
