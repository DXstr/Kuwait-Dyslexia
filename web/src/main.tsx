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
import { Stage0Provider } from './stage0/Stage0Provider'
import { createStage0Repository } from './stage0/repository'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Application root element is missing')

const runtime = startBrowserAuth(import.meta.env)
const scorer = startScorerRuntime(import.meta.env, runtime.controller)
const assessment = createAssessmentRuntime(runtime.client, runtime.controller, scorer.getClient())
const review = { repository: createReviewRepository(runtime.client, runtime.controller), scorer: scorer.getClient() }
const learningMapRepository = createLearningMapRepository(runtime.client, runtime.controller)
const parentReport = { repository: createParentReportRepository(runtime.client, runtime.controller) }
const stage0Repository = createStage0Repository(runtime.client, runtime.controller)
import.meta.hot?.dispose(() => {
  parentReport.repository.dispose()
  stage0Repository.dispose()
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
            <LearningMapProvider repository={learningMapRepository}>
              <Stage0Provider repository={stage0Repository}>
                <ParentReportProvider access={parentReport}>
                  <BrowserRouter>
                    <AppRoutes />
                  </BrowserRouter>
                </ParentReportProvider>
              </Stage0Provider>
            </LearningMapProvider>
          </ReviewProvider>
        </AssessmentProvider>
      </ScorerProvider>
    </AuthProvider>
  </StrictMode>,
)
