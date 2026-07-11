import dagre from '@dagrejs/dagre'
import type { Edge, Node } from '@xyflow/react'
import { MarkerType } from '@xyflow/react'
import type {
  EntityDoc,
  HarnessDoc,
  Next,
  NodeContainer,
  NodeKind,
  StepDef,
  TriggerDef,
} from '../types'

export interface HarnessNodeData extends Record<string, unknown> {
  kind: NodeKind
  container: NodeContainer
  name: string
  title: string
  tag: string
  meta?: string
}

export type HarnessFlowNode = Node<HarnessNodeData, 'harness'>

const NODE_WIDTH = 250
const NODE_HEIGHT: Record<NodeKind, number> = {
  trigger: 100,
  agent: 92,
  squad: 92,
  gate: 100,
  router: 92,
  output: 78,
}

function targetsOf(next: Next | undefined): string[] {
  if (!next) return []
  return Array.isArray(next) ? next : [next]
}

function stepKind(step: StepDef): NodeKind {
  if (step.type === 'gate' || step.type === 'router' || step.type === 'output') return step.type
  if (step.type === 'trigger') return 'trigger'
  if (step.squad) return 'squad'
  return 'agent'
}

function providerName(p: unknown): string {
  if (typeof p === 'string') return p
  if (p && typeof p === 'object' && 'type' in p) return String((p as { type: unknown }).type)
  return ''
}

function displayName(entity: EntityDoc | undefined, fallback: string): string {
  if (!entity) return fallback
  for (const value of Object.values(entity.fm)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const dn = (value as Record<string, unknown>).display_name
      if (typeof dn === 'string') return dn
    }
  }
  return typeof entity.fm.name === 'string' ? entity.fm.name : fallback
}

function triggerMeta(trigger: TriggerDef): string {
  if (trigger.schedule) {
    return trigger.timezone ? `${trigger.schedule} · ${trigger.timezone}` : trigger.schedule
  }
  const parts = [providerName(trigger.provider), trigger.event].filter(Boolean)
  return parts.join(' · ')
}

function stepMeta(step: StepDef, kind: NodeKind): string | undefined {
  switch (kind) {
    case 'gate': {
      const parts = [
        step.channel,
        step.timeout,
        step.fallback ? `fallback ${step.fallback}` : undefined,
      ].filter(Boolean)
      return parts.length ? parts.join(' · ') : providerName(step.provider) || undefined
    }
    case 'router':
      return step.agent ? `via agents/${step.agent}.md` : undefined
    case 'agent':
      return step.agent ? `agents/${step.agent}.md` : undefined
    case 'squad':
      return step.squad ? `squads/${step.squad}.md` : undefined
    case 'output': {
      const fields = Object.keys(step.input ?? {})
      return fields.length ? fields.join(', ') : undefined
    }
    default:
      return triggerMeta(step as TriggerDef)
  }
}

/**
 * Build the graph from harness.yaml and lay it out left→right with dagre.
 * Positions are never stored in the file (the spec has no layout concept).
 */
export function buildGraph(
  harness: HarnessDoc,
  agents: EntityDoc[],
  squads: EntityDoc[],
): { nodes: HarnessFlowNode[]; edges: Edge[] } {
  const agentBySlug = new Map(agents.map((a) => [a.slug, a]))
  const squadBySlug = new Map(squads.map((s) => [s.slug, s]))

  const tagFor = (kind: NodeKind, def: StepDef | TriggerDef): string => {
    switch (kind) {
      case 'trigger':
        return def.schedule ? 'trigger · scheduled' : 'trigger'
      case 'gate':
        return 'gate · human'
      case 'agent':
        return 'step · agent'
      case 'squad':
        return 'step · squad'
      case 'router':
        return 'router'
      case 'output':
        return 'output'
    }
  }

  interface Spec {
    id: string
    kind: NodeKind
    container: NodeContainer
    title: string
    tag: string
    meta?: string
  }
  const specs: Spec[] = []
  const edges: Edge[] = []

  const triggers = harness.triggers ?? {}
  const steps = harness.steps ?? {}

  for (const [name, trigger] of Object.entries(triggers)) {
    specs.push({
      id: name,
      kind: 'trigger',
      container: 'triggers',
      title: name,
      tag: tagFor('trigger', trigger),
      meta: triggerMeta(trigger),
    })
  }

  for (const [name, step] of Object.entries(steps)) {
    if (name in triggers) continue
    const kind = stepKind(step)
    let title = name
    if (kind === 'agent' && step.agent) title = displayName(agentBySlug.get(step.agent), step.agent)
    if (kind === 'squad' && step.squad) title = displayName(squadBySlug.get(step.squad), step.squad)
    specs.push({
      id: name,
      kind,
      container: 'steps',
      title,
      tag: tagFor(kind, step),
      meta: stepMeta(step, kind),
    })
  }

  const ids = new Set(specs.map((s) => s.id))
  const marker = { type: MarkerType.ArrowClosed, width: 14, height: 14, color: '#1A1A1B' }
  // Router edge labels: DM Mono uppercase tags (SVG text — uppercase the string itself).
  const labelStyle = {
    fontFamily: "'DM Mono', 'Courier New', monospace",
    fontSize: 11,
    letterSpacing: '0.08em',
    fill: '#2A2A2C',
  }
  const labelBgStyle = { fill: '#F5EFE0', stroke: 'rgba(184, 0, 28, 0.22)', strokeWidth: 1 }

  const addEdges = (source: string, def: TriggerDef | StepDef) => {
    for (const target of targetsOf(def.next)) {
      if (!ids.has(target)) continue
      edges.push({ id: `${source}→${target}`, source, target, markerEnd: marker })
    }
    const routes = (def as StepDef).routes
    if (routes) {
      for (const [label, target] of Object.entries(routes)) {
        if (!ids.has(target)) continue
        edges.push({
          id: `${source}→${target}:${label}`,
          source,
          target,
          label: label.toUpperCase(),
          labelStyle,
          labelBgStyle,
          labelBgPadding: [6, 3],
          labelBgBorderRadius: 2,
          markerEnd: marker,
        })
      }
    }
  }

  for (const [name, trigger] of Object.entries(triggers)) addEdges(name, trigger)
  for (const [name, step] of Object.entries(steps)) {
    if (!(name in triggers)) addEdges(name, step)
  }

  // Auto-layout, left → right
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 48, ranksep: 110, marginx: 40, marginy: 40 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const spec of specs) {
    g.setNode(spec.id, { width: NODE_WIDTH, height: NODE_HEIGHT[spec.kind] })
  }
  for (const edge of edges) g.setEdge(edge.source, edge.target)
  dagre.layout(g)

  const nodes: HarnessFlowNode[] = specs.map((spec) => {
    const pos = g.node(spec.id)
    return {
      id: spec.id,
      type: 'harness',
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT[spec.kind] / 2,
      },
      data: {
        kind: spec.kind,
        container: spec.container,
        name: spec.id,
        title: spec.title,
        tag: spec.tag,
        meta: spec.meta,
      },
    }
  })

  return { nodes, edges }
}
