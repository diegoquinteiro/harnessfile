import { useEffect } from 'react'
import { EntityEditor } from './components/EntityEditor'
import { GraphView } from './components/GraphView'
import { Header } from './components/Header'
import { Inspector } from './components/Inspector'
import { Library } from './components/Library'
import { StatusBar } from './components/StatusBar'
import { TargetsPanel } from './components/TargetsPanel'
import { useStore } from './store'

export default function App() {
  const view = useStore((s) => s.view)
  const harness = useStore((s) => s.harness)
  const loadDemo = useStore((s) => s.loadDemo)

  useEffect(() => {
    if (!useStore.getState().harness) loadDemo()
  }, [loadDemo])

  return (
    <div className="app">
      <Header />
      <div className="main">
        <aside className="pane pane--library">
          <Library />
        </aside>
        <section className={`center${view.kind === 'graph' ? ' center--stage' : ''}`}>
          {view.kind === 'graph' && harness && <GraphView />}
          {view.kind === 'entity' && <EntityEditor entity={view.entity} slug={view.slug} />}
          {view.kind === 'targets' && <TargetsPanel />}
          {view.kind === 'graph' && !harness && (
            <div className="inspector__empty">
              <div className="label--neutral tag-text">No harness loaded</div>
              <p className="subtitle">Open a directory containing a .agents/ harness.</p>
            </div>
          )}
        </section>
        {view.kind === 'graph' && (
          <aside className="pane pane--inspector">
            <Inspector />
          </aside>
        )}
      </div>
      <StatusBar />
    </div>
  )
}
