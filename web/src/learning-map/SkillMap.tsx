import graphDocument from '../../../contracts/skill-graph.json'
import { useI18n } from '../i18n/context'
import type { MessageKey } from '../i18n/messages'
import type { LearningMap, MasteryBand, SkillState } from './types'
import './skill-map.css'

const STATIONS: ReadonlyArray<{ type: string; title: MessageKey }> = [
  { type: 'letter_sound', title: 'skillMapStationLetters' },
  { type: 'short_vowel', title: 'skillMapStationVowels' },
  { type: 'dot_discrimination', title: 'skillMapStationDots' },
  { type: 'emphatic_contrast', title: 'skillMapStationEmphatics' },
  { type: 'positional_form', title: 'skillMapStationPositions' },
  { type: 'word_decoding', title: 'skillMapStationWords' },
  { type: 'fluency', title: 'skillMapStationFluency' },
]

const LEGEND: ReadonlyArray<{ band: MasteryBand; label: MessageKey }> = [
  { band: 'mastered', label: 'learningMapBandMastered' },
  { band: 'probe_due', label: 'learningMapBandProbeDue' },
  { band: 'growing', label: 'learningMapBandGrowing' },
  { band: 'working_on', label: 'learningMapBandWorking' },
  { band: 'unknown', label: 'learningMapBandUnknown' },
]

type SkillRow = { id: string; type: string; label_ar: string; label_en: string }

function shortLabel(skill: SkillRow, locale: string): string {
  const label = locale === 'ar' ? skill.label_ar : skill.label_en
  return label.replace(/^صوت حرف\s*/u, '').replace(/^Letter-sound:\s*/u, '')
}

export function SkillMap({ map, selectedSkillId, onSelect }: { map: LearningMap; selectedSkillId?: string; onSelect?: (skillId: string) => void }) {
  const { t, locale } = useI18n()
  const skills = graphDocument.skills as SkillRow[]
  return (
    <div className="skill-map" dir="rtl">
      <ul className="skill-map__legend">
        {LEGEND.map(({ band, label }) => <li key={band}><span className={`skill-map__swatch skill-map__node--${band}`} aria-hidden="true" />{t(label)}</li>)}
      </ul>
      <ol className="skill-map__path">
        {STATIONS.map(({ type, title }, index) => (
          <li className="skill-map__station" key={type}>
            <h4><span className="skill-map__number" aria-hidden="true">{index + 1}</span>{t(title)}</h4>
            <div className="skill-map__nodes">
              {skills.filter((skill) => skill.type === type).map((skill) => {
                const state: SkillState | undefined = map.bySkillId[skill.id]
                const band = state?.band ?? 'unknown'
                const locked = state ? !state.unlocked : true
                return (
                  <button
                    key={skill.id}
                    type="button"
                    className={`skill-map__node skill-map__node--${band}${locked ? ' skill-map__node--locked' : ''}${selectedSkillId === skill.id ? ' skill-map__node--selected' : ''}`}
                    aria-pressed={selectedSkillId === skill.id}
                    title={locale === 'ar' ? skill.label_ar : skill.label_en}
                    onClick={() => onSelect?.(skill.id)}
                  >
                    {shortLabel(skill, locale)}
                  </button>
                )
              })}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

const STAR_BANDS: ReadonlySet<MasteryBand> = new Set(['growing', 'probe_due', 'mastered'])

/** The child's journey: stations and earned stars only, with no scores or labels. */
export function ChildJourney({ map }: { map: LearningMap }) {
  const { t } = useI18n()
  const skills = graphDocument.skills as SkillRow[]
  return (
    <section className="child-journey" aria-labelledby="child-journey-title">
      <h2 id="child-journey-title">{t('skillMapChildTitle')}</h2>
      <ol className="child-journey__path">
        {STATIONS.map(({ type, title }) => {
          const stationSkills = skills.filter((skill) => skill.type === type)
          const earned = stationSkills.filter((skill) => STAR_BANDS.has(map.bySkillId[skill.id]?.band ?? 'unknown')).length
          const filled = stationSkills.length === 0 ? 0 : Math.ceil((earned / stationSkills.length) * 3)
          return (
            <li className={`child-journey__stop${filled > 0 ? ' child-journey__stop--active' : ''}`} key={type}>
              <span className="child-journey__stars" aria-hidden="true">{'★'.repeat(filled)}{'☆'.repeat(3 - filled)}</span>
              <span>{t(title)}</span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
