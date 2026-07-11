import { useStore } from '../store'

export function StatusBar() {
  const harness = useStore((s) => s.harness)
  const problems = useStore((s) => s.problems)
  const problemsOpen = useStore((s) => s.problemsOpen)
  const toggleProblems = useStore((s) => s.toggleProblems)
  const notice = useStore((s) => s.notice)
  const handle = useStore((s) => s.handle)

  const errors = problems.filter((p) => p.severity === 'error').length
  const warnings = problems.length - errors

  return (
    <>
      {problems.length > 0 && problemsOpen && (
        <div className="problems">
          {problems.map((p, i) => (
            <div
              key={i}
              className={`problems__item${p.severity === 'warning' ? ' problems__item--warning' : ''}`}
            >
              {p.severity.toUpperCase()}
              {p.where && <span className="problems__where"> · {p.where}</span>} · {p.message}
            </div>
          ))}
        </div>
      )}
      <footer className="statusbar">
        <div className="statusbar__group">
          <span>
            harnessfile <span className="accent">0.2</span>
          </span>
          <span>{typeof harness?.name === 'string' ? harness.name : 'no harness'}</span>
          <span>{handle ? 'file system access · read-write' : 'in-memory · export to save'}</span>
        </div>
        <div className="statusbar__group">
          {notice && <span className="accent">{notice}</span>}
          {problems.length === 0 ? (
            <span>validation · clean</span>
          ) : (
            <button type="button" className="statusbar__problems" onClick={toggleProblems}>
              validation · {errors > 0 ? `${errors} error${errors === 1 ? '' : 's'}` : ''}
              {errors > 0 && warnings > 0 ? ' · ' : ''}
              {warnings > 0 ? `${warnings} warning${warnings === 1 ? '' : 's'}` : ''}
              {problemsOpen ? ' · hide' : ' · show'}
            </button>
          )}
        </div>
      </footer>
    </>
  )
}
