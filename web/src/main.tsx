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
import { ReviewProvider } from './review/ReviewProvider'
import { createReviewRepository } from './review/repository'
import { createLearningMapRepository } from './learning-map/repository'
import { LearningMapProvider } from './learning-map/LearningMapProvider'
import { ParentReportProvider } from './parent-report/ParentReportProvider'
import { createParentReportRepository } from './parent-report/repository'
import { ProbeProvider } from './prove/ProbeProvider'
import { createProbeRuntime } from './prove/runtime'
import { TeachContext } from './teach/context'
import { createTeachRepository } from './teach/repository'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Application root element is missing')

const runtime = startBrowserAuth(import.meta.env)
const scorer = startScorerRuntime(import.meta.env, runtime.controller)
const assessment = createAssessmentRuntime(runtime.client, runtime.controller, scorer.getClient())
const review = { repository: createReviewRepository(runtime.client, runtime.controller), scorer: scorer.getClient() }
const learningMapRepository = createLearningMapRepository(runtime.client, runtime.controller)
const parentReport = { repository: createParentReportRepository(runtime.client, runtime.controller) }
const probe = createProbeRuntime(runtime.client, runtime.controller, scorer.getClient())
const teachRepository = createTeachRepository(runtime.client, runtime.controller)
import.meta.hot?.dispose(() => {
  parentReport.repository.dispose()
  probe.dispose()
  teachRepository.dispose()
  learningMapRepository.dispose()
  review.repository.dispose()
  assessment.dispose()
  scorer.dispose()
  runtime.dispose()
})

createRoot(root).render(
  <StrictMode>
    <AuthProvider controller={runtime.controller}>
      <ScorerProvider runtime={scorer}>
        <AssessmentProvider runtime={assessment}>
          <ReviewProvider access={review}>
            <ProbeProvider runtime={probe}>
              <LearningMapProvider repository={learningMapRepository}>
                <ParentReportProvider access={parentReport}>
                  <TeachContext.Provider value={teachRepository}>
                    <BrowserRouter>
                      <AppRoutes />
                    </BrowserRouter>
                  </TeachContext.Provider>
                </ParentReportProvider>
              </LearningMapProvider>
            </ProbeProvider>
          </ReviewProvider>
        </AssessmentProvider>
      </ScorerProvider>
    </AuthProvider>
  </StrictMode>,
)
