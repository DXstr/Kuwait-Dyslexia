import { useState } from 'react'
import type { ParentReportCopy } from './types'
import type { ReviewSessionDetail } from '../review/types'
import { useParentReportAccess } from './context'
import { ParentReportRepositoryError } from './types'
import { useI18n } from '../i18n/context'

function isApproved(status: string) {
  return status === 'approved' || status === 'delivered'
}

export function SpecialistReportDraftForm({ detail, onCreated }: { detail: ReviewSessionDetail; onCreated: () => void }) {
  const { t } = useI18n()
  const access = useParentReportAccess()
  const fingerprint = detail.fingerprints.find((row) => isApproved(row.review_status))
  const plan = detail.plans.find((row) => isApproved(row.review_status))
  const [progressNote, setProgressNote] = useState('')
  const [homeTitle, setHomeTitle] = useState('')
  const [homeMinutes, setHomeMinutes] = useState('5')
  const [homeWords, setHomeWords] = useState('')
  const [homeHow, setHomeHow] = useState('')
  const [nextFocus, setNextFocus] = useState('')
  const [specialistName, setSpecialistName] = useState('')
  const [specialistContact, setSpecialistContact] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  if (!access || !fingerprint || !plan) return null

  const submit = async () => {
    if (busy) return
    const skillId = plan.skill_ids[0]
    const copy: ParentReportCopy = {
      progressNotes: progressNote.trim() ? [{ skill_id: skillId, note_ar: progressNote.trim() }] : [],
      homePlan: [{ title_ar: homeTitle.trim(), minutes: Number(homeMinutes), words: homeWords.split('،').map((word) => word.trim()).filter(Boolean), how_ar: homeHow.trim() }],
      nextFocusAr: nextFocus.trim(),
      specialist: { name: specialistName.trim(), contact: specialistContact.trim() },
    }
    setBusy(true)
    setMessage(null)
    try {
      await access.repository.createDraft({ detail, fingerprint, plan }, copy)
      onCreated()
    } catch (error) {
      if (error instanceof ParentReportRepositoryError && error.issue === 'forbidden') setMessage(t('parentReportDraftForbidden'))
      else if (error instanceof ParentReportRepositoryError && error.issue === 'schema') setMessage(t('parentReportDraftInvalid'))
      else setMessage(t('parentReportDraftError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="parent-report-draft-form specialist-card" aria-labelledby="parent-report-draft-title">
      <div>
        <p className="review-kicker">{t('parentReportDraftKicker')}</p>
        <h3 id="parent-report-draft-title">{t('parentReportDraftTitle')}</h3>
        <p className="review-muted">{t('parentReportDraftDescription')}</p>
      </div>
      <div className="parent-report-form-grid">
        <label className="review-note-field"><span>{t('parentReportDraftProgress')}</span><textarea value={progressNote} onChange={(event) => setProgressNote(event.target.value)} /></label>
        <label className="review-note-field"><span>{t('parentReportDraftNextFocus')}</span><textarea value={nextFocus} onChange={(event) => setNextFocus(event.target.value)} /></label>
        <label className="review-note-field"><span>{t('parentReportDraftHomeTitle')}</span><input value={homeTitle} onChange={(event) => setHomeTitle(event.target.value)} /></label>
        <label className="review-note-field"><span>{t('parentReportDraftMinutes')}</span><input type="number" min="5" max="10" step="1" value={homeMinutes} onChange={(event) => setHomeMinutes(event.target.value)} /></label>
        <label className="review-note-field"><span>{t('parentReportDraftWords')}</span><input value={homeWords} onChange={(event) => setHomeWords(event.target.value)} placeholder={t('parentReportDraftWordsPlaceholder')} /></label>
        <label className="review-note-field"><span>{t('parentReportDraftHow')}</span><textarea value={homeHow} onChange={(event) => setHomeHow(event.target.value)} /></label>
        <label className="review-note-field"><span>{t('parentReportDraftSpecialistName')}</span><input value={specialistName} onChange={(event) => setSpecialistName(event.target.value)} /></label>
        <label className="review-note-field"><span>{t('parentReportDraftSpecialistContact')}</span><input dir="ltr" value={specialistContact} onChange={(event) => setSpecialistContact(event.target.value)} /></label>
      </div>
      {message && <p className="professional-notice" role="alert" aria-live="assertive">{message}</p>}
      <button className="action-button review-action--submit" type="button" aria-busy={busy} disabled={busy} onClick={() => { void submit() }}>{t(busy ? 'parentReportDraftSaving' : 'parentReportDraftSave')}</button>
    </section>
  )
}
