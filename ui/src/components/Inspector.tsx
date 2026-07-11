import yaml from 'js-yaml'
import { resolvePromptPath } from '../lib/parse'
import { useStore } from '../store'
import type { HarnessDoc, NodeKind, SquadMember, StepDef, TriggerDef } from '../types'
import { KV, SelectField, TextAreaField, TextField } from './fields'

function kindOf(name: string, harness: HarnessDoc): NodeKind | null {
  const trigger = harness.triggers?.[name]
  if (trigger) return 'trigger'
  const step = harness.steps?.[name]
  if (!step) return null
  if (step.type === 'trigger') return 'trigger'
  if (step.type === 'gate' || step.type === 'router' || step.type === 'output') return step.type
  if (step.squad) return 'squad'
  return 'agent'
}

const KIND_TAGS: Record<NodeKind, string> = {
  trigger: 'trigger',
  agent: 'agent step',
  squad: 'squad step',
  gate: 'gate · human approval',
  router: 'router',
  output: 'output',
}

function nextList(def: TriggerDef | StepDef): string[] {
  if (!def.next) return []
  return Array.isArray(def.next) ? def.next : [def.next]
}

export function Inspector() {
  const harness = useStore((s) => s.harness)
  const selectedNode = useStore((s) => s.selectedNode)
  const files = useStore((s) => s.files)
  const agents = useStore((s) => s.agents)
  const squads = useStore((s) => s.squads)
  const setView = useStore((s) => s.setView)
  const selectNode = useStore((s) => s.selectNode)
  const updateHarness = useStore((s) => s.updateHarness)
  const updateFile = useStore((s) => s.updateFile)

  if (!harness || !selectedNode) {
    return (
      <div className="inspector__empty">
        <span className="tag-text">Inspector</span>
        <p className="subtitle">Select a node on the canvas to edit its properties.</p>
      </div>
    )
  }

  const name = selectedNode
  const kind = kindOf(name, harness)
  const inTriggers = Boolean(harness.triggers?.[name])
  const def: TriggerDef | StepDef | undefined = inTriggers
    ? harness.triggers?.[name]
    : harness.steps?.[name]

  if (!kind || !def) {
    return (
      <div className="inspector__empty">
        <span className="tag-text">Inspector</span>
        <p className="subtitle">This node no longer exists in harness.yaml.</p>
      </div>
    )
  }

  /** Set (or delete, when empty) one scalar field on the selected node. */
  const patch = (key: string, value: string) => {
    updateHarness((doc) => {
      const map = inTriggers ? doc.triggers : doc.steps
      const node = map?.[name]
      if (!node) return
      if (value === '') delete node[key]
      else node[key] = value
    })
  }

  const providerValue = def.provider
  const providerIsString = providerValue === undefined || typeof providerValue === 'string'

  const nexts = nextList(def)

  const agentOptions = agents.map((a) => ({ value: a.slug }))
  const squadOptions = squads.map((s) => ({ value: s.slug }))

  const step = def as StepDef
  const promptPath = resolvePromptPath(def.prompt as string | undefined, files)

  return (
    <div className="inspector">
      <div className="inspector__kind">
        <span className={`tag ${kind === 'gate' ? 'tag--accent' : 'tag--neutral'}`}>
          {KIND_TAGS[kind]}
        </span>
      </div>
      <h2 className="inspector__title">{name}</h2>

      {kind === 'trigger' && (
        <>
          {providerIsString ? (
            <TextField
              label="provider"
              value={(providerValue as string) ?? ''}
              placeholder="e.g. jira/v1"
              onChange={(v) => patch('provider', v)}
            />
          ) : (
            <KV k="provider" mono>
              {yaml.dump(providerValue).trim()}
            </KV>
          )}
          <TextField
            label="event"
            value={(def.event as string) ?? ''}
            onChange={(v) => patch('event', v)}
          />
          <TextField
            label="filter"
            value={(def.filter as string) ?? ''}
            onChange={(v) => patch('filter', v)}
          />
          <TextField
            label="schedule (cron)"
            value={(def.schedule as string) ?? ''}
            placeholder="0 * * * *"
            onChange={(v) => patch('schedule', v)}
            hint={def.schedule ? 'scheduled trigger — the autopilot form (D41)' : undefined}
          />
          <TextField
            label="timezone"
            value={(def.timezone as string) ?? ''}
            placeholder="America/Sao_Paulo"
            onChange={(v) => patch('timezone', v)}
          />
          {promptPath ? (
            <TextAreaField
              label={`prompt — ${String(def.prompt)}`}
              value={files[promptPath] ?? ''}
              rows={10}
              onChange={(v) => updateFile(promptPath, v)}
              hint="edits the referenced prompt file"
            />
          ) : (
            <TextAreaField
              label="prompt"
              value={(def.prompt as string) ?? ''}
              rows={5}
              onChange={(v) => patch('prompt', v)}
              hint="inline prompt, or a path to a Markdown file"
            />
          )}
        </>
      )}

      {kind === 'gate' && (
        <>
          <KV k="approve">
            <span className="tag tag--accent">human</span>
          </KV>
          {providerIsString ? (
            <TextField
              label="provider"
              value={(providerValue as string) ?? ''}
              placeholder="e.g. slack/v1"
              onChange={(v) => patch('provider', v)}
            />
          ) : (
            <KV k="provider" mono>
              {yaml.dump(providerValue).trim()}
            </KV>
          )}
          <TextField
            label="channel"
            value={step.channel ?? ''}
            placeholder="#approvals"
            onChange={(v) => patch('channel', v)}
          />
          <TextField
            label="timeout"
            value={step.timeout ?? ''}
            placeholder="1h"
            onChange={(v) => patch('timeout', v)}
          />
          <SelectField
            label="fallback"
            value={step.fallback ?? 'reject'}
            options={[{ value: 'reject' }, { value: 'approve' }, { value: 'escalate' }]}
            onChange={(v) => patch('fallback', v)}
          />
        </>
      )}

      {(kind === 'agent' || kind === 'router') && (
        <>
          <SelectField
            label={kind === 'router' ? 'classifier agent' : 'agent'}
            value={step.agent ?? ''}
            options={agentOptions}
            allowEmpty
            onChange={(v) => patch('agent', v)}
          />
          {step.agent && agents.some((a) => a.slug === step.agent) && (
            <>
              <p className="subtitle" style={{ fontSize: '1rem' }}>
                {String(agents.find((a) => a.slug === step.agent)!.fm.description ?? '')}
              </p>
              <button
                type="button"
                className="linklike"
                onClick={() => setView({ kind: 'entity', entity: 'agent', slug: step.agent! })}
              >
                Open role card
              </button>
            </>
          )}
        </>
      )}

      {kind === 'router' && (
        <RoutesEditor
          name={name}
          routes={step.routes ?? {}}
          stepNames={Object.keys({ ...(harness.steps ?? {}), ...(harness.triggers ?? {}) })}
        />
      )}

      {kind === 'squad' && (
        <>
          <SelectField
            label="squad"
            value={step.squad ?? ''}
            options={squadOptions}
            allowEmpty
            onChange={(v) => patch('squad', v)}
          />
          {step.squad && <SquadDetail slug={step.squad} />}
        </>
      )}

      {kind === 'output' && (
        <KV k="input shape" mono>
          {Object.keys(step.input ?? {}).length > 0
            ? yaml.dump(step.input).trim()
            : 'any (full upstream output)'}
        </KV>
      )}

      {kind !== 'output' && (
        <div className="kv">
          <span className="kv__key">next</span>
          <div className="chips">
            {nexts.length === 0 && <span className="tag tag--neutral">end of path</span>}
            {nexts.map((n) => (
              <button
                key={n}
                type="button"
                className="tag tag--neutral"
                style={{ cursor: 'pointer' }}
                onClick={() => selectNode(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="divider" />
      <div className="kv">
        <span className="kv__key">definition — harness.yaml</span>
        <pre className="passthrough">{yaml.dump({ [name]: def }).trim()}</pre>
      </div>
    </div>
  )
}

function SquadDetail({ slug }: { slug: string }) {
  const squads = useStore((s) => s.squads)
  const setView = useStore((s) => s.setView)
  const squad = squads.find((s) => s.slug === slug)
  if (!squad) return <span className="field__hint field__hint--error">squad not found</span>

  const leader = typeof squad.fm.leader === 'string' ? squad.fm.leader : ''
  const members = Array.isArray(squad.fm.members) ? (squad.fm.members as SquadMember[]) : []

  return (
    <>
      <div className="kv">
        <span className="kv__key">leader + members</span>
        <div>
          {members.map((member, i) => (
            <div className="member-row" key={`${member.agent}-${i}`}>
              <span className="member-row__name">
                <button
                  type="button"
                  onClick={() => setView({ kind: 'entity', entity: 'agent', slug: member.agent })}
                >
                  {member.agent}
                </button>
              </span>
              <span className="member-row__role">{member.role ?? ''}</span>
              {member.agent === leader && <span className="tag tag--accent">leader</span>}
            </div>
          ))}
        </div>
      </div>
      <button
        type="button"
        className="linklike"
        onClick={() => setView({ kind: 'entity', entity: 'squad', slug })}
      >
        Open squad
      </button>
    </>
  )
}

function RoutesEditor(props: { name: string; routes: Record<string, string>; stepNames: string[] }) {
  const updateHarness = useStore((s) => s.updateHarness)

  const setRoutes = (routes: Record<string, string>) => {
    updateHarness((doc) => {
      const node = doc.steps?.[props.name]
      if (!node) return
      if (Object.keys(routes).length === 0) delete node.routes
      else node.routes = routes
    })
  }

  const entries = Object.entries(props.routes)

  return (
    <div className="kv">
      <span className="kv__key">routes</span>
      <div className="member-editor">
        {entries.map(([label, target], i) => (
          <div className="member-editor__row" key={i}>
            <input
              className="field__input"
              value={label}
              onChange={(e) => {
                const next = entries.map(([l, t], j) => (j === i ? [e.target.value, t] : [l, t]))
                setRoutes(Object.fromEntries(next))
              }}
            />
            <select
              className="field__input"
              value={target}
              onChange={(e) => {
                const next = { ...props.routes, [label]: e.target.value }
                setRoutes(next)
              }}
            >
              {props.stepNames.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="linklike linklike--muted"
              onClick={() => {
                const next = { ...props.routes }
                delete next[label]
                setRoutes(next)
              }}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="linklike"
          onClick={() => setRoutes({ ...props.routes, route: props.stepNames[0] ?? '' })}
        >
          Add route
        </button>
      </div>
    </div>
  )
}
