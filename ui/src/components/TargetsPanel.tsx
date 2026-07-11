import yaml from 'js-yaml'
import { useStore } from '../store'
import { KV } from './fields'

export function TargetsPanel() {
  const harness = useStore((s) => s.harness)
  const setView = useStore((s) => s.setView)
  const targets = Object.entries(harness?.targets ?? {})

  return (
    <div className="editor-wrap">
      <div className="targets">
        <div>
          <button type="button" className="linklike" onClick={() => setView({ kind: 'graph' })}>
            Back to graph
          </button>
        </div>
        <div>
          <span className="tag-text">Targets</span>
          <h2 className="editor__title">Where this harness syncs</h2>
          <p className="editor__subtitle">
            Bootstrap, then hands off: owned fields are seeded from portable defaults on the first
            push and never overwritten by later syncs (D42).
          </p>
        </div>

        <div className="targets__grid">
          {targets.map(([name, target]) => (
            <div className="target-card" key={name}>
              <span className="tag-text">target</span>
              <div className="target-card__name">{name}</div>
              <KV k="provider" mono>
                {typeof target.provider === 'string'
                  ? target.provider
                  : yaml.dump(target.provider).trim()}
              </KV>
              <div className="kv">
                <span className="kv__key">owns</span>
                <div className="chips">
                  {(target.owns ?? []).length === 0 && (
                    <span className="tag tag--neutral">nothing — git wins everywhere</span>
                  )}
                  {(target.owns ?? []).map((field) => (
                    <span key={field} className="tag tag--neutral">
                      {field}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
          {targets.length === 0 && (
            <p className="subtitle">This harness declares no sync targets.</p>
          )}
        </div>
      </div>
    </div>
  )
}
