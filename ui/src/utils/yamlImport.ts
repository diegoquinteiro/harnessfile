import yaml from 'js-yaml';
import type { Node, Edge } from '@xyflow/react';
import type { StepNodeData, HarnessEdgeData } from '../store/useHarnessStore';
import type {
  HarnessFile, Agent, Step, StepType,
  Observability, Memory, Security, Resilience, HooksConfig,
  AgentStep, TriggerStep, OutputStep, GateStep, OrchestratorStep,
  RetryConfig,
} from '../types/harnessfile';

export interface ParsedHarness {
  harnessName: string;
  agents: Record<string, Agent>;
  nodes: Node<StepNodeData, 'harnessNode'>[];
  edges: Edge<HarnessEdgeData>[];
  observability: Observability;
  memory: Memory | null;
  security: Security;
  resilience: Resilience;
  hooks: HooksConfig;
}

function humanize(id: string): string {
  return id
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function inferType(step: Step): StepType {
  if (step.type) return step.type;
  // Agent step may omit type
  if ((step as AgentStep).agent) return 'agent';
  return 'agent';
}

function stepToNodeData(id: string, step: Step): StepNodeData {
  const stepType = inferType(step);
  const data: StepNodeData = {
    label: humanize(id),
    stepType,
  };

  switch (stepType) {
    case 'agent': {
      const s = step as AgentStep;
      if (s.agent) data.agent = s.agent;
      if (s.eval) data.eval = s.eval;
      if (s['max-iterations']) data.maxIterations = s['max-iterations'];
      if (s.context) data.context = s.context;
      if (s.output && Object.keys(s.output).length > 0) data.outputSchema = s.output;
      break;
    }
    case 'trigger': {
      const s = step as TriggerStep;
      if (s.event) data.event = s.event;
      if (s.filter) data.filter = s.filter;
      if (typeof s.provider === 'string') data.provider = s.provider;
      if (s.output && Object.keys(s.output).length > 0) data.outputSchema = s.output;
      break;
    }
    case 'output': {
      const s = step as OutputStep;
      if (s.input && Object.keys(s.input).length > 0) data.inputSchema = s.input;
      break;
    }
    case 'gate': {
      const s = step as GateStep;
      data.approve = 'human';
      if (typeof s.provider === 'string') data.provider = s.provider;
      if (s.channel) data.channel = s.channel;
      if (s.timeout) data.timeout = s.timeout;
      if (s.fallback) data.fallback = s.fallback;
      break;
    }
    case 'router': {
      const s = step as unknown as { agent?: string };
      if (s.agent) data.agent = s.agent;
      break;
    }
    case 'orchestrator': {
      const s = step as OrchestratorStep;
      if (s.agent) data.agent = s.agent;
      if (s.pool) data.pool = s.pool;
      if (s['max-agents']) data.maxAgents = s['max-agents'];
      break;
    }
  }

  // Common error-handling fields
  if (step.retry !== undefined) {
    data.retry = typeof step.retry === 'number'
      ? step.retry
      : (step.retry as RetryConfig).max;
  }
  const onErr = step['on-error'];
  if (onErr && onErr !== 'fail') data.onError = onErr;
  if (stepType !== 'gate' && step.timeout) data.timeout = step.timeout;

  return data;
}

interface RawEdge {
  source: string;
  target: string;
  routeLabel?: string;
}

function extractEdges(stepsMap: Record<string, Step>): RawEdge[] {
  const edges: RawEdge[] = [];
  for (const [id, step] of Object.entries(stepsMap)) {
    // Router: routes dict → labelled edges
    const maybeRoutes = (step as unknown as { routes?: Record<string, string> }).routes;
    if (step.type === 'router' || maybeRoutes) {
      const routes = maybeRoutes || {};
      for (const [label, target] of Object.entries(routes)) {
        edges.push({ source: id, target, routeLabel: label });
      }
    }
    // Normal next (string or array)
    const next = step.next;
    if (next) {
      if (Array.isArray(next)) {
        for (const t of next) edges.push({ source: id, target: t });
      } else {
        edges.push({ source: id, target: next });
      }
    }
  }
  return edges;
}

/** Simple BFS layering: x = level * X_GAP, y = centered within level */
function layout(
  stepIds: string[],
  edges: RawEdge[],
): Map<string, { x: number; y: number }> {
  const X_GAP = 300;
  const Y_GAP = 140;

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  for (const id of stepIds) {
    outgoing.set(id, []);
    incoming.set(id, 0);
  }
  for (const e of edges) {
    if (!outgoing.has(e.source) || !incoming.has(e.target)) continue;
    outgoing.get(e.source)!.push(e.target);
    incoming.set(e.target, (incoming.get(e.target) || 0) + 1);
  }

  const levels = new Map<string, number>();
  const queue: string[] = [];
  for (const id of stepIds) {
    if ((incoming.get(id) || 0) === 0) {
      levels.set(id, 0);
      queue.push(id);
    }
  }

  // BFS: use maximum level among predecessors
  while (queue.length) {
    const id = queue.shift()!;
    const lvl = levels.get(id) ?? 0;
    for (const next of outgoing.get(id) || []) {
      const prev = levels.get(next);
      if (prev === undefined || prev < lvl + 1) {
        levels.set(next, lvl + 1);
        queue.push(next);
      }
    }
  }

  // Orphans / cycles → level 0
  let orphanLevel = 0;
  for (const id of stepIds) {
    if (!levels.has(id)) {
      levels.set(id, orphanLevel);
    }
  }

  // Group by level
  const byLevel = new Map<number, string[]>();
  for (const id of stepIds) {
    const lvl = levels.get(id)!;
    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
    byLevel.get(lvl)!.push(id);
  }

  // Position
  const positions = new Map<string, { x: number; y: number }>();
  for (const [lvl, ids] of byLevel) {
    const centerOffset = -((ids.length - 1) * Y_GAP) / 2;
    ids.forEach((id, i) => {
      positions.set(id, {
        x: lvl * X_GAP,
        y: 200 + centerOffset + i * Y_GAP,
      });
    });
  }

  return positions;
}

export function importFromYaml(text: string): ParsedHarness {
  const parsed = yaml.load(text) as HarnessFile | null;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid YAML: expected a harness document');
  }

  const stepsMap = parsed.steps || {};
  const stepIds = Object.keys(stepsMap);
  const agents = parsed.agents || {};

  const rawEdges = extractEdges(stepsMap);
  const positions = layout(stepIds, rawEdges);

  // Build nodes
  const nodes: Node<StepNodeData, 'harnessNode'>[] = stepIds.map((id, i) => {
    const pos = positions.get(id) || { x: i * 300, y: 200 };
    return {
      id: `step_${i + 1}`,
      type: 'harnessNode',
      position: pos,
      data: stepToNodeData(id, stepsMap[id]),
    };
  });

  // Map original step IDs → node IDs
  const idMap = new Map<string, string>();
  stepIds.forEach((id, i) => idMap.set(id, `step_${i + 1}`));

  // Build edges
  const edges: Edge<HarnessEdgeData>[] = [];
  rawEdges.forEach((e, i) => {
    const source = idMap.get(e.source);
    const target = idMap.get(e.target);
    if (!source || !target) return;
    edges.push({
      id: `e_${i}_${Date.now()}`,
      source,
      target,
      sourceHandle: e.routeLabel ? 'route' : undefined,
      targetHandle: 'input',
      type: 'harnessEdge',
      data: e.routeLabel ? { routeLabel: e.routeLabel } : {},
    });
  });

  return {
    harnessName: parsed.name || 'untitled',
    agents,
    nodes,
    edges,
    observability: parsed.observability || {},
    memory: parsed.memory || null,
    security: parsed.security || {},
    resilience: parsed.resilience || {},
    hooks: parsed.hooks || {},
  };
}
