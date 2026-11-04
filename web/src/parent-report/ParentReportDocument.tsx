import type { ParentReport } from '../contracts/basira'
import { useI18n } from '../i18n/context'

export function ParentReportDocument({ report, demo = false }: { report: ParentReport; demo?: boolean }) {
  const { t } = useI18n()
  return (
    <article className="parent-report-document" dir="rtl" lang="ar" aria-labelledby="parent-report-heading">
      <header className="parent-report-header">
        <p className="parent-report-kicker">{t('parentReportKicker')}</p>
        <h1 id="parent-report-heading">{t('parentReportTitle')}</h1>
        {demo && <p className="parent-report-demo">{t('parentReportDemo')}</p>}
        <dl className="parent-report-meta">
          <div><dt>{t('parentReportChild')}</dt><dd>{report.child_first_name}</dd></div>
          <div><dt>{t('parentReportDate')}</dt><dd>{report.session_date}</dd></div>
          <div><dt>{t('parentReportDuration')}</dt><dd>{report.duration_min} {t('parentReportMinutes')}</dd></div>
        </dl>
      </header>

      <section aria-labelledby="parent-report-practised">
        <h2 id="parent-report-practised">{t('parentReportPractised')}</h2>
        {report.practised.length === 0 ? <p className="parent-report-muted">{t('parentReportNoPractised')}</p> : (
          <ul className="parent-report-list">
            {report.practised.map((entry) => <li key={entry.skill_id}>{entry.plain_ar}</li>)}
          </ul>
        )}
      </section>

      <section aria-labelledby="parent-report-progress">
        <h2 id="parent-report-progress">{t('parentReportProgress')}</h2>
        {report.progress_notes.length === 0 ? <p className="parent-report-muted">{t('parentReportNoProgress')}</p> : (
          <ul className="parent-report-list">
            {report.progress_notes.map((entry) => <li key={entry.skill_id}>{entry.note_ar}</li>)}
          </ul>
        )}
      </section>

      <section aria-labelledby="parent-report-home">
        <h2 id="parent-report-home">{t('parentReportHomePlan')}</h2>
        <div className="parent-report-home-grid">
          {report.home_plan.map((entry, index) => (
            <article className="parent-report-home-card" key={`${entry.title_ar}-${index}`}>
              <h3>{entry.title_ar}</h3>
              <p className="parent-report-minutes">{entry.minutes} {t('parentReportMinutes')}</p>
              {entry.words.length > 0 && <p><strong>{t('parentReportWords')}</strong> {entry.words.join('، ')}</p>}
              <p>{entry.how_ar}</p>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="parent-report-next">
        <h2 id="parent-report-next">{t('parentReportNextFocus')}</h2>
        <p>{report.next_focus_ar}</p>
      </section>

      <footer className="parent-report-footer">
        <h2>{t('parentReportSpecialist')}</h2>
        <p>{report.specialist.name}</p>
        <p dir="ltr" className="parent-report-contact">{report.specialist.contact}</p>
      </footer>
    </article>
  )
}
