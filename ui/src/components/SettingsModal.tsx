import { type FC } from 'react';
import {
  X, Eye, Database, Shield, Heart, Webhook,
  Settings, Bot, Plus, Trash2,
} from 'lucide-react';
import { useHarnessStore } from '../store/useHarnessStore';
import TagInput from './TagInput';
import MarkdownTextarea from './MarkdownTextarea';

const Label: FC<{ children: React.ReactNode }> = ({ children }) => (
  <label className="block text-[11px] font-medium mb-1.5 uppercase tracking-wider" style={{ color: 'var(--color-text-3)' }}>
    {children}
  </label>
);

const Input: FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => (
  <input
    {...props}
    className="w-full rounded-lg px-3 py-2 text-[13px] outline-none transition-colors"
    style={{
      background: 'var(--color-surface-2)',
      border: '1px solid var(--color-border-2)',
      color: 'var(--color-text-1)',
    }}
    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-amber)'; }}
    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--color-border-2)'; }}
  />
);

const Select: FC<React.SelectHTMLAttributes<HTMLSelectElement> & { children: React.ReactNode }> = ({ children, ...props }) => (
  <select
    {...props}
    className="w-full rounded-lg px-3 py-2 text-[13px] outline-none transition-colors appearance-none cursor-pointer"
    style={{
      background: 'var(--color-surface-2)',
      border: '1px solid var(--color-border-2)',
      color: 'var(--color-text-1)',
    }}
  >
    {children}
  </select>
);

const Toggle: FC<{ checked: boolean; onChange: (v: boolean) => void; label: string }> = ({ checked, onChange, label }) => (
  <div className="flex items-center justify-between">
    <span className="text-[12px]" style={{ color: 'var(--color-text-2)' }}>{label}</span>
    <button
      onClick={() => onChange(!checked)}
      className="w-9 h-5 rounded-full cursor-pointer transition-colors border-none relative"
      style={{ background: checked ? 'var(--color-amber)' : 'var(--color-surface-4)' }}
    >
      <div
        className="w-3.5 h-3.5 rounded-full absolute top-[3px] transition-all"
        style={{
          background: checked ? '#000' : 'var(--color-text-3)',
          left: checked ? '18px' : '3px',
        }}
      />
    </button>
  </div>
);

const tabs = [
  { id: 'general',       label: 'General',       icon: Settings },
  { id: 'agents',        label: 'Agents',        icon: Bot },
  { id: 'observability', label: 'Observability',  icon: Eye },
  { id: 'memory',        label: 'Memory',         icon: Database },
  { id: 'security',      label: 'Security',       icon: Shield },
  { id: 'resilience',    label: 'Resilience',     icon: Heart },
  { id: 'hooks',         label: 'Hooks',          icon: Webhook },
];

const SettingsModal: FC = () => {
  const {
    showSettings, setShowSettings, settingsTab, setSettingsTab,
    harnessName, setHarnessName,
    agents, addAgent, updateAgent, removeAgent, renameAgent,
    observability, setObservability,
    memory, setMemory,
    security, setSecurity,
    resilience, setResilience,
    hooks, setHooks,
  } = useHarnessStore();

  if (!showSettings) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
      onClick={() => setShowSettings(false)}
    >
      <div
        className="flex rounded-2xl overflow-hidden max-w-3xl w-full mx-4"
        style={{
          background: 'var(--color-surface-1)',
          border: '1px solid var(--color-border-2)',
          boxShadow: '0 32px 64px rgba(0,0,0,0.6)',
          height: '70vh',
          maxHeight: 600,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sidebar */}
        <div className="w-48 shrink-0 py-4 flex flex-col" style={{ background: 'var(--color-surface-0)', borderRight: '1px solid var(--color-border-1)' }}>
          <div className="px-4 mb-4">
            <div className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--color-text-3)' }}>
              Settings
            </div>
          </div>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = settingsTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setSettingsTab(tab.id)}
                className="flex items-center gap-2.5 px-4 py-2 cursor-pointer bg-transparent border-none text-left transition-colors"
                style={{
                  color: isActive ? 'var(--color-text-1)' : 'var(--color-text-3)',
                  background: isActive ? 'var(--color-surface-2)' : 'transparent',
                }}
              >
                <Icon size={14} />
                <span className="text-[12px] font-medium">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--color-border-1)' }}>
            <h3 className="text-sm font-semibold m-0" style={{ color: 'var(--color-text-1)' }}>
              {tabs.find((t) => t.id === settingsTab)?.label}
            </h3>
            <button
              onClick={() => setShowSettings(false)}
              className="p-1 bg-transparent border-none cursor-pointer"
              style={{ color: 'var(--color-text-3)' }}
            >
              <X size={16} />
            </button>
          </div>

          <div className="px-6 py-5 space-y-4">
            {settingsTab === 'general' && (
              <>
                <div>
                  <Label>Harness Name</Label>
                  <Input value={harnessName} onChange={(e) => setHarnessName(e.target.value)} />
                </div>
                <div>
                  <Label>Spec Version</Label>
                  <Input value="0.1" disabled />
                </div>
              </>
            )}

            {settingsTab === 'agents' && (
              <>
                {Object.entries(agents).map(([id, agent]) => (
                  <div key={id} className="rounded-xl p-4 space-y-3"
                    style={{ background: 'var(--color-surface-0)', border: '1px solid var(--color-border-1)' }}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Bot size={14} style={{ color: 'var(--color-blue)' }} />
                        <input
                          value={id}
                          onChange={(e) => renameAgent(id, e.target.value)}
                          className="bg-transparent border-none outline-none text-[13px] font-semibold"
                          style={{ color: 'var(--color-text-1)' }}
                        />
                      </div>
                      <button onClick={() => removeAgent(id)}
                        className="p-1 bg-transparent border-none cursor-pointer"
                        style={{ color: 'var(--color-text-3)' }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-red)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-3)'; }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <div>
                      <Label>Model</Label>
                      <Input value={agent.model} onChange={(e) => updateAgent(id, { model: e.target.value })} placeholder="anthropic/claude-sonnet-4-6" />
                    </div>
                    <div>
                      <Label>Instructions</Label>
                      <MarkdownTextarea
                        value={agent.instructions}
                        onChange={(v) => updateAgent(id, { instructions: v })}
                        placeholder="System prompt for this agent..."
                        minRows={3}
                        maxRows={12}
                      />
                    </div>
                    <div>
                      <Label>Tools (MCP)</Label>
                      <TagInput
                        values={(agent.tools || []).map(t => t.mcp || '').filter(Boolean)}
                        onChange={(v) => updateAgent(id, { tools: v.map(s => ({ mcp: s })) })}
                        placeholder="./tools/tool.json"
                        color="var(--color-amber)"
                        colorSoft="var(--color-amber-soft)"
                        border="rgba(232,149,42,0.25)"
                        mono
                      />
                    </div>
                    <div>
                      <Label>Skills</Label>
                      <TagInput
                        values={agent.skills || []}
                        onChange={(v) => updateAgent(id, { skills: v })}
                        placeholder="./skills/skill.md"
                        color="var(--color-purple)"
                        colorSoft="var(--color-purple-soft)"
                        border="rgba(155,122,255,0.25)"
                        mono
                      />
                    </div>
                  </div>
                ))}
                <button
                  onClick={() => {
                    const ids = Object.keys(agents);
                    let i = ids.length + 1;
                    let newId = `agent-${i}`;
                    while (ids.includes(newId)) { i++; newId = `agent-${i}`; }
                    addAgent(newId, { model: 'anthropic/claude-sonnet-4-6', instructions: '' });
                  }}
                  className="w-full flex items-center justify-center gap-2 rounded-xl py-3 cursor-pointer border border-dashed transition-colors bg-transparent"
                  style={{ borderColor: 'var(--color-border-2)', color: 'var(--color-blue)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-blue)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border-2)'; }}>
                  <Plus size={14} />
                  <span className="text-[13px] font-medium">Add Agent</span>
                </button>
              </>
            )}

            {settingsTab === 'observability' && (
              <>
                <div>
                  <Label>Tracing Provider</Label>
                  <Input
                    value={observability.tracing || ''}
                    onChange={(e) => setObservability({ tracing: e.target.value || undefined })}
                    placeholder="langfuse/v1, datadog/v1, otel/v1..."
                  />
                </div>
                <div>
                  <Label>Metrics Provider</Label>
                  <Input
                    value={observability.metrics || ''}
                    onChange={(e) => setObservability({ metrics: e.target.value || undefined })}
                    placeholder="datadog/v1, otel/v1..."
                  />
                </div>
                <div>
                  <Label>Sampling Rate</Label>
                  <Input
                    type="number"
                    min={0}
                    max={1}
                    step={0.1}
                    value={observability.sampling ?? 1.0}
                    onChange={(e) => setObservability({ sampling: parseFloat(e.target.value) })}
                  />
                </div>
                <div>
                  <Label>Level</Label>
                  <Select
                    value={observability.level || 'steps'}
                    onChange={(e) => setObservability({ level: e.target.value as 'calls' | 'steps' | 'harness' })}
                  >
                    <option value="calls">Calls</option>
                    <option value="steps">Steps</option>
                    <option value="harness">Harness</option>
                  </Select>
                </div>
              </>
            )}

            {settingsTab === 'memory' && (
              <>
                <Toggle
                  checked={memory !== null}
                  onChange={(v) => setMemory(v ? { backend: 'postgres/v1' } : null)}
                  label="Enable Memory"
                />
                {memory && (
                  <>
                    <div>
                      <Label>Backend</Label>
                      <Input
                        value={memory.backend}
                        onChange={(e) => setMemory({ ...memory, backend: e.target.value })}
                        placeholder="postgres/v1, redis/v1..."
                      />
                    </div>
                    <div>
                      <Label>Scope</Label>
                      <Select
                        value={memory.scope || 'thread'}
                        onChange={(e) => setMemory({ ...memory, scope: e.target.value as 'thread' | 'shared' | 'global' })}
                      >
                        <option value="thread">Thread (per run)</option>
                        <option value="shared">Shared (across runs)</option>
                        <option value="global">Global</option>
                      </Select>
                    </div>
                    <div>
                      <Label>Type</Label>
                      <Select
                        value={memory.type || 'checkpoint'}
                        onChange={(e) => setMemory({ ...memory, type: e.target.value as 'checkpoint' | 'conversation' | 'semantic' })}
                      >
                        <option value="checkpoint">Checkpoint</option>
                        <option value="conversation">Conversation</option>
                        <option value="semantic">Semantic</option>
                      </Select>
                    </div>
                    <div>
                      <Label>TTL</Label>
                      <Input
                        value={memory.ttl || ''}
                        onChange={(e) => setMemory({ ...memory, ttl: e.target.value || undefined })}
                        placeholder="e.g. 24h, 7d"
                      />
                    </div>
                  </>
                )}
              </>
            )}

            {settingsTab === 'security' && (
              <>
                <div>
                  <Label>Input Guardrails</Label>
                  <TagInput
                    values={security.guardrails?.input || []}
                    onChange={(v) => setSecurity({ guardrails: { ...security.guardrails, input: v } })}
                    suggestions={['injection-detect', 'pii-redact', 'prompt-shield', 'content-filter']}
                    placeholder="add guardrail..."
                    color="var(--color-red)"
                    colorSoft="var(--color-red-soft)"
                    border="rgba(239,96,96,0.25)"
                  />
                </div>
                <div>
                  <Label>Output Guardrails</Label>
                  <TagInput
                    values={security.guardrails?.output || []}
                    onChange={(v) => setSecurity({ guardrails: { ...security.guardrails, output: v } })}
                    suggestions={['pii-scrub', 'toxicity-filter', 'content-filter', 'hallucination-detect']}
                    placeholder="add guardrail..."
                    color="var(--color-red)"
                    colorSoft="var(--color-red-soft)"
                    border="rgba(239,96,96,0.25)"
                  />
                </div>
                <div>
                  <Label>Guardrails Provider</Label>
                  <Input
                    value={security.guardrails?.provider || ''}
                    onChange={(e) => setSecurity({
                      guardrails: { ...security.guardrails, provider: e.target.value || undefined },
                    })}
                    placeholder="owasp/v1, bedrock-guardrails/v1..."
                  />
                </div>
                <div>
                  <Label>Max Tokens</Label>
                  <Input
                    type="number"
                    value={security.budget?.['max-tokens'] || ''}
                    onChange={(e) => setSecurity({
                      budget: { ...security.budget, 'max-tokens': parseInt(e.target.value) || undefined },
                    })}
                    placeholder="100000"
                  />
                </div>
                <div>
                  <Label>Max Cost</Label>
                  <Input
                    value={security.budget?.['max-cost'] || ''}
                    onChange={(e) => setSecurity({
                      budget: { ...security.budget, 'max-cost': e.target.value || undefined },
                    })}
                    placeholder="$10.00"
                  />
                </div>
                <div>
                  <Label>Audit Destination</Label>
                  <Input
                    value={security.audit?.destination || ''}
                    onChange={(e) => setSecurity({
                      audit: { ...security.audit, destination: e.target.value || undefined },
                    })}
                    placeholder="stdout"
                  />
                </div>
                <div>
                  <Label>Audit Level</Label>
                  <Select
                    value={security.audit?.level || 'actions'}
                    onChange={(e) => setSecurity({
                      audit: { ...security.audit, level: e.target.value as 'actions' | 'reasoning' | 'full' },
                    })}
                  >
                    <option value="actions">Actions</option>
                    <option value="reasoning">Reasoning</option>
                    <option value="full">Full</option>
                  </Select>
                </div>
              </>
            )}

            {settingsTab === 'resilience' && (
              <>
                <div>
                  <Label>Harness Timeout</Label>
                  <Input
                    value={resilience.timeout || ''}
                    onChange={(e) => setResilience({ timeout: e.target.value || undefined })}
                    placeholder="e.g. 1h, 2h"
                  />
                </div>
                <Toggle
                  checked={resilience.checkpoint || false}
                  onChange={(v) => setResilience({ checkpoint: v })}
                  label="Enable checkpoint/resume"
                />
              </>
            )}

            {settingsTab === 'hooks' && (
              <>
                <p className="text-[12px] mb-3" style={{ color: 'var(--color-text-3)' }}>
                  Global hooks fire for every step. You can also add per-step hooks in the step editor.
                </p>
                {(['on-start', 'before-step', 'after-step', 'on-error', 'on-gate-pending', 'on-gate-resolved', 'on-complete'] as const).map((event) => (
                  <div key={event}>
                    <Label>{event}</Label>
                    <Input
                      value={typeof hooks[event] === 'string' ? hooks[event] as string : (hooks[event] as { run: string })?.run || ''}
                      onChange={(e) => setHooks({ ...hooks, [event]: e.target.value || undefined })}
                      placeholder="slack:#alerts, ./scripts/hook.sh..."
                    />
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
