import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../auth/context'
import { useI18n } from '../i18n/context'
import { useAssessment } from '../assessment/context'

const GRADES = [1, 2, 3, 4, 5, 6] as const
const DIALECTS = [
  { id: 'kw', label: 'dialectKuwaiti' },
  { id: 'msa', label: 'dialectMsa' },
] as const

export function AddChildPanel() {
  const { t } = useI18n()
  const { controller } = useAuth()
  const assessment = useAssessment()
  const repository = assessment?.runtime.repository
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [grade, setGrade] = useState<number>(1)
  const [birthMonth, setBirthMonth] = useState('')
  const [dialectLexiconId, setDialectLexiconId] = useState<'kw' | 'msa'>('kw')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  if (!repository) return null

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const identity = controller.getVerifiedSession()
    if (!identity || identity.role !== 'specialist' || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const guardianId = await repository.findGuardianByEmail(email.trim())
      if (!guardianId) {
        setNotice({ kind: 'error', text: t('addChildGuardianNotFound') })
        return
      }
      await repository.createChildForGuardian({
        firstName: firstName.trim(),
        grade,
        birthMonth,
        dialectLexiconId,
        guardianId,
        specialistId: identity.id,
      })
      setNotice({ kind: 'success', text: t('addChildSuccess') })
      setEmail('')
      setFirstName('')
      setBirthMonth('')
      setGrade(1)
      setDialectLexiconId('kw')
    } catch {
      setNotice({ kind: 'error', text: t('addChildError') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="add-child-panel" aria-labelledby="add-child-title">
      <h2 id="add-child-title">{t('addChildTitle')}</h2>
      <p className="lead">{t('addChildDescription')}</p>
      <form className="add-child-form" onSubmit={(event) => { void submit(event) }}>
        <label className="assessment-field" htmlFor="add-child-email">
          <span>{t('addChildGuardianEmailLabel')}</span>
          <input id="add-child-email" type="email" required value={email} placeholder={t('addChildGuardianEmailPlaceholder')} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="assessment-field" htmlFor="add-child-name">
          <span>{t('addChildNameLabel')}</span>
          <input id="add-child-name" required maxLength={100} value={firstName} onChange={(event) => setFirstName(event.target.value)} />
        </label>
        <label className="assessment-field" htmlFor="add-child-grade">
          <span>{t('addChildGradeLabel')}</span>
          <select id="add-child-grade" value={grade} onChange={(event) => setGrade(Number(event.target.value))}>
            {GRADES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="assessment-field" htmlFor="add-child-birth-month">
          <span>{t('addChildBirthMonthLabel')}</span>
          <input id="add-child-birth-month" type="month" required value={birthMonth} max={new Date().toISOString().slice(0, 7)} onChange={(event) => setBirthMonth(event.target.value)} />
        </label>
        <fieldset className="assessment-field" id="add-child-dialect">
          <legend>{t('addChildDialectLabel')}</legend>
          {DIALECTS.map((option) => (
            <label key={option.id} className="consent-checkbox" htmlFor={`add-child-dialect-${option.id}`}>
              <input id={`add-child-dialect-${option.id}`} type="radio" name="add-child-dialect" value={option.id} checked={dialectLexiconId === option.id} onChange={() => setDialectLexiconId(option.id)} />
              <span>{t(option.label)}</span>
            </label>
          ))}
        </fieldset>
        <button className="action-button" type="submit" disabled={busy || !email.trim() || !firstName.trim() || !birthMonth}>
          {busy ? t('addChildSubmitting') : t('addChildSubmit')}
        </button>
      </form>
      {notice && <p className="professional-notice" role={notice.kind === 'success' ? 'status' : 'alert'} aria-live="polite">{notice.text}</p>}
    </section>
  )
}
