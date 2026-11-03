import { useMemo, useState } from 'react'
import graphDocument from '../../../contracts/skill-graph.json'
import { useI18n } from '../i18n/context'
import { SKILL_GRAPH_STATUS } from './engine'
import { useLearningMap } from './context'
import type { MasteryBand } from './types'

const bandMessage: Record<MasteryBand, 'learningMapBandUnknown' | 'learningMapBandWorking' | 'learningMapBandGrowing' | 'learningMapBandProbeDue' | 'learningMapBandMastered'> = {
  unknown: 'learningMapBandUnknown',
  working_on: 'learningMapBandWorking',
  growing: 'learningMapBandGrowing',
  probe_due: 'learningMapBandProbeDue',
  mastered: 'learningMapBandMastered',
}

function percent(value: number | null, locale: string): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value)
}

function date(value: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function ProgressWorkspace() {
  const { t, locale } = useI18n()
  const learningMap = useLearningMap()
  const [selectedSkillId, setSelectedSkillId] = useState<string>('')

  const selectedSkill = learningMap?.map?.skills.find((skill) => skill.skill_id === selectedSkillId) ?? learningMap?.map?.skills[0] ?? null
  const selectedLabel = useMemo(() => {
    const row = graphDocument.skills.find((skill) => skill.id === selectedSkill?.skill_id)
    return row ? (locale === 'ar' ? row.label_ar : row.label_en) : ''
  }, [locale, selectedSkill?.skill_id])

  if (!learningMap) return null
  if (learningMap.state === 'unavailable') return null

  const graphSkills = graphDocument.skills
  const hasEvents = Boolean(learningMap.read?.events.length)
  const hasMasteryRows = Boolean(learningMap.read?.storedMastery.length)

  return (
    <section className="learning-map-workspace" aria-labelledby="learning-map-title">
      <div className="learning-map-heading">
        <div>
          <p className="eyebrow">{t('learningMapKicker')}</p>
          <h2 id="learning-map-title">{t('learningMapTitle')}</h2>
          <p>{t('learningMapDescription')}</p>
        </div>
        <button className="action-button" type="button" onClick={learningMap.reload} disabled={learningMap.state === 'loading'}>
          {t('learningMapReload')}
        </button>
      </div>

      <div className="learning-map-notice" role="note">
        <strong>{t('learningMapProvisionalTitle')}</strong>
        <p>{t('learningMapProvisionalDescription')}</p>
      </div>

      <div className="learning-map-controls">
        <label className="assessment-field" htmlFor="learning-map-child">
          {t('learningMapChildLabel')}
          <select id="learning-map-child" value={learningMap.selectedChildId ?? ''} onChange={(event) => learningMap.selectChild(event.target.value)}>
            {learningMap.children.length === 0 && <option value="">{t('learningMapNoChildren')}</option>}
            {learningMap.children.map((child) => (
              <option key={child.id} value={child.id}>{child.firstName}</option>
            ))}
          </select>
        </label>
        <label className="assessment-field" htmlFor="learning-map-skill">
          {t('learningMapSkillLabel')}
          <select id="learning-map-skill" value={selectedSkill?.skill_id ?? ''} onChange={(event) => setSelectedSkillId(event.target.value)}>
            {graphSkills.map((skill) => <option key={skill.id} value={skill.id}>{locale === 'ar' ? skill.label_ar : skill.label_en}</option>)}
          </select>
        </label>
      </div>

      {learningMap.selectedChild?.isDemo && (
        <p className="learning-map-banner" role="status">{t('learningMapDemoBanner')}</p>
      )}
      {learningMap.map?.synthetic && (
        <p className="learning-map-banner" role="status">{t('learningMapSyntheticBanner')}</p>
      )}
      <p className="learning-map-status">{t('learningMapGraphStatus')}: {SKILL_GRAPH_STATUS}</p>

      {learningMap.state === 'loading' && <p role="status" aria-live="polite">{t('learningMapLoading')}</p>}
      {learningMap.state === 'error' && <p className="professional-notice" role="alert">{t('learningMapLoadError')}</p>}
      {learningMap.truncated && <p className="learning-map-status" role="note">{t('learningMapTruncated')}</p>}

      {learningMap.map && (
        <>
          <section className="learning-map-summary" aria-labelledby="learning-map-summary-title">
            <h3 id="learning-map-summary-title">{t('learningMapSummaryTitle')}</h3>
            <p>{t('learningMapSummaryDescription')}</p>
            {selectedSkill && (
              <dl className="learning-map-metrics">
                <div><dt>{t('learningMapSelectedSkill')}</dt><dd>{selectedLabel}</dd></div>
                <div><dt>{t('learningMapObservedAccuracy')}</dt><dd>{percent(selectedSkill.mastery, locale)}</dd></div>
                <div><dt>{t('learningMapBand')}</dt><dd>{t(bandMessage[selectedSkill.band])}</dd></div>
                <div><dt>{t('learningMapEvidenceCount')}</dt><dd>{selectedSkill.evidenceCounts.total}</dd></div>
              </dl>
            )}
          </section>

          <section className="learning-map-table-section" aria-labelledby="learning-map-table-title">
            <h3 id="learning-map-table-title">{t('learningMapTableTitle')}</h3>
            <div className="learning-map-table-wrap">
              <table className="learning-map-table">
                <caption>{t('learningMapTableCaption')}</caption>
                <thead><tr><th scope="col">{t('learningMapSkillLabel')}</th><th scope="col">{t('learningMapObservedAccuracy')}</th><th scope="col">{t('learningMapBand')}</th><th scope="col">{t('learningMapHistory')}</th><th scope="col">{t('learningMapNoGain')}</th></tr></thead>
                <tbody>
                  {learningMap.map.skills.map((skill) => {
                    const row = graphSkills.find((candidate) => candidate.id === skill.skill_id)
                    return (
                      <tr key={skill.skill_id}>
                        <th scope="row">{row ? (locale === 'ar' ? row.label_ar : row.label_en) : t('learningMapUnknownSkill')}</th>
                        <td>{percent(skill.mastery, locale)}</td>
                        <td>{t(bandMessage[skill.band])}</td>
                        <td>{skill.history.length || t('learningMapNone')}</td>
                        <td>{skill.noGainFlag ? t('learningMapFlagged') : t('learningMapNone')}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {!hasEvents && <p className="learning-map-status">{t('learningMapNoEvents')}</p>}
          </section>

          <section className="learning-map-history" aria-labelledby="learning-map-history-title">
            <h3 id="learning-map-history-title">{t('learningMapHistoryTitle')}{selectedLabel ? ` — ${selectedLabel}` : ''}</h3>
            {selectedSkill?.history.length ? (
              <ol>
                {selectedSkill.history.map((point) => <li key={`${point.sessionId}-${point.at}`}>{date(point.at, locale)} · {percent(point.mastery, locale)} · {point.evidenceCounts.total} {t('learningMapEvidenceUnit')}</li>)}
              </ol>
            ) : <p>{t('learningMapNoHistory')}</p>}
          </section>

          <section className="learning-map-plan" aria-labelledby="learning-map-plan-title">
            <h3 id="learning-map-plan-title">{t('learningMapNextPlanTitle')}</h3>
            <p>{t('learningMapNextPlanDescription')}</p>
            <dl>
              <div><dt>{t('learningMapPrimaryTarget')}</dt><dd>{learningMap.nextPlan?.primarySkillId ?? t('learningMapNone')}</dd></div>
              <div><dt>{t('learningMapReviewTargets')}</dt><dd>{learningMap.nextPlan?.reviewSkillIds.length ?? 0}</dd></div>
              <div><dt>{t('learningMapProbeDueTargets')}</dt><dd>{learningMap.nextPlan?.probeDueIds.length ?? 0}</dd></div>
            </dl>
          </section>
        </>
      )}

      <section className="learning-map-stored" aria-labelledby="learning-map-stored-title">
        <h3 id="learning-map-stored-title">{t('learningMapStoredTitle')}</h3>
        <p>{t('learningMapStoredDescription')}</p>
        {hasMasteryRows ? (
          <div className="learning-map-table-wrap">
            <table className="learning-map-table">
              <caption>{t('learningMapStoredCaption')}</caption>
              <thead><tr><th scope="col">{t('learningMapSkillLabel')}</th><th scope="col">{t('learningMapStoredMastery')}</th><th scope="col">{t('learningMapStoredAt')}</th></tr></thead>
              <tbody>{learningMap.read?.storedMastery.map((row) => {
                const skill = graphSkills.find((candidate) => candidate.id === row.skillId)
                return <tr key={`${row.skillId}-${row.updatedAt}`}><th scope="row">{skill ? (locale === 'ar' ? skill.label_ar : skill.label_en) : t('learningMapUnknownSkill')}</th><td>{percent(row.mastery, locale)}</td><td>{date(row.updatedAt, locale)}</td></tr>
              })}</tbody>
            </table>
          </div>
        ) : <p>{t('learningMapNoStoredHistory')}</p>}
      </section>
    </section>
  )
}
