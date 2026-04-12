import { type FC, useMemo } from 'react';
import { X, ArrowRight, AlertTriangle, GitMerge, Cable } from 'lucide-react';
import { useHarnessStore, type StepNodeData } from '../store/useHarnessStore';
import type { Node, Edge } from '@xyflow/react';
import type { HarnessEdgeData } from '../store/useHarnessStore';

type HNode = Node<StepNodeData>;

interface ShapeBranch {
  fields: Record<string, string> | null; // null = untyped
  originStepLabel: string;
  source: 'declared' | 'inferred';
}

/** Walk backwards from a node and collect every distinct payload branch
 * that converges into it. A branch terminates at:
 *   - a step with a declared output schema (the schema is the branch shape)
 *   - a trigger (untyped if no schema declared)
 *   - an orphan node with no incoming edges
 *
 * Per D33 (fan-in always appends), if a node has N incoming edges, every
 * branch reachable through any of them is part of the payload that arrives.
 */
function collectShapeBranches(
  nodeId: string,
  nodes: HNode[],
  edges: Edge<HarnessEdgeData>[],
  visited: Set<string> = new Set(),
): ShapeBranch[] {
  // Per-traversal cycle guard. Cloned at each fork so two distinct paths
  // through a DAG are both explored.
  if (visited.has(nodeId)) return [];
  const nextVisited = new Set(visited);
  nextVisited.add(nodeId);

  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return [];
  const data = node.data;

  // Terminal: explicit declaration
  if (data.outputSchema && Object.keys(data.outputSchema).length > 0) {
    return [{
      fields: data.outputSchema,
      originStepLabel: data.label,
      source: 'declared',
    }];
  }

  // Terminal: trigger leaf
  if (data.stepType === 'trigger') {
    return [{
      fields: null,
      originStepLabel: data.label,
      source: 'inferred',
    }];
  }

  // Recurse through incoming edges, collecting every branch
  const incoming = edges.filter((e) => e.target === nodeId);
  if (incoming.length === 0) {
    return [{ fields: null, originStepLabel: data.label, source: 'inferred' }];
  }

  return incoming.flatMap((inc) =>
    collectShapeBranches(inc.source, nodes, edges, nextVisited),
  );
}

/** Compare two flat schemas. Returns true if they have the same keys and types. */
function schemasEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k, i) => bKeys[i] === k && a[k] === b[k]);
}

/** Stable serialization of a branch shape for dedup / comparison. */
function shapeKey(fields: Record<string, string> | null): string {
  if (!fields) return '__untyped__';
  return Object.keys(fields)
    .sort()
    .map((k) => `${k}:${fields[k]}`)
    .join('|');
}

/** Are these branches all the same shape? */
function branchesHomogeneous(branches: ShapeBranch[]): boolean {
  if (branches.length <= 1) return true;
  const first = shapeKey(branches[0].fields);
  return branches.every((b) => shapeKey(b.fields) === first);
}

const SectionLabel: FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    className="text-[9px] font-semibold uppercase tracking-[0.14em] mb-2"
    style={{ color: 'var(--color-text-3)' }}
  >
    {children}
  </div>
);

const UntypedNotice: FC<{ compact?: boolean }> = ({ compact }) => (
  <div
    className={`text-[10px] rounded-md ${compact ? 'px-2.5 py-1.5' : 'px-3 py-2'}`}
    style={{
      background: 'var(--color-surface-2)',
      border: '1px dashed var(--color-border-2)',
      color: 'var(--color-text-3)',
      fontStyle: 'italic',
    }}
  >
    {compact ? (
      'Untyped — no schema declared along this branch.'
    ) : (
      <>
        Untyped — payload flows through unchanged. Declare an{' '}
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-2)' }}>output</span>{' '}
        schema on the source step to make it explicit.
      </>
    )}
  </div>
);

const SchemaBlock: FC<{ schema: Record<string, string>; tone: 'amber' | 'blue' | 'pink' | 'mute' }> = ({ schema, tone }) => {
  const colors = {
    amber: { bg: 'var(--color-amber-soft)', border: 'rgba(232,149,42,0.25)', key: 'var(--color-amber)' },
    blue:  { bg: 'var(--color-blue-soft)',  border: 'rgba(61,139,253,0.25)', key: 'var(--color-blue)' },
    pink:  { bg: 'var(--color-pink-soft)',  border: 'rgba(232,112,168,0.25)', key: 'var(--color-pink)' },
    mute:  { bg: 'var(--color-surface-2)',  border: 'var(--color-border-1)',  key: 'var(--color-text-2)' },
  }[tone];
  const entries = Object.entries(schema);
  return (
    <div
      className="rounded-lg p-2.5"
      style={{ background: colors.bg, border: `1px solid ${colors.border}` }}
    >
      <pre
        className="text-[11px] leading-relaxed m-0"
        style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-1)', whiteSpace: 'pre-wrap' }}
      >
        {'{\n'}
        {entries.map(([name, type], i) => (
          <span key={name}>
            {'  '}
            <span style={{ color: colors.key }}>{name}</span>
            <span style={{ color: 'var(--color-text-3)' }}>: </span>
            <span style={{ color: 'var(--color-text-2)' }}>{type}</span>
            {i < entries.length - 1 ? ',' : ''}
            {'\n'}
          </span>
        ))}
        {'}'}
      </pre>
    </div>
  );
};

const EdgeInspector: FC = () => {
  const { inspectingEdgeId, setInspectingEdge, edges, nodes } = useHarnessStore();

  const edge = useMemo(
    () => edges.find((e) => e.id === inspectingEdgeId),
    [edges, inspectingEdgeId],
  );

  const sourceNode = useMemo(
    () => (edge ? nodes.find((n) => n.id === edge.source) : undefined),
    [edge, nodes],
  );
  const targetNode = useMemo(
    () => (edge ? nodes.find((n) => n.id === edge.target) : undefined),
    [edge, nodes],
  );

  // All distinct payload branches that flow down THIS edge — collected by
  // recursively walking back from the source. Multiple branches mean fan-in
  // happened somewhere upstream.
  const branches = useMemo(() => {
    if (!edge) return [];
    return collectShapeBranches(edge.source, nodes as HNode[], edges);
  }, [edge, nodes, edges]);

  const branchesAreHeterogeneous = useMemo(() => !branchesHomogeneous(branches), [branches]);

  // Per-immediate-incoming-edge analysis at the target node, used only when
  // the target has multiple direct incoming edges (a "local" fan-in point).
  const fanInAnalysis = useMemo(() => {
    if (!edge || !targetNode) return null;
    const incoming = edges.filter((e) => e.target === targetNode.id);
    if (incoming.length <= 1) return null;
    const perEdge = incoming.map((inc) => {
      const src = nodes.find((n) => n.id === inc.source) as HNode | undefined;
      const incBranches = collectShapeBranches(inc.source, nodes as HNode[], edges);
      return {
        edgeId: inc.id,
        sourceLabel: src?.data.label || inc.source,
        branches: incBranches,
      };
    });
    // All branches arriving at the target, flattened
    const all = perEdge.flatMap((e) => e.branches);
    const heterogeneous = !branchesHomogeneous(all);
    return { perEdge, heterogeneous };
  }, [edge, targetNode, nodes, edges]);

  if (!edge || !sourceNode || !targetNode) return null;

  const targetData = targetNode.data;
  const declaredInput =
    targetData.stepType === 'output' && targetData.inputSchema && Object.keys(targetData.inputSchema).length > 0
      ? targetData.inputSchema
      : null;

  // For matching against declaredInput, check if any branch matches
  const anyBranchMatchesDeclared =
    declaredInput
      ? branches.some((b) => b.fields && schemasEqual(b.fields, declaredInput))
      : false;

  const edgeData = (edge.data || {}) as HarnessEdgeData;
  const isError = edgeData.isError || edge.sourceHandle === 'error';
  const isRoute = edgeData.routeLabel || edge.sourceHandle === 'route';

  return (
    <div
      className="fixed top-4 right-4 z-40 flex flex-col"
      style={{
        width: 340,
        maxHeight: 'calc(100vh - 32px)',
        background: 'var(--color-surface-1)',
        border: '1px solid var(--color-border-2)',
        borderRadius: 16,
        boxShadow: '0 24px 64px var(--color-shadow)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid var(--color-border-1)' }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{
              background: isError ? 'var(--color-red-soft)' : isRoute ? 'var(--color-purple-soft)' : 'var(--color-amber-soft)',
              border: `1px solid ${isError ? 'rgba(239,96,96,0.3)' : isRoute ? 'rgba(155,122,255,0.3)' : 'rgba(232,149,42,0.3)'}`,
            }}
          >
            <Cable size={13} style={{ color: isError ? 'var(--color-red)' : isRoute ? 'var(--color-purple)' : 'var(--color-amber)' }} />
          </div>
          <div>
            <div className="text-[12px] font-semibold" style={{ color: 'var(--color-text-1)' }}>
              Edge inspector
            </div>
            <div className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--color-text-3)' }}>
              {isError ? 'Error path' : isRoute ? `Route · ${edgeData.routeLabel}` : 'Data flow'}
            </div>
          </div>
        </div>
        <button
          onClick={() => setInspectingEdge(null)}
          className="p-1.5 bg-transparent border-none cursor-pointer rounded transition-colors"
          style={{ color: 'var(--color-text-3)' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-1)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-3)'; }}
        >
          <X size={14} />
        </button>
      </div>

      <div className="overflow-y-auto px-4 py-4 space-y-4">
        {/* From → To */}
        <div className="flex items-center gap-2 text-[11px]">
          <div className="flex-1 min-w-0 px-2 py-1.5 rounded-md truncate"
            style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border-1)', color: 'var(--color-text-1)' }}>
            <span className="font-medium">{sourceNode.data.label}</span>
            <span className="ml-1.5 text-[9px]" style={{ color: 'var(--color-text-3)' }}>{sourceNode.data.stepType}</span>
          </div>
          <ArrowRight size={12} style={{ color: 'var(--color-text-3)' }} />
          <div className="flex-1 min-w-0 px-2 py-1.5 rounded-md truncate"
            style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border-1)', color: 'var(--color-text-1)' }}>
            <span className="font-medium">{targetNode.data.label}</span>
            <span className="ml-1.5 text-[9px]" style={{ color: 'var(--color-text-3)' }}>{targetNode.data.stepType}</span>
          </div>
        </div>

        {/* Payload shape — one or more branches */}
        <div>
          <SectionLabel>
            Payload shape{branches.length > 1 ? ` (${branches.length} branches)` : ''}
          </SectionLabel>

          {branches.length === 0 ? (
            <UntypedNotice />
          ) : branches.length === 1 ? (
            branches[0].fields ? (
              <>
                <SchemaBlock schema={branches[0].fields} tone={branches[0].source === 'declared' ? 'blue' : 'mute'} />
                <div className="text-[9px] mt-1.5" style={{ color: 'var(--color-text-3)' }}>
                  {branches[0].source === 'declared'
                    ? `Declared by ${branches[0].originStepLabel}`
                    : `Inferred from upstream (${branches[0].originStepLabel})`}
                </div>
              </>
            ) : (
              <UntypedNotice />
            )
          ) : (
            <div className="flex flex-col gap-2.5">
              {branches.map((b, i) => (
                <div key={`${b.originStepLabel}-${i}`}>
                  <div
                    className="text-[9px] uppercase tracking-wider mb-1 flex items-center gap-1.5"
                    style={{ color: 'var(--color-text-3)' }}
                  >
                    <span
                      className="inline-flex items-center justify-center text-[8px] font-bold rounded-full"
                      style={{
                        width: 14,
                        height: 14,
                        background: 'var(--color-surface-3)',
                        color: 'var(--color-text-2)',
                      }}
                    >
                      {i + 1}
                    </span>
                    From {b.originStepLabel}
                  </div>
                  {b.fields ? (
                    <SchemaBlock schema={b.fields} tone={b.source === 'declared' ? 'blue' : 'mute'} />
                  ) : (
                    <UntypedNotice compact />
                  )}
                </div>
              ))}
              {branchesAreHeterogeneous && (
                <div
                  className="mt-1 px-2.5 py-2 rounded-md flex items-start gap-2 text-[10px]"
                  style={{
                    background: 'var(--color-amber-soft)',
                    border: '1px solid rgba(232,149,42,0.28)',
                    color: 'var(--color-amber)',
                  }}
                >
                  <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>
                    Branches above will be <strong>appended</strong> per D33. The downstream
                    step receives all of them concatenated, in arrival order.
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Target expectation */}
        {declaredInput && (
          <div>
            <SectionLabel>Target expects</SectionLabel>
            <SchemaBlock schema={declaredInput} tone="pink" />
            {branches.some((b) => b.fields) && !anyBranchMatchesDeclared && (
              <div
                className="mt-2 px-2.5 py-2 rounded-md flex items-start gap-2 text-[10px]"
                style={{
                  background: 'var(--color-amber-soft)',
                  border: '1px solid rgba(232,149,42,0.28)',
                  color: 'var(--color-amber)',
                }}
              >
                <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>
                  No upstream branch matches the declared input schema. Pass-through; no
                  validation is enforced.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Local fan-in at target — only when target has 2+ direct incoming edges */}
        {fanInAnalysis && (
          <div>
            <SectionLabel>
              Fan-in at {targetNode.data.label} ({fanInAnalysis.perEdge.length} edges)
            </SectionLabel>
            <div className="flex flex-col gap-1.5">
              {fanInAnalysis.perEdge.map((inc) => {
                const summary = inc.branches
                  .map((b) =>
                    b.fields ? `{ ${Object.keys(b.fields).join(', ')} }` : 'untyped',
                  )
                  .join(' · ');
                return (
                  <div
                    key={inc.edgeId}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[10px]"
                    style={{
                      background: 'var(--color-surface-2)',
                      border: `1px solid ${inc.edgeId === edge.id ? 'var(--color-amber)' : 'var(--color-border-1)'}`,
                    }}
                  >
                    <GitMerge size={11} style={{ color: 'var(--color-text-3)', flexShrink: 0 }} />
                    <div className="min-w-0 flex-1 truncate">
                      <span style={{ color: 'var(--color-text-1)' }}>{inc.sourceLabel}</span>
                      <span className="ml-1.5" style={{ color: 'var(--color-text-3)' }}>
                        {summary}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            {fanInAnalysis.heterogeneous && (
              <div
                className="mt-2 px-2.5 py-2 rounded-md flex items-start gap-2 text-[10px]"
                style={{
                  background: 'var(--color-amber-soft)',
                  border: '1px solid rgba(232,149,42,0.28)',
                  color: 'var(--color-amber)',
                }}
              >
                <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>
                  Heterogeneous payloads will be appended (per spec D33). Add an agent step
                  before <strong>{targetNode.data.label}</strong> if you need a custom merge.
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default EdgeInspector;
