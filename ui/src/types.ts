/** Harnessfile v0.2 model types — mirrors schema/harness-0.2.schema.json. */

export type Next = string | string[]

/** A provider is either "vendor/name/vN" shorthand or an object with a type. */
export type Provider = string | { type: string; [k: string]: unknown }

export interface TriggerDef {
  type?: 'trigger'
  provider?: Provider
  event?: string
  filter?: string
  schedule?: string
  timezone?: string
  prompt?: string
  output?: Record<string, unknown>
  next?: Next
  [k: string]: unknown
}

export type StepType = 'agent' | 'squad' | 'trigger' | 'output' | 'gate' | 'router'

export interface StepDef {
  type?: StepType
  agent?: string
  squad?: string
  routes?: Record<string, string>
  approve?: 'human'
  channel?: string
  fallback?: 'reject' | 'approve' | 'escalate'
  timeout?: string
  provider?: Provider
  event?: string
  filter?: string
  schedule?: string
  timezone?: string
  prompt?: string
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  next?: Next
  [k: string]: unknown
}

export interface TargetDef {
  provider: Provider
  owns?: string[]
  [k: string]: unknown
}

export interface HarnessDoc {
  harnessfile?: string
  name?: string
  triggers?: Record<string, TriggerDef>
  steps?: Record<string, StepDef>
  targets?: Record<string, TargetDef>
  [k: string]: unknown
}

/** A parsed Markdown + frontmatter entity (agent role card or squad). */
export interface EntityDoc {
  slug: string
  path: string
  fm: Record<string, unknown>
  body: string
}

export interface SquadMember {
  agent: string
  role?: string
}

export interface SkillInfo {
  name: string
  description: string
  path: string
}

export interface Problem {
  severity: 'error' | 'warning'
  message: string
  where?: string
}

/** Resolved node kind used by the graph view. */
export type NodeKind = 'trigger' | 'agent' | 'squad' | 'gate' | 'router' | 'output'

/** Which harness.yaml map a graph node came from. */
export type NodeContainer = 'triggers' | 'steps'
