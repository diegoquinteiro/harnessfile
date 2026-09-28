import type { Provider, ServiceBinding, RuntimeProfileDef } from '../types'
export const serviceRoles = ['orchestration', 'execution', 'project-management', 'identity', 'task-memory'] as const
export type ServiceRole = typeof serviceRoles[number]
export interface ConfigField { path: string; label: string; hint?: string; kind?: 'number' | 'boolean' }
export interface ProviderSetting { id: string; label: string; fields?: ConfigField[] }
const field = (path: string, label: string, hint?: string): ConfigField => ({ path, label, hint })
const api = field('apiUrl', 'API URL', 'Optional API base URL. Identity and task providers must use the same endpoint.')
const state = [field('stateBranch', 'State branch', 'Existing branch used for checkpoint and handoff records.'), field('statePath', 'State directory', 'Default: .harnessfile/tasks'), field('identityAgent', 'Coordinator identity', 'Default: orchestrator. Uses the selected identity provider.'), field('tokenSecret', 'Token secret name', 'Optional override. Use identity mappings to preserve per-agent comment authors.')]
const webhook = [field('webhook.secret', 'Webhook secret name'), field('webhook.taskLabel', 'Task label'), field('webhook.agent', 'Ingress agent attribution')]
export const serviceSettings: Record<ServiceRole, { title: string; description: string; fallback: string; providers: ProviderSetting[] }> = {
  orchestration: { title: 'Orchestration', description: 'Choose the engine that coordinates the graph.', fallback: 'Default · LangGraph', providers: [
    { id: 'langgraph/v1', label: 'LangGraph' }, { id: 'langgraph-stateless/v1', label: 'LangGraph stateless' },
  ] },
  execution: { title: 'Execution', description: 'Choose where coding-agent processes run.', fallback: 'Default · Local', providers: [
    { id: 'local/v1', label: 'Local' },
    { id: 'modal/v1', label: 'Modal', fields: [field('repository', 'Repository HTTPS URL'), field('ref', 'Git ref'), field('image', 'Worker image'), field('app', 'Modal app'), field('tokenIdSecret', 'Token ID secret name'), field('tokenSecretSecret', 'Token secret name'), { path: 'timeoutMs', label: 'Task timeout (ms)', kind: 'number' }] },
    { id: 'daytona/v1', label: 'Daytona', fields: [field('repository', 'Repository HTTPS URL'), field('ref', 'Git ref'), field('snapshot', 'Worker snapshot'), api, field('target', 'Target'), field('apiKeySecret', 'API key secret name')] },
    { id: 'e2b/v1', label: 'E2B', fields: [field('repository', 'Repository HTTPS URL'), field('ref', 'Git ref'), field('template', 'Worker template'), field('apiKeySecret', 'API key secret name')] },
  ] },
  'project-management': { title: 'Project management', description: 'Track tasks and receive work from an issue system.', fallback: 'Disabled', providers: [
    { id: 'memory/v1', label: 'In-memory board' },
    { id: 'github/v1', label: 'GitHub issues', fields: [field('repository', 'Repository', 'owner/repository'), api, ...webhook] },
    { id: 'gitlab/v1', label: 'GitLab issues', fields: [field('project', 'Project', 'Group/project path or project ID'), api, ...webhook] },
  ] },
  identity: { title: 'Identity', description: 'Map agents to real accounts using environment secret references.', fallback: 'Default · Local', providers: [
    { id: 'local/v1', label: 'Local' }, { id: 'github-app/v1', label: 'GitHub App', fields: [api] }, { id: 'gitlab-service-account/v1', label: 'GitLab service account', fields: [api] },
  ] },
  'task-memory': { title: 'Task memory', description: 'Persist checkpoints and handoffs independently of the task board.', fallback: 'Disabled', providers: [
    { id: 'filesystem/v1', label: 'Filesystem', fields: [field('path', 'Storage directory'), { path: 'lockTimeoutMs', label: 'Lock timeout (ms)', kind: 'number' }] },
    { id: 'gitlab/v1', label: 'GitLab', fields: [field('project', 'Project'), api, ...state, { path: 'publishNotes', label: 'Publish handoff notes', kind: 'boolean' }] },
    { id: 'github/v1', label: 'GitHub', fields: [field('repository', 'Repository'), api, ...state, { path: 'publishNotes', label: 'Publish handoff comments', kind: 'boolean' }] },
  ] },
}
export function providerObject(provider?: Provider): Record<string, unknown> {
  return typeof provider === 'string' ? { type: provider } : provider && typeof provider === 'object' && !Array.isArray(provider) ? provider : {}
}
export function configValue(config: Record<string, unknown>, path: string): unknown {
  let value: unknown = config
  for (const part of path.split('.')) value = value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined
  return value
}
/** Update one field without discarding plugin configuration or binding extensions. */
export function patchBinding(binding: ServiceBinding | undefined, path: string, value: unknown): ServiceBinding {
  const next = binding && typeof binding === 'object' && !Array.isArray(binding) ? structuredClone(binding) : { provider: '' }
  const config = { ...providerObject(next.provider) }
  next.provider = config as Exclude<Provider, string>
  const parts = path.split('.')
  if (parts.some(part => ['__proto__', 'constructor', 'prototype'].includes(part))) throw new Error('Invalid configuration key')
  let cursor = config
  for (const key of parts.slice(0, -1)) {
    const child = cursor[key]
    cursor[key] = child && typeof child === 'object' && !Array.isArray(child) ? { ...child } : {}
    cursor = cursor[key] as Record<string, unknown>
  }
  const key = parts.at(-1)!
  if (value === '' || value === undefined) delete cursor[key]
  else cursor[key] = value
  return next
}

export function runtimeProfiles(value: unknown): Record<string, RuntimeProfileDef> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Runtime profiles must be a YAML mapping.')
  for (const [name, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Runtime '${name}' must be an object.`)
    const profile = raw as Record<string, unknown>
    if (typeof profile.protocol !== 'string' || !/^[a-z0-9-]+\/v[0-9]+$/.test(profile.protocol)) throw new Error(`Runtime '${name}' needs a versioned protocol.`)
    if (profile.command !== undefined && (typeof profile.command !== 'string' || !profile.command || /[/\\]/.test(profile.command))) throw new Error(`Runtime '${name}' needs a portable command name.`)
    if (profile.args !== undefined && (!Array.isArray(profile.args) || profile.args.some(arg => typeof arg !== 'string' || arg.includes('\0')))) throw new Error(`Runtime '${name}' args must be strings without NUL bytes.`)
    if (Object.keys(profile).some(key => !['protocol', 'command', 'args'].includes(key) && !key.startsWith('x-'))) throw new Error(`Runtime '${name}' has an unknown field.`)
  }
  return value as Record<string, RuntimeProfileDef>
}
