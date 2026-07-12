import yaml from 'js-yaml';
import type { Node, Edge } from '@xyflow/react';
import type { StepNodeData, HarnessEdgeData } from '../store/useHarnessStore';
import type { Agent, Observability, Memory, Security, Resilience, HooksConfig } from '../types/harnessfile';

function clean(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0)) continue;
    if (typeof val === 'object' && !Array.isArray(val)) {
      const cleaned = clean(val as Record<string, unknown>);
      if (Object.keys(cleaned).length > 0) result[key] = cleaned;
    } else {
      result[key] = val;
    }
  }
  return result;
}

function toStepId(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'step';
}

export function exportToYaml(
  nodes: Node<StepNodeData>[],
  edges: Edge<HarnessEdgeData>[],
  agents: Record<string, Agent>,
  harnessName: string,
  observability: Observability,
  memory: Memory | null,
  security: Security,
  resilience: Resilience,
  hooks: HooksConfig,
): string {
  // Build step ID map
  const stepIdMap = new Map<string, string>();
  const usedIds = new Set<string>();
  for (const node of nodes) {
    let id = toStepId(node.data.label);
    let suffix = 1;
    const base = id;
    while (usedIds.has(id)) id = `${base}-${suffix++}`;
    usedIds.add(id);
    stepIdMap.set(node.id, id);
  }

  // Categorize edges by source
  const normalEdges = new Map<string, string[]>();   // source -> target step IDs
  const routeEdges = new Map<string, Record<string, string>>(); // source -> { label: target step ID }
  const errorEdges = new Map<string, string>();      // source -> target step ID

  for (const edge of edges) {
    const targetId = stepIdMap.get(edge.target);
    if (!targetId) continue;
    const data = (edge.data || {}) as HarnessEdgeData;

    if (data.isError || edge.sourceHandle === 'error') {
      errorEdges.set(edge.source, targetId);
    } else if (data.routeLabel || edge.sourceHandle === 'route') {
      const routes = routeEdges.get(edge.source) || {};
      routes[data.routeLabel || 'route'] = targetId;
      routeEdges.set(edge.source, routes);
    } else {
      const targets = normalEdges.get(edge.source) || [];
      targets.push(targetId);
      normalEdges.set(edge.source, targets);
    }
  }

  // Build steps
  const steps: Record<string, Record<string, unknown>> = {};
  for (const node of nodes) {
    const data = node.data as StepNodeData;
    const stepId = stepIdMap.get(node.id)!;
    const nextSteps = normalEdges.get(node.id);
    const next = nextSteps?.length === 1 ? nextSteps[0] : nextSteps?.length ? nextSteps : undefined;

    let step: Record<string, unknown> = {};

    switch (data.stepType) {
      case 'trigger':
        step = {
          type: 'trigger',
          event: data.event || 'webhook',
          ...(data.filter && { filter: data.filter }),
          ...(data.provider && { provider: data.provider }),
          ...(data.outputSchema && Object.keys(data.outputSchema).length > 0 && { output: data.outputSchema }),
        };
        break;
      case 'output':
        step = {
          type: 'output',
          ...(data.inputSchema && Object.keys(data.inputSchema).length > 0 && { input: data.inputSchema }),
        };
        break;
      case 'gate':
        step = {
          type: 'gate',
          approve: 'human',
          ...(data.provider && { provider: data.provider }),
          ...(data.channel && { channel: data.channel }),
          ...(data.timeout && { timeout: data.timeout }),
          ...(data.fallback && data.fallback !== 'reject' && { fallback: data.fallback }),
        };
        break;
      case 'router': {
        const routes = routeEdges.get(node.id) || {};
        step = {
          type: 'router',
          agent: data.agent,
          routes,
        };
        break;
      }
      case 'orchestrator':
        step = {
          type: 'orchestrator',
          agent: data.agent,
          pool: data.pool || [],
          ...(data.maxAgents && { 'max-agents': data.maxAgents }),
        };
        break;
      default: // agent
        step = {
          agent: data.agent,
          ...(data.eval?.length && { eval: data.eval }),
          ...(data.maxIterations && data.eval?.length && { 'max-iterations': data.maxIterations }),
          ...(data.context && { context: data.context }),
          ...(data.outputSchema && Object.keys(data.outputSchema).length > 0 && { output: data.outputSchema }),
        };
        break;
    }

    // Error handling
    if (data.timeout && data.stepType !== 'gate') step.timeout = data.timeout;
    if (data.retry && data.retry > 0) step.retry = data.retry;

    // Error edge -> on-error: skip + next points to error target
    const errorTarget = errorEdges.get(node.id);
    if (errorTarget) {
      step['on-error'] = 'skip';
    } else if (data.onError && data.onError !== 'fail') {
      step['on-error'] = data.onError;
    }

    // Next — for routers, routes already encode the next, but they may also have a normal next
    if (data.stepType !== 'router' && next) step.next = next;

    steps[stepId] = clean(step);
  }

  // Build harness
  const harness: Record<string, unknown> = {
    harnessfile: '0.1',
    ...(harnessName && harnessName !== 'my-harness' && { name: harnessName }),
  };

  const cleanObs = clean(observability as unknown as Record<string, unknown>);
  if (Object.keys(cleanObs).length > 0) harness.observability = cleanObs;

  if (memory) {
    const cleanMem = clean(memory as unknown as Record<string, unknown>);
    if (Object.keys(cleanMem).length > 0) harness.memory = cleanMem;
  }

  const cleanSec = clean(security as unknown as Record<string, unknown>);
  if (Object.keys(cleanSec).length > 0) harness.security = cleanSec;

  const cleanRes = clean(resilience as unknown as Record<string, unknown>);
  if (Object.keys(cleanRes).length > 0) harness.resilience = cleanRes;

  const cleanHooks = clean(hooks as unknown as Record<string, unknown>);
  if (Object.keys(cleanHooks).length > 0) harness.hooks = cleanHooks;

  if (Object.keys(agents).length > 0) harness.agents = agents;
  if (Object.keys(steps).length > 0) harness.steps = steps;

  return yaml.dump(harness, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
    forceQuotes: false,
  });
}
