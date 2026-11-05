import type { Stage0Construct } from '../../../contracts/basira'
import { useI18n } from '../../../i18n/context'
import type { MessageKey } from '../../../i18n/messages'

export type ExaminerConstructState = 'available' | 'unavailable' | 'saved' | 'active'

export type ExaminerConstructItem = {
  construct: Stage0Construct
  label: MessageKey
  state: ExaminerConstructState
  status: MessageKey
}

export type ExaminerSidebarProps = {
  childName?: string
  childIsDemo?: boolean
  childLabel?: MessageKey
  sessionStatus?: MessageKey
  items: readonly ExaminerConstructItem[]
  activeConstruct: Stage0Construct | null
  onSelect: (construct: Stage0Construct) => void
}

function stateSymbol(state: ExaminerConstructState) {
  if (state === 'saved') return '✓'
  if (state === 'unavailable') return '—'
  if (state === 'active') return '●'
  return '○'
}

export function ExaminerSidebar({ activeConstruct, childIsDemo = false, childLabel, childName, items, onSelect, sessionStatus }: ExaminerSidebarProps) {
  const { t } = useI18n()
  return (
    <div className="examiner-sidebar">
      <div className="examiner-sidebar__topline">
        <span className="examiner-sidebar__badge">EXAMINER</span>
      </div>
      <div className="examiner-sidebar__identity">
        <p className="examiner-sidebar__kicker">{childLabel ? t(childLabel) : t('stage0ChooseChild')}</p>
        <p className="examiner-sidebar__child">{childName || t('stage0ChooseChildPlaceholder')}</p>
        {childIsDemo && <span className="examiner-sidebar__demo">{t('assessmentDemoLabel')}</span>}
        {sessionStatus && <p className="examiner-sidebar__session">{t(sessionStatus)}</p>}
      </div>
      <nav className="examiner-sidebar__nav" aria-label={t('stage0Title')}>
        <p className="examiner-sidebar__section-label">{t('stage0Title')}</p>
        <ol className="examiner-sidebar__list">
          {items.map((item, index) => {
            const disabled = item.state === 'unavailable' || item.state === 'saved'
            const isActive = activeConstruct === item.construct
            return (
              <li key={item.construct} className={`examiner-sidebar__item examiner-sidebar__item--${item.state}`}>
                <button
                  type="button"
                  className="examiner-sidebar__item-button"
                  aria-current={isActive ? 'step' : undefined}
                  disabled={disabled}
                  onClick={() => onSelect(item.construct)}
                >
                  <span className="examiner-sidebar__index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                  <span className="examiner-sidebar__item-copy">
                    <span className="examiner-sidebar__item-label">{t(item.label)}</span>
                    <span className="examiner-sidebar__item-status">{t(item.status)}</span>
                  </span>
                  <span className="examiner-sidebar__symbol" aria-hidden="true">{stateSymbol(item.state)}</span>
                </button>
              </li>
            )
          })}
        </ol>
      </nav>
      <div className="examiner-sidebar__footer">
        <p>{t('stage0NoNorms')}</p>
        <p>{t('stage0ExaminerOnly')}</p>
      </div>
    </div>
  )
}
