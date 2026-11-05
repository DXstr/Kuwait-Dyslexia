import type { ParentReport } from '../contracts/basira'
import { guardianCopy } from '../ui/pages/guardian/copy'
import '../ui/pages/guardian/guardian.css'

export function ParentReportDocument({ report, demo = false, headingId = 'parent-report-heading' }: { report: ParentReport; demo?: boolean; headingId?: string }) {
  return (
    <article className="parent-report-document" dir="rtl" lang="ar" aria-labelledby={headingId}>
      <header className="parent-report-header">
        <p className="parent-report-kicker">{guardianCopy.documentKicker}</p>
        <h1 id={headingId}>{guardianCopy.documentTitle}</h1>
        {demo && <p className="parent-report-demo">{guardianCopy.demoNotice}</p>}
        <dl className="parent-report-meta">
          <div><dt>{guardianCopy.child}</dt><dd>{report.child_first_name}</dd></div>
          <div><dt>{guardianCopy.date}</dt><dd>{report.session_date}</dd></div>
          <div><dt>{guardianCopy.duration}</dt><dd>{report.duration_min} {guardianCopy.minutes}</dd></div>
        </dl>
      </header>

      <section aria-labelledby="parent-report-practised">
        <h2 id="parent-report-practised">{guardianCopy.practised}</h2>
        {report.practised.length === 0 ? <p className="parent-report-muted">{guardianCopy.noPractised}</p> : (
          <ul className="parent-report-list parent-report-vocalized">
            {report.practised.map((entry) => <li key={entry.skill_id}>{entry.plain_ar}</li>)}
          </ul>
        )}
      </section>

      <section aria-labelledby="parent-report-progress">
        <h2 id="parent-report-progress">{guardianCopy.progress}</h2>
        {report.progress_notes.length === 0 ? <p className="parent-report-muted">{guardianCopy.noProgress}</p> : (
          <ul className="parent-report-list parent-report-vocalized">
            {report.progress_notes.map((entry) => <li key={entry.skill_id}>{entry.note_ar}</li>)}
          </ul>
        )}
      </section>

      <section aria-labelledby="parent-report-home">
        <h2 id="parent-report-home">{guardianCopy.homePlan}</h2>
        <div className="parent-report-home-grid">
          {report.home_plan.map((entry, index) => (
            <article className="parent-report-home-card" key={`${entry.title_ar}-${index}`}>
              <h3 className="parent-report-vocalized">{entry.title_ar}</h3>
              <p className="parent-report-minutes">{entry.minutes} {guardianCopy.minutes}</p>
              {entry.words.length > 0 && <p className="parent-report-vocalized"><strong>{guardianCopy.words}</strong> {entry.words.join('، ')}</p>}
              <p className="parent-report-vocalized">{entry.how_ar}</p>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="parent-report-next">
        <h2 id="parent-report-next">{guardianCopy.nextFocus}</h2>
        <p className="parent-report-vocalized">{report.next_focus_ar}</p>
      </section>

      <footer className="parent-report-footer">
        <h2>{guardianCopy.specialist}</h2>
        <p>{report.specialist.name}</p>
        <p dir="ltr" className="parent-report-contact">{report.specialist.contact}</p>
        <p className="parent-report-footer-note">{guardianCopy.documentFooter}</p>
      </footer>
    </article>
  )
}
