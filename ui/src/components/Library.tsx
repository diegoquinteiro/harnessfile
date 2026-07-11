import { useStore, type EntityKind } from '../store'

export function Library() {
  const agents = useStore((s) => s.agents)
  const squads = useStore((s) => s.squads)
  const skills = useStore((s) => s.skills)
  const harness = useStore((s) => s.harness)
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)

  const isActive = (entity: EntityKind, slug: string) =>
    view.kind === 'entity' && view.entity === entity && view.slug === slug

  const openEntity = (entity: EntityKind, slug: string) => setView({ kind: 'entity', entity, slug })

  const targets = Object.entries(harness?.targets ?? {})

  return (
    <nav className="library">
      <div className="library__section">
        <div className="library__heading">
          <button type="button" className="linklike" onClick={() => setView({ kind: 'graph' })}>
            Graph
          </button>
        </div>
      </div>

      <div className="library__section">
        <div className="library__heading">
          <span className="tag-text">Agents</span>
          <span className="library__count">{agents.length}</span>
        </div>
        {agents.map((agent) => (
          <button
            key={agent.slug}
            type="button"
            className={`library__item${isActive('agent', agent.slug) ? ' library__item--active' : ''}`}
            onClick={() => openEntity('agent', agent.slug)}
          >
            <div className="library__item-name">{agent.slug}</div>
            <div className="library__item-desc">{String(agent.fm.description ?? '')}</div>
          </button>
        ))}
      </div>

      <div className="library__section">
        <div className="library__heading">
          <span className="tag-text">Squads</span>
          <span className="library__count">{squads.length}</span>
        </div>
        {squads.map((squad) => (
          <button
            key={squad.slug}
            type="button"
            className={`library__item${isActive('squad', squad.slug) ? ' library__item--active' : ''}`}
            onClick={() => openEntity('squad', squad.slug)}
          >
            <div className="library__item-name">{squad.slug}</div>
            <div className="library__item-desc">{String(squad.fm.description ?? '')}</div>
          </button>
        ))}
      </div>

      <div className="library__section">
        <div className="library__heading">
          <span className="tag-text">Skills</span>
          <span className="library__count">{skills.length}</span>
        </div>
        {skills.map((skill) => (
          <button
            key={skill.name}
            type="button"
            className={`library__item${isActive('skill', skill.name) ? ' library__item--active' : ''}`}
            onClick={() => openEntity('skill', skill.name)}
          >
            <div className="library__item-name">{skill.name}</div>
            <div className="library__item-desc">{skill.description}</div>
          </button>
        ))}
      </div>

      <div className="library__section">
        <div className="library__heading">
          <span className="tag-text">Targets</span>
          <span className="library__count">{targets.length}</span>
        </div>
        {targets.map(([name, target]) => (
          <button
            key={name}
            type="button"
            className={`library__item${view.kind === 'targets' ? ' library__item--active' : ''}`}
            onClick={() => setView({ kind: 'targets' })}
          >
            <div className="library__item-name">{name}</div>
            <div className="library__item-desc">
              {typeof target.provider === 'string' ? target.provider : 'provider object'}
            </div>
          </button>
        ))}
      </div>
    </nav>
  )
}
