import yaml from 'js-yaml'
import { useState } from 'react'
import { useStore, type EntityKind } from '../store'
import type { SquadMember } from '../types'
import { KV, SelectField, TextField } from './fields'

const AGENT_KEYS = ['name', 'description', 'model', 'tools', 'skills']
const SQUAD_KEYS = ['name', 'description', 'leader', 'members']

function passthroughKeys(fm: Record<string, unknown>, known: string[]): Record<string, unknown> {
  const rest: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fm)) {
    if (!known.includes(k)) rest[k] = v
  }
  return rest
}

export function EntityEditor({ entity, slug }: { entity: EntityKind; slug: string }) {
  const setView = useStore((s) => s.setView)

  return (
    <div className="editor-wrap">
      <div className="editor">
        <div>
          <button type="button" className="linklike" onClick={() => setView({ kind: 'graph' })}>
            Back to graph
          </button>
        </div>
        {entity === 'agent' && <AgentEditor key={slug} slug={slug} />}
        {entity === 'squad' && <SquadEditor key={slug} slug={slug} />}
        {entity === 'skill' && <SkillView key={slug} name={slug} />}
      </div>
    </div>
  )
}

/** Comma-separated list editor that tolerates in-progress typing. */
function ListField(props: {
  label: string
  values: string[]
  onChange: (values: string[]) => void
  hint?: string
}) {
  const [text, setText] = useState(props.values.join(', '))
  return (
    <div className="field">
      <label className="field__label">{props.label}</label>
      <input
        className="field__input"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          props.onChange(
            e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }}
      />
      {props.hint && <span className="field__hint">{props.hint}</span>}
    </div>
  )
}

function EditorCard(props: {
  tag: string
  tagAccent?: boolean
  title: string
  subtitle?: string
  path: string
  children: React.ReactNode
}) {
  return (
    <div className="editor__card">
      <div className="editor__head">
        <div>
          <span className={`tag ${props.tagAccent ? 'tag--accent' : 'tag--neutral'}`}>
            {props.tag}
          </span>
          <h2 className="editor__title">{props.title}</h2>
          {props.subtitle && <p className="editor__subtitle">{props.subtitle}</p>}
        </div>
        <span className="tag-text">{props.path}</span>
      </div>
      {props.children}
    </div>
  )
}

function AgentEditor({ slug }: { slug: string }) {
  const agents = useStore((s) => s.agents)
  const skills = useStore((s) => s.skills)
  const updateEntity = useStore((s) => s.updateEntity)
  const agent = agents.find((a) => a.slug === slug)
  if (!agent) return <p className="subtitle">Agent not found.</p>

  const patchFm = (key: string, value: unknown) => {
    const fm = { ...agent.fm }
    if (value === '' || (Array.isArray(value) && value.length === 0 && !(key in agent.fm))) {
      delete fm[key]
    } else {
      fm[key] = value
    }
    updateEntity('agent', slug, fm, agent.body)
  }

  const rest = passthroughKeys(agent.fm, AGENT_KEYS)
  const tools = Array.isArray(agent.fm.tools) ? agent.fm.tools.map(String) : []
  const agentSkills = Array.isArray(agent.fm.skills) ? agent.fm.skills.map(String) : []

  return (
    <EditorCard
      tag="agent role card"
      title={slug}
      subtitle={String(agent.fm.description ?? '')}
      path={agent.path}
    >
      <div className="editor__grid">
        <TextField
          label="name (slug)"
          value={String(agent.fm.name ?? slug)}
          onChange={(v) => patchFm('name', v)}
          hint="should match the file name"
        />
        <TextField
          label="model"
          value={String(agent.fm.model ?? '')}
          placeholder="anthropic/claude-sonnet-5"
          onChange={(v) => patchFm('model', v)}
          hint="portable default — targets may own this (D42)"
        />
        <div className="field field--full">
          <label className="field__label">description</label>
          <textarea
            className="textarea textarea--prose"
            rows={2}
            value={String(agent.fm.description ?? '')}
            onChange={(e) => patchFm('description', e.target.value)}
          />
        </div>
        <ListField
          label="tools (mcp servers)"
          values={tools}
          onChange={(v) => patchFm('tools', v)}
        />
        <ListField
          label="skills"
          values={agentSkills}
          onChange={(v) => patchFm('skills', v)}
          hint={
            agentSkills.some((s) => !skills.some((k) => k.name === s))
              ? 'some skills are missing from skills/'
              : 'resolved in skills/<name>/SKILL.md'
          }
        />
      </div>

      {Object.keys(rest).length > 0 && (
        <KV k="target passthrough — preserved verbatim on save" mono>
          <pre className="passthrough">{yaml.dump(rest).trim()}</pre>
        </KV>
      )}

      <BodyField
        label="system prompt — markdown body"
        body={agent.body}
        onChange={(body) => updateEntity('agent', slug, agent.fm, body)}
      />
    </EditorCard>
  )
}

function SquadEditor({ slug }: { slug: string }) {
  const squads = useStore((s) => s.squads)
  const agents = useStore((s) => s.agents)
  const updateEntity = useStore((s) => s.updateEntity)
  const squad = squads.find((s) => s.slug === slug)
  if (!squad) return <p className="subtitle">Squad not found.</p>

  const members: SquadMember[] = Array.isArray(squad.fm.members)
    ? (squad.fm.members as SquadMember[])
    : []
  const agentOptions = agents.map((a) => ({ value: a.slug }))

  const patchFm = (key: string, value: unknown) => {
    const fm = { ...squad.fm }
    if (value === '') delete fm[key]
    else fm[key] = value
    updateEntity('squad', slug, fm, squad.body)
  }

  const rest = passthroughKeys(squad.fm, SQUAD_KEYS)

  return (
    <EditorCard
      tag="squad"
      tagAccent
      title={slug}
      subtitle={String(squad.fm.description ?? '')}
      path={squad.path}
    >
      <div className="editor__grid">
        <TextField
          label="name (slug)"
          value={String(squad.fm.name ?? slug)}
          onChange={(v) => patchFm('name', v)}
          hint="should match the file name"
        />
        <SelectField
          label="leader"
          value={String(squad.fm.leader ?? '')}
          options={agentOptions}
          allowEmpty
          onChange={(v) => patchFm('leader', v)}
        />
        <div className="field field--full">
          <label className="field__label">description</label>
          <textarea
            className="textarea textarea--prose"
            rows={2}
            value={String(squad.fm.description ?? '')}
            onChange={(e) => patchFm('description', e.target.value)}
          />
        </div>
      </div>

      <div className="kv">
        <span className="kv__key">members — agents only; humans belong to targets</span>
        <div className="member-editor">
          {members.map((member, i) => (
            <div className="member-editor__row" key={i}>
              <select
                className="field__input"
                value={member.agent ?? ''}
                onChange={(e) => {
                  const next = members.map((m, j) =>
                    j === i ? { ...m, agent: e.target.value } : m,
                  )
                  patchFm('members', next)
                }}
              >
                <option value="">—</option>
                {agentOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.value}
                  </option>
                ))}
              </select>
              <input
                className="field__input"
                value={member.role ?? ''}
                placeholder="role"
                onChange={(e) => {
                  const next = members.map((m, j) =>
                    j === i ? { ...m, role: e.target.value } : m,
                  )
                  patchFm('members', next)
                }}
              />
              <button
                type="button"
                className="linklike linklike--muted"
                onClick={() => patchFm('members', members.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="linklike"
            onClick={() =>
              patchFm('members', [...members, { agent: agents[0]?.slug ?? '', role: '' }])
            }
          >
            Add member
          </button>
        </div>
      </div>

      {Object.keys(rest).length > 0 && (
        <KV k="target passthrough — preserved verbatim on save" mono>
          <pre className="passthrough">{yaml.dump(rest).trim()}</pre>
        </KV>
      )}

      <BodyField
        label="orchestration instructions — markdown body"
        body={squad.body}
        onChange={(body) => updateEntity('squad', slug, squad.fm, body)}
      />
    </EditorCard>
  )
}

function BodyField(props: { label: string; body: string; onChange: (body: string) => void }) {
  return (
    <div className="field">
      <label className="field__label">{props.label}</label>
      <textarea
        className="textarea textarea--body"
        defaultValue={props.body}
        onChange={(e) => props.onChange(e.target.value)}
        spellCheck={false}
      />
    </div>
  )
}

function SkillView({ name }: { name: string }) {
  const skills = useStore((s) => s.skills)
  const files = useStore((s) => s.files)
  const skill = skills.find((s) => s.name === name)
  if (!skill) return <p className="subtitle">Skill not found.</p>

  const dir = skill.path.replace(/\/SKILL\.md$/, '')
  const supporting = Object.keys(files)
    .filter((p) => p.startsWith(`${dir}/`) && p !== skill.path)
    .sort()

  return (
    <EditorCard tag="skill · read-only" title={skill.name} subtitle={skill.description} path={skill.path}>
      <p className="body" style={{ fontSize: '0.85rem' }}>
        Skills follow the external Agent Skills standard (SKILL.md) and are adopted verbatim, so
        the editor does not modify them.
      </p>
      {supporting.length > 0 && (
        <KV k="supporting files" mono>
          {supporting.join('\n')}
        </KV>
      )}
      <KV k="skill.md" mono>
        <pre className="passthrough" style={{ maxHeight: '24rem', overflowY: 'auto' }}>
          {files[skill.path]}
        </pre>
      </KV>
    </EditorCard>
  )
}
