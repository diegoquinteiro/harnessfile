import { memo, type FC, useState, useRef, useEffect, useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  Zap, Bot, ShieldCheck, GitFork, Workflow, LogOut,
  Plus, X,
  type LucideIcon,
} from 'lucide-react';
import type { StepNodeData } from '../store/useHarnessStore';
import { useHarnessStore } from '../store/useHarnessStore';
import type { EvalConfig, StepType } from '../types/harnessfile';
import TagInput from './TagInput';
import MarkdownTextarea from './MarkdownTextarea';

const typeConfig: Record<string, { icon: LucideIcon; color: string; colorSoft: string; border: string }> = {
  trigger:      { icon: Zap,         color: 'var(--color-amber)',  colorSoft: 'var(--color-amber-soft)',  border: 'rgba(232,149,42,0.35)' },
  agent:        { icon: Bot,         color: 'var(--color-blue)',   colorSoft: 'var(--color-blue-soft)',   border: 'rgba(61,139,253,0.35)' },
  gate:         { icon: ShieldCheck, color: 'var(--color-green)',  colorSoft: 'var(--color-green-soft)',  border: 'rgba(45,212,160,0.35)' },
  router:       { icon: GitFork,     color: 'var(--color-purple)', colorSoft: 'var(--color-purple-soft)', border: 'rgba(155,122,255,0.35)' },
  orchestrator: { icon: Workflow,    color: 'var(--color-cyan)',   colorSoft: 'var(--color-cyan-soft)',   border: 'rgba(32,200,221,0.35)' },
  output:       { icon: LogOut,      color: 'var(--color-pink)',   colorSoft: 'var(--color-pink-soft)',   border: 'rgba(232,112,168,0.35)' },
};

// --- Shared inline form primitives ---

const stopEvent = (e: React.SyntheticEvent) => { e.stopPropagation(); };
const stopMouse = { onClick: stopEvent, onMouseDown: stopEvent };

const InlineField: FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  small?: boolean;
}> = ({ value, onChange, placeholder, mono, small }) => (
  <input
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    className="nodrag w-full rounded-md px-2 py-1 outline-none transition-colors"
    style={{
      background: 'var(--color-surface-0)',
      border: '1px solid var(--color-border-1)',
      color: 'var(--color-text-1)',
      fontSize: small ? '10px' : '11px',
      fontFamily: mono ? 'var(--font-mono)' : 'inherit',
    }}
    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-amber)'; }}
    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--color-border-1)'; }}
    {...stopMouse}
  />
);

const InlineSelect: FC<{
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}> = ({ value, onChange, options, placeholder }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className="nodrag w-full rounded-md px-2 py-1 outline-none cursor-pointer appearance-none"
    style={{
      background: 'var(--color-surface-0)',
      border: '1px solid var(--color-border-1)',
      color: value ? 'var(--color-text-1)' : 'var(--color-text-3)',
      fontSize: '11px',
    }}
    {...stopMouse}
  >
    {placeholder && <option value="">{placeholder}</option>}
    {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
);

const FieldLabel: FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-[9px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--color-text-3)' }}>
    {children}
  </div>
);

// --- Eval editor (used inside Agent & Orchestrator editors) ---

const EvalEditor: FC<{ evals: EvalConfig[]; maxIterations?: number; update: (d: Partial<StepNodeData>) => void }> = ({ evals, maxIterations, update }) => {
  const agents = useHarnessStore((s) => s.agents);
  const agentNames = Object.keys(agents);
  const addEval = () => {
    update({ eval: [...evals, { metric: '', type: 'code', pass: true }] });
  };
  const removeEval = (i: number) => {
    const next = evals.filter((_, idx) => idx !== i);
    update({ eval: next });
  };
  const updateEval = (i: number, partial: Partial<EvalConfig>) => {
    const next = evals.map((ev, idx) => idx === i ? { ...ev, ...partial } : ev);
    update({ eval: next });
  };

  return (
    <div className="mt-2 rounded-lg p-2" style={{ background: 'var(--color-surface-0)', border: '1px solid rgba(45,212,160,0.2)' }}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-green)' }} />
          <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-green)' }}>
            Evaluations
          </span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); addEval(); }}
          onMouseDown={stopEvent}
          className="flex items-center gap-0.5 text-[9px] font-medium rounded-md px-1.5 py-0.5 cursor-pointer bg-transparent border-none transition-colors"
          style={{ color: 'var(--color-green)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-green-soft)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <Plus size={10} /> Add
        </button>
      </div>

      {evals.length === 0 && (
        <div className="text-[9px] py-1" style={{ color: 'var(--color-text-3)' }}>
          No evals. Add one to validate this step's output.
        </div>
      )}

      <div className="space-y-1.5">
        {evals.map((ev, i) => (
          <div key={i} className="rounded-md p-1.5 space-y-1" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border-1)' }}>
            <div className="flex items-center gap-1">
              <input
                value={ev.metric}
                onChange={(e) => updateEval(i, { metric: e.target.value })}
                placeholder="metric name"
                className="nodrag flex-1 rounded px-1.5 py-0.5 outline-none text-[10px]"
                style={{ background: 'var(--color-surface-0)', border: '1px solid var(--color-border-1)', color: 'var(--color-text-1)', fontFamily: 'var(--font-mono)' }}
                {...stopMouse}
              />
              <select
                value={ev.type || 'code'}
                onChange={(e) => updateEval(i, { type: e.target.value as 'code' | 'llm' | 'human' })}
                className="nodrag rounded px-1 py-0.5 outline-none cursor-pointer appearance-none text-[9px]"
                style={{ background: 'var(--color-surface-0)', border: '1px solid var(--color-border-1)', color: 'var(--color-text-2)' }}
                {...stopMouse}
              >
                <option value="code">code</option>
                <option value="llm">llm</option>
                <option value="human">human</option>
              </select>
              <button
                onClick={(e) => { e.stopPropagation(); removeEval(i); }}
                onMouseDown={stopEvent}
                className="p-0.5 bg-transparent border-none cursor-pointer shrink-0 rounded transition-colors"
                style={{ color: 'var(--color-text-3)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-red)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-3)'; }}
              >
                <X size={10} />
              </button>
            </div>
            {ev.type === 'llm' && (
              <>
                <div className="flex items-center gap-1">
                  <span className="text-[8px] shrink-0" style={{ color: 'var(--color-text-3)' }}>judge:</span>
                  <select
                    value={ev.agent || ''}
                    onChange={(e) => updateEval(i, { agent: e.target.value || undefined })}
                    className="nodrag flex-1 rounded px-1.5 py-0.5 outline-none cursor-pointer appearance-none text-[9px]"
                    style={{ background: 'var(--color-surface-0)', border: '1px solid var(--color-border-1)', color: ev.agent ? 'var(--color-text-1)' : 'var(--color-text-3)' }}
                    {...stopMouse}
                  >
                    <option value="">default model</option>
                    {agentNames.map((name) => (
                      <option key={name} value={name}>{name} ({agents[name].model.split('/').pop()})</option>
                    ))}
                  </select>
                </div>
                <MarkdownTextarea
                  value={ev.prompt || ''}
                  onChange={(v) => updateEval(i, { prompt: v })}
                  placeholder="Evaluation prompt..."
                  minRows={2}
                  maxRows={6}
                />
              </>
            )}
            <div className="flex items-center gap-1">
              <span className="text-[8px] shrink-0" style={{ color: 'var(--color-text-3)' }}>pass:</span>
              <input
                value={String(ev.pass ?? 'true')}
                onChange={(e) => {
                  const val = e.target.value;
                  const num = parseFloat(val);
                  updateEval(i, { pass: isNaN(num) ? (val === 'true' ? true : val) : num });
                }}
                className="nodrag flex-1 rounded px-1.5 py-0.5 outline-none text-[9px]"
                style={{ background: 'var(--color-surface-0)', border: '1px solid var(--color-border-1)', color: 'var(--color-text-1)', fontFamily: 'var(--font-mono)' }}
                {...stopMouse}
              />
            </div>
          </div>
        ))}
      </div>

      {evals.length > 0 && (
        <div className="flex items-center gap-1.5 mt-1.5">
          <span className="text-[8px] shrink-0" style={{ color: 'var(--color-text-3)' }}>max retries:</span>
          <input
            value={String(maxIterations || 3)}
            onChange={(e) => update({ maxIterations: parseInt(e.target.value) || 3 })}
            type="number"
            min={1}
            className="nodrag w-12 rounded px-1.5 py-0.5 outline-none text-[10px]"
            style={{ background: 'var(--color-surface-0)', border: '1px solid var(--color-border-1)', color: 'var(--color-text-1)', fontFamily: 'var(--font-mono)' }}
            {...stopMouse}
          />
        </div>
      )}
    </div>
  );
};

// --- Type-specific inline editors ---

const TriggerEditor: FC<{ data: StepNodeData; update: (d: Partial<StepNodeData>) => void }> = ({ data, update }) => (
  <div className="space-y-2 mt-2">
    <div>
      <FieldLabel>Event</FieldLabel>
      <InlineField value={data.event || ''} onChange={(v) => update({ event: v })} placeholder="webhook, cron..." mono />
    </div>
    <div>
      <FieldLabel>Provider</FieldLabel>
      <InlineField value={data.provider || ''} onChange={(v) => update({ provider: v })} placeholder="jira/v1, webhook/v1..." mono />
    </div>
    {data.provider && (
      <div>
        <FieldLabel>Filter</FieldLabel>
        <InlineField value={data.filter || ''} onChange={(v) => update({ filter: v })} placeholder="optional filter..." mono small />
      </div>
    )}
  </div>
);

const AgentEditor: FC<{ data: StepNodeData; update: (d: Partial<StepNodeData>) => void }> = ({ data, update }) => {
  const agents = useHarnessStore((s) => s.agents);
  const agentOptions = Object.keys(agents).map((id) => ({ value: id, label: id }));
  return (
    <div className="space-y-2 mt-2">
      <div>
        <FieldLabel>Agent</FieldLabel>
        <InlineSelect value={data.agent || ''} onChange={(v) => update({ agent: v })} options={agentOptions} placeholder="select agent..." />
      </div>
      <EvalEditor evals={data.eval || []} maxIterations={data.maxIterations} update={update} />
    </div>
  );
};

const GateEditor: FC<{ data: StepNodeData; update: (d: Partial<StepNodeData>) => void }> = ({ data, update }) => (
  <div className="space-y-2 mt-2">
    <div>
      <FieldLabel>Provider</FieldLabel>
      <InlineField value={data.provider || ''} onChange={(v) => update({ provider: v })} placeholder="slack/v1, teams/v1..." mono />
    </div>
    <div>
      <FieldLabel>Channel</FieldLabel>
      <InlineField value={data.channel || ''} onChange={(v) => update({ channel: v })} placeholder="#approvals" mono />
    </div>
    <div className="flex gap-2">
      <div className="flex-1">
        <FieldLabel>Timeout</FieldLabel>
        <InlineField value={data.timeout || '1h'} onChange={(v) => update({ timeout: v })} mono />
      </div>
      <div className="flex-1">
        <FieldLabel>Fallback</FieldLabel>
        <InlineSelect value={data.fallback || 'reject'} onChange={(v) => update({ fallback: v as 'reject' | 'approve' | 'escalate' })}
          options={[{ value: 'reject', label: 'reject' }, { value: 'approve', label: 'approve' }, { value: 'escalate', label: 'escalate' }]} />
      </div>
    </div>
  </div>
);

const RouterEditor: FC<{ data: StepNodeData; update: (d: Partial<StepNodeData>) => void }> = ({ data, update }) => {
  const agents = useHarnessStore((s) => s.agents);
  const agentOptions = Object.keys(agents).map((id) => ({ value: id, label: id }));
  return (
    <div className="space-y-2 mt-2">
      <div>
        <FieldLabel>Agent (classifier)</FieldLabel>
        <InlineSelect value={data.agent || ''} onChange={(v) => update({ agent: v })} options={agentOptions} placeholder="select agent..." />
      </div>
      <div className="text-[9px] mt-1" style={{ color: 'var(--color-text-3)' }}>
        Connect edges from the ◇ handle to define routes. Click edge labels to rename.
      </div>
    </div>
  );
};

const OrchestratorEditor: FC<{ data: StepNodeData; update: (d: Partial<StepNodeData>) => void }> = ({ data, update }) => {
  const agents = useHarnessStore((s) => s.agents);
  const agentNames = Object.keys(agents);
  const agentOptions = agentNames.map((id) => ({ value: id, label: id }));
  return (
    <div className="space-y-2 mt-2">
      <div>
        <FieldLabel>Agent</FieldLabel>
        <InlineSelect value={data.agent || ''} onChange={(v) => update({ agent: v })} options={agentOptions} placeholder="select agent..." />
      </div>
      <div>
        <FieldLabel>Pool</FieldLabel>
        <TagInput
          values={data.pool || []}
          onChange={(v) => update({ pool: v })}
          suggestions={agentNames}
          placeholder="add agent to pool..."
          color="var(--color-cyan)"
          colorSoft="var(--color-cyan-soft)"
          border="rgba(32,200,221,0.25)"
          mono
        />
      </div>
      <div>
        <FieldLabel>Max Agents</FieldLabel>
        <InlineField value={String(data.maxAgents || 5)} onChange={(v) => update({ maxAgents: parseInt(v) || 5 })} />
      </div>
      <EvalEditor evals={data.eval || []} maxIterations={data.maxIterations} update={update} />
    </div>
  );
};

// --- Type picker popover ---
const allTypes = Object.entries(typeConfig).map(([type, cfg]) => ({
  type: type as StepType,
  label: type.charAt(0).toUpperCase() + type.slice(1),
  ...cfg,
}));

// --- Main node component ---

const HarnessNode: FC<NodeProps> = ({ id, data, selected }) => {
  const nodeData = data as StepNodeData;
  const stepType = nodeData.stepType || 'agent';
  const cfg = typeConfig[stepType] || typeConfig.agent;
  const Icon = cfg.icon;

  const editingNodeId = useHarnessStore((s) => s.editingNodeId);
  const updateNodeData = useHarnessStore((s) => s.updateNodeData);
  const setEditingNode = useHarnessStore((s) => s.setEditingNode);
  const setContextMenu = useHarnessStore((s) => s.setContextMenu);
  const changeNodeType = useHarnessStore((s) => s.changeNodeType);

  const isEditing = editingNodeId === id;
  const isSelected = selected;
  const [hovered, setHovered] = useState(false);
  const hasError = stepType === 'agent' || stepType === 'gate' || stepType === 'orchestrator' || stepType === 'router';

  // Type picker
  const [showTypePicker, setShowTypePicker] = useState(false);

  const update = useCallback(
    (partial: Partial<StepNodeData>) => updateNodeData(id, partial),
    [id, updateNodeData]
  );

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingNode(isEditing ? null : id);
  }, [id, isEditing, setEditingNode]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ type: 'node', id, x: e.clientX, y: e.clientY });
  }, [id, setContextMenu]);

  // Title is always editable via single click
  const [editingTitle, setEditingTitle] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingTitle && titleRef.current) {
      titleRef.current.focus();
      titleRef.current.select();
    }
  }, [editingTitle]);

  const subtitle = !isEditing ? (
    stepType === 'agent' && nodeData.agent ? nodeData.agent
    : stepType === 'trigger' && nodeData.event ? nodeData.event
    : stepType === 'gate' ? (nodeData.channel || 'human approval')
    : stepType === 'router' && nodeData.agent ? nodeData.agent
    : stepType === 'orchestrator' ? `pool: ${(nodeData.pool || []).length}`
    : null
  ) : null;

  const active = isSelected || hovered;

  return (
    <div
      className="group relative"
      style={{ minWidth: isEditing ? 240 : 170, maxWidth: isEditing ? 280 : 210 }}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setShowTypePicker(false); }}
    >
      {/* Selection glow */}
      {isSelected && (
        <div className="absolute inset-0 rounded-2xl blur-xl opacity-30 -z-10"
          style={{ background: cfg.color, transform: 'scale(1.15)' }} />
      )}

      {/* Card */}
      <div
        className="relative rounded-2xl border transition-all duration-200"
        style={{
          background: active
            ? `linear-gradient(145deg, ${cfg.colorSoft}, var(--color-surface-2))`
            : 'var(--color-surface-2)',
          borderColor: active ? cfg.border : 'var(--color-border-2)',
          boxShadow: isSelected
            ? `0 0 0 1px ${cfg.border}, 0 8px 32px var(--color-shadow)`
            : hovered
            ? `0 4px 20px var(--color-shadow)`
            : `0 2px 12px var(--color-shadow)`,
          padding: isEditing ? '12px' : '10px 14px',
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2">
          {/* Clickable type icon — opens type picker */}
          <div className="relative">
            <div
              className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0 transition-all"
              style={{
                background: cfg.colorSoft,
                border: `1px solid ${cfg.border}`,
                cursor: 'default',
              }}
              onClick={(e) => { e.stopPropagation(); setShowTypePicker(!showTypePicker); }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <Icon size={14} style={{ color: cfg.color }} strokeWidth={2.5} />
            </div>
            {/* Type picker popover */}
            {showTypePicker && (
              <div
                className="absolute left-0 top-full mt-1 z-50 rounded-lg py-1 overflow-hidden"
                style={{
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-border-2)',
                  boxShadow: '0 8px 24px var(--color-shadow)',
                  width: 140,
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {allTypes.map((t) => {
                  const TIcon = t.icon;
                  const isCurrent = t.type === stepType;
                  return (
                    <button
                      key={t.type}
                      onClick={() => { changeNodeType(id, t.type); setShowTypePicker(false); }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 border-none text-left transition-colors"
                      style={{
                        background: isCurrent ? t.colorSoft : 'transparent',
                        color: isCurrent ? t.color : 'var(--color-text-2)',
                        cursor: 'default',
                      }}
                      onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = 'var(--color-surface-3)'; }}
                      onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.background = 'transparent'; }}
                    >
                      <TIcon size={12} style={{ color: t.color }} />
                      <span className="text-[10px] font-medium">{t.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            {editingTitle ? (
              <input
                ref={titleRef}
                value={nodeData.label}
                onChange={(e) => update({ label: e.target.value })}
                onBlur={() => setEditingTitle(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Escape') setEditingTitle(false);
                }}
                className="nodrag w-full outline-none text-[12px] font-semibold rounded px-1 -mx-1 py-0.5"
                style={{
                  color: 'var(--color-text-1)',
                  background: 'var(--color-surface-0)',
                  border: `1px solid ${cfg.color}`,
                  boxShadow: `0 0 0 2px ${cfg.colorSoft}`,
                }}
                {...stopMouse}
              />
            ) : (
              <div
                className="text-[12px] font-semibold truncate rounded px-1 -mx-1 py-0.5 transition-colors"
                style={{ color: 'var(--color-text-1)', border: '1px solid transparent' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-3)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                onClick={(e) => { e.stopPropagation(); setEditingTitle(true); }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {nodeData.label}
              </div>
            )}
            {subtitle && (
              <div className="text-[10px] truncate mt-0.5" style={{ color: 'var(--color-text-3)', fontFamily: 'var(--font-mono)' }}>
                {subtitle}
              </div>
            )}
          </div>
          <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md shrink-0"
            style={{ color: cfg.color, background: cfg.colorSoft, border: `1px solid ${cfg.border}` }}>
            {stepType}
          </span>
        </div>

        {/* Inline editor */}
        {isEditing && (
          <div {...stopMouse}>
            {stepType === 'trigger' && <TriggerEditor data={nodeData} update={update} />}
            {stepType === 'agent' && <AgentEditor data={nodeData} update={update} />}
            {stepType === 'gate' && <GateEditor data={nodeData} update={update} />}
            {stepType === 'router' && <RouterEditor data={nodeData} update={update} />}
            {stepType === 'orchestrator' && <OrchestratorEditor data={nodeData} update={update} />}
            {stepType === 'output' && (
              <div className="mt-2 text-[9px]" style={{ color: 'var(--color-text-3)' }}>
                Exit node. Connect incoming edges to define completion paths.
              </div>
            )}
          </div>
        )}

        {/* Collapsed eval badges */}
        {!isEditing && nodeData.eval && nodeData.eval.length > 0 && (
          <div className="mt-2 flex items-center gap-1 flex-wrap">
            {nodeData.eval.map((ev, i) => (
              <span key={i} className="text-[8px] font-medium px-1.5 py-0.5 rounded-full"
                style={{ color: 'var(--color-green)', background: 'var(--color-green-soft)', border: '1px solid rgba(45,212,160,0.25)' }}>
                {ev.metric || 'eval'}
              </span>
            ))}
            {nodeData.maxIterations && nodeData.maxIterations > 1 && (
              <span className="text-[8px]" style={{ color: 'var(--color-text-3)' }}>
                ×{nodeData.maxIterations}
              </span>
            )}
          </div>
        )}
      </div>

      {/* === HANDLES === */}

      {/* Input (left) */}
      {stepType !== 'trigger' && (
        <Handle type="target" position={Position.Left} id="input"
          style={{ left: -5, background: 'var(--color-surface-1)' }} />
      )}

      {/* Main output (right) */}
      {stepType !== 'output' && stepType !== 'router' && (
        <Handle type="source" position={Position.Right} id="output"
          style={{ right: -5, background: 'var(--color-surface-1)' }} />
      )}

      {/* Router: diamond route handle */}
      {stepType === 'router' && (
        <Handle type="source" position={Position.Right} id="route"
          style={{
            right: -7,
            width: 12,
            height: 12,
            borderRadius: 2,
            transform: 'rotate(45deg)',
            background: cfg.colorSoft,
            borderColor: cfg.color,
            borderWidth: 2,
          }}
        />
      )}

      {/* Error output (bottom) — always visible with label */}
      {hasError && (
        <div className="absolute left-1/2 -translate-x-1/2" style={{ bottom: -20 }}>
          <div className="flex flex-col items-center">
            <Handle type="source" position={Position.Bottom} id="error"
              className="!relative !transform-none !inset-auto"
              style={{
                width: 14,
                height: 14,
                borderRadius: 7,
                background: 'var(--color-red-soft)',
                borderColor: 'var(--color-red)',
                borderWidth: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            />
            <span className="text-[7px] font-bold uppercase tracking-wider mt-0.5"
              style={{ color: 'var(--color-red)', opacity: 0.7 }}>
              error
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default memo(HarnessNode);
