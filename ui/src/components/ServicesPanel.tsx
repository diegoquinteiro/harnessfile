import yaml from 'js-yaml'
import { useState } from 'react'
import { useStore } from '../store'
import { configValue, patchBinding, providerObject, runtimeProfiles, serviceRoles, serviceSettings, type ConfigField, type ServiceRole } from '../lib/provider-settings'
import type { ServiceBinding } from '../types'
import { SelectField, TextField } from './fields'

/** Incomplete YAML remains a local draft until the user applies it. */
function YamlSetting({ label, value, onApply, hint }: { label: string; value: unknown; onApply: (value: unknown) => void; hint?: string }) {
  const source = yaml.dump(value ?? {}, { lineWidth: 100, noRefs: true }).trim()
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  return <div className="field field--full">
    <label className="field__label">{label}</label>
    <textarea className="textarea" aria-label={label} rows={5} value={draft ?? source} spellCheck={false} onChange={event => { setDraft(event.target.value); setError(null) }} />
    {hint && <span className="field__hint">{hint}</span>}
    {error && <span className="service-error" role="alert">{error}</span>}
    <div className="service-actions">
      <button type="button" className="linklike linklike--muted" disabled={draft === null} onClick={() => {
        try { const parsed: unknown = yaml.load(draft ?? source); onApply(parsed); setDraft(null); setError(null) }
        catch (reason) { setError(reason instanceof Error ? reason.message : 'Invalid YAML') }
      }}>Apply {label}</button>
      {draft !== null && <button type="button" className="linklike linklike--muted" onClick={() => { setDraft(null); setError(null) }}>Discard draft</button>}
    </div>
  </div>
}
function mapping(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Enter a YAML mapping.')
  return value as Record<string, unknown>
}
function ConfigFields({ fields, config, onChange }: { fields: ConfigField[]; config: Record<string, unknown>; onChange: (path: string, value: unknown) => void }) {
  return <div className="editor__grid">{fields.map(field => field.kind === 'boolean'
    ? <SelectField key={field.path} label={field.label} value={String(configValue(config, field.path) ?? '')} options={[{ value: '', label: 'Provider default' }, { value: 'true', label: 'Enabled' }, { value: 'false', label: 'Disabled' }]} onChange={value => onChange(field.path, value === '' ? undefined : value === 'true')} />
    : <TextField key={field.path} type={field.kind === 'number' ? 'number' : 'text'} label={field.label} value={String(configValue(config, field.path) ?? '')} hint={field.hint} onChange={value => onChange(field.path, field.kind === 'number' && value !== '' ? Number(value) : value)} />)}</div>
}
function IdentityMappings({ binding, change }: { binding: ServiceBinding; change: (path: string, value: unknown) => void }) {
  const agents = useStore(state => state.agents)
  const config = providerObject(binding.provider)
  const [selected, setSelected] = useState('')
  const github = config.type === 'github-app/v1'
  const fields: ConfigField[] = github
    ? [{ path: 'appId', label: 'App ID' }, { path: 'installationId', label: 'Installation ID' }, { path: 'privateKeySecret', label: 'Private key secret name' }, { path: 'subject', label: 'Bot username' }]
    : [{ path: 'tokenSecret', label: 'Token secret name' }, { path: 'subject', label: 'Service account username' }]
  const overrides = config.agents && typeof config.agents === 'object' ? config.agents as Record<string, unknown> : {}
  const available = agents.filter(agent => !(agent.slug in overrides))
  return <div className="service-mappings">
    <h3 className="target-card__name">Default account</h3>
    <ConfigFields fields={fields.map(field => ({ ...field, path: `default.${field.path}` }))} config={config} onChange={change} />
    <p className="field__hint">Secret fields contain environment variable names. Separate visible authors require separate accounts or apps.</p>
    {Object.entries(overrides).map(([agent, value]) => <div className="service-mapping" key={agent}>
      <div className="editor__head"><h3 className="target-card__name">{agent}</h3><button type="button" className="linklike linklike--muted" onClick={() => change('agents', Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== agent)))}>Remove override</button></div>
      <ConfigFields fields={fields} config={value && typeof value === 'object' ? value as Record<string, unknown> : {}} onChange={(path, next) => change(`agents.${agent}.${path}`, next)} />
    </div>)}
    {available.length > 0 && <div className="service-add">
      <SelectField label="Agent account override" value={selected} allowEmpty options={available.map(agent => ({ value: agent.slug }))} onChange={setSelected} />
      <button type="button" className="linklike linklike--muted" disabled={!selected} onClick={() => { change(`agents.${selected}`, {}); setSelected('') }}>Add override</button>
    </div>}
  </div>
}
function ServiceCard({ role }: { role: ServiceRole }) {
  const harness = useStore(state => state.harness)
  const update = useStore(state => state.updateHarness)
  const definition = serviceSettings[role]
  const binding = harness?.[role]
  const config = providerObject(binding?.provider)
  const id = typeof config.type === 'string' ? config.type : ''
  const known = definition.providers.find(provider => provider.id === id)
  const change = (path: string, value: unknown) => update(doc => { doc[role] = patchBinding(doc[role], path, value) })
  return <section className="editor__card" aria-label={definition.title}>
    <div><span className="tag-text">{role}</span><h2 className="editor__title">{definition.title}</h2><p className="editor__subtitle">{definition.description}</p></div>
    <SelectField label={`${definition.title} provider`} value={binding ? known ? id : '__custom' : ''} options={[{ value: '', label: definition.fallback }, ...definition.providers.map(provider => ({ value: provider.id, label: provider.label })), { value: '__custom', label: 'Custom provider' }]} onChange={value => {
      if (!value) update(doc => { delete doc[role] })
      else change('type', value === '__custom' ? 'custom/provider/v1' : value)
    }} />
    {binding && <>
      <TextField label={`${definition.title} provider ID`} value={id} onChange={value => change('type', value)} hint="Versioned provider ID. Extensions are loaded explicitly by the host." />
      {known?.fields && <ConfigFields fields={known.fields} config={config} onChange={change} />}
      {role === 'identity' && ['github-app/v1', 'gitlab-service-account/v1'].includes(id) && <IdentityMappings binding={binding} change={change} />}
      {role === 'project-management' && ['github/v1', 'gitlab/v1'].includes(id) && <YamlSetting key={`${id}-handoffs`} label="Handoff account mappings" value={configValue(config, 'webhook.handoffAgents')} onApply={value => {
        const entries = mapping(value)
        if (Object.values(entries).some(entry => typeof entry !== 'string' || !entry)) throw new Error('Map each agent slug to its account username.')
        change('webhook.handoffAgents', entries)
      }} hint="Map agent slugs to the actual bot or service account that may wake the coordinator after a handoff." />}
      {role === 'execution' && id !== 'local/v1' && <YamlSetting key={`${id}-env`} label="Worker secret mappings" value={config.envSecrets} onApply={value => change('envSecrets', mapping(value))} hint="Map worker environment names to host secret names." />}
      <details className="service-advanced"><summary className="tag-text">All provider settings</summary>
        <YamlSetting key={id} label={`${definition.title} configuration`} value={config} onApply={value => {
          const next = mapping(value)
          if (typeof next.type !== 'string' || !/^([a-z0-9-]+\/)?[a-z0-9-]+\/v[0-9]+$/.test(next.type)) throw new Error('A versioned provider type is required.')
          update(doc => { doc[role] = { ...doc[role], provider: next as { type: string } } })
        }} hint="Opaque plugin settings are preserved. Use secret references instead of credentials." />
      </details>
    </>}
  </section>
}
function RuntimeSettings() {
  const harness = useStore(state => state.harness)
  const update = useStore(state => state.updateHarness)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  return <section className="editor__card" aria-label="Coding-agent runtimes">
    <div><span className="tag-text">Runtimes</span><h2 className="editor__title">Coding-agent protocols</h2><p className="editor__subtitle">Profiles select a coding-agent protocol independently of execution placement.</p></div>
    {Object.entries(harness?.runtimes ?? {}).map(([slug, profile]) => <div className="service-mapping" key={slug}>
      <div className="editor__head"><h3 className="target-card__name">{slug}</h3><button type="button" className="linklike linklike--muted" onClick={() => update(doc => { delete doc.runtimes?.[slug] })}>Remove profile</button></div>
      <div className="editor__grid">
        <TextField label={`${slug} protocol`} value={profile.protocol} onChange={value => update(doc => { doc.runtimes![slug].protocol = value })} hint="claude-code/v1, codex-app-server/v1, or an installed protocol extension" />
        <TextField label={`${slug} command`} value={profile.command ?? ''} onChange={value => update(doc => { if (value) doc.runtimes![slug].command = value; else delete doc.runtimes![slug].command })} hint="Optional executable name, without a machine-specific path." />
      </div>
      <YamlSetting label={`${slug} fixed arguments`} value={profile.args ?? []} onApply={value => {
        if (!Array.isArray(value) || value.some(arg => typeof arg !== 'string' || arg.includes('\0'))) throw new Error('Arguments must be a YAML list of strings without NUL bytes.')
        update(doc => { doc.runtimes![slug].args = value })
      }} />
    </div>)}
    <div className="service-add"><TextField label="New runtime profile" value={name} onChange={setName} /><button type="button" className="linklike linklike--muted" disabled={!name} onClick={() => {
      if (!/^[a-z0-9-]+$/.test(name) || ['constructor', 'prototype'].includes(name) || name in (harness?.runtimes ?? {})) { setError('Choose an unused profile name with lowercase letters, numbers, or hyphens.'); return }
      update(doc => { doc.runtimes ??= {}; doc.runtimes[name] = { protocol: 'claude-code/v1' } }); setName(''); setError('')
    }}>Add profile</button></div>
    {error && <span role="alert" className="service-error">{error}</span>}
    <details className="service-advanced"><summary className="tag-text">All runtime profiles</summary>
      <YamlSetting label="Runtime profiles" value={harness?.runtimes} onApply={value => { const profiles = runtimeProfiles(value); update(doc => { doc.runtimes = profiles }) }} hint="Opaque x- extensions are preserved when editing individual fields." />
    </details>
  </section>
}
export function ServicesPanel() {
  const setView = useStore(state => state.setView)
  const [role, setRole] = useState<ServiceRole | 'runtimes'>('orchestration')
  return <div className="editor-wrap"><div className="editor services">
    <button type="button" className="linklike" onClick={() => setView({ kind: 'graph' })}>Back to graph</button>
    <div><span className="tag-text">Harness configuration</span><h1 className="editor__title">Compose your providers</h1><p className="editor__subtitle">Each service can come from a different provider. Changes update harness.yaml.</p></div>
    <nav className="service-tabs" aria-label="Provider roles">{[...serviceRoles, 'runtimes' as const].map(item => <button type="button" key={item} aria-current={role === item ? 'page' : undefined} className={`service-tab${role === item ? ' service-tab--active' : ''}`} onClick={() => setRole(item)}>{item === 'runtimes' ? 'Runtimes' : serviceSettings[item].title}</button>)}</nav>
    {role === 'runtimes' ? <RuntimeSettings /> : <ServiceCard key={role} role={role} />}
  </div></div>
}
