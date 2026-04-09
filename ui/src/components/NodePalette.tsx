import { type FC, type DragEvent, useState } from 'react';
import {
  Zap, Bot, ShieldCheck, GitFork, Workflow, LogOut,
  Plus, ChevronDown, ChevronRight, Cpu, Settings, Code, Sun, Moon,
  type LucideIcon,
} from 'lucide-react';
import { useHarnessStore } from '../store/useHarnessStore';
import type { StepType } from '../types/harnessfile';

interface PaletteItem {
  type: StepType;
  label: string;
  icon: LucideIcon;
  color: string;
  colorSoft: string;
}

const paletteItems: PaletteItem[] = [
  { type: 'trigger',      label: 'Trigger',      icon: Zap,         color: 'var(--color-amber)',  colorSoft: 'var(--color-amber-soft)' },
  { type: 'agent',        label: 'Agent Step',    icon: Bot,         color: 'var(--color-blue)',   colorSoft: 'var(--color-blue-soft)' },
  { type: 'gate',         label: 'Gate',          icon: ShieldCheck, color: 'var(--color-green)',  colorSoft: 'var(--color-green-soft)' },
  { type: 'router',       label: 'Router',        icon: GitFork,     color: 'var(--color-purple)', colorSoft: 'var(--color-purple-soft)' },
  { type: 'orchestrator', label: 'Orchestrator',  icon: Workflow,    color: 'var(--color-cyan)',   colorSoft: 'var(--color-cyan-soft)' },
  { type: 'output',       label: 'Output',        icon: LogOut,      color: 'var(--color-pink)',   colorSoft: 'var(--color-pink-soft)' },
];

const NodePalette: FC = () => {
  const { agents, addAgent, setShowSettings, setSettingsTab, setShowYaml, theme, toggleTheme } = useHarnessStore();
  const [agentsOpen, setAgentsOpen] = useState(true);

  const onDragStart = (e: DragEvent, type: StepType) => {
    e.dataTransfer.setData('application/harnessNodeType', type);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleAddAgent = () => {
    const ids = Object.keys(agents);
    let i = ids.length + 1;
    let newId = `agent-${i}`;
    while (ids.includes(newId)) { i++; newId = `agent-${i}`; }
    addAgent(newId, { model: 'anthropic/claude-sonnet-4-6', instructions: '' });
    setShowSettings(true);
    setSettingsTab('agents');
  };

  return (
    <div className="flex flex-col h-full select-none"
      style={{ width: 240, background: 'var(--color-surface-1)', borderRight: '1px solid var(--color-border-1)' }}>

      {/* Logo */}
      <div className="px-4 py-4 flex items-center gap-2.5" style={{ borderBottom: '1px solid var(--color-border-1)' }}>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: 'var(--color-amber-soft)', border: '1px solid rgba(232,149,42,0.3)' }}>
          <Cpu size={14} style={{ color: 'var(--color-amber)' }} />
        </div>
        <div>
          <div className="text-[13px] font-bold tracking-tight" style={{ color: 'var(--color-text-1)' }}>Harnessfile</div>
          <div className="text-[9px] font-medium tracking-widest uppercase" style={{ color: 'var(--color-text-3)' }}>Visual Editor</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Steps palette */}
        <div className="px-3 pt-4 pb-2">
          <div className="text-[9px] font-semibold uppercase tracking-widest mb-2.5 px-1" style={{ color: 'var(--color-text-3)' }}>
            Steps
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {paletteItems.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.type}
                  draggable
                  onDragStart={(e) => onDragStart(e, item.type)}
                  className="flex flex-col items-center gap-1 rounded-xl py-2.5 px-2 cursor-grab active:cursor-grabbing transition-all duration-150 hover:scale-[1.03]"
                  style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border-1)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = item.color; e.currentTarget.style.background = item.colorSoft; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border-1)'; e.currentTarget.style.background = 'var(--color-surface-2)'; }}
                >
                  <Icon size={16} style={{ color: item.color }} />
                  <span className="text-[10px] font-medium" style={{ color: 'var(--color-text-2)' }}>{item.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Agents list */}
        <div className="px-3 pt-2 pb-2">
          <button onClick={() => setAgentsOpen(!agentsOpen)}
            className="w-full flex items-center justify-between px-1 mb-2 cursor-pointer bg-transparent border-none">
            <span className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: 'var(--color-text-3)' }}>
              Agents ({Object.keys(agents).length})
            </span>
            {agentsOpen ? <ChevronDown size={11} style={{ color: 'var(--color-text-3)' }} /> : <ChevronRight size={11} style={{ color: 'var(--color-text-3)' }} />}
          </button>
          {agentsOpen && (
            <div className="space-y-0.5">
              {Object.entries(agents).map(([id, agent]) => (
                <div key={id} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
                  style={{ color: 'var(--color-text-2)' }}>
                  <Bot size={12} style={{ color: 'var(--color-blue)' }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-medium truncate" style={{ color: 'var(--color-text-1)' }}>{id}</div>
                    <div className="text-[9px] truncate" style={{ color: 'var(--color-text-3)', fontFamily: 'var(--font-mono)' }}>
                      {agent.model.split('/').pop()}
                    </div>
                  </div>
                </div>
              ))}
              <button onClick={handleAddAgent}
                className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 cursor-pointer transition-colors bg-transparent border border-dashed text-left"
                style={{ borderColor: 'var(--color-border-2)', color: 'var(--color-text-3)' }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-blue)'; e.currentTarget.style.color = 'var(--color-blue)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border-2)'; e.currentTarget.style.color = 'var(--color-text-3)'; }}>
                <Plus size={12} />
                <span className="text-[11px] font-medium">Add Agent</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Bottom */}
      <div className="px-3 py-3 space-y-0.5" style={{ borderTop: '1px solid var(--color-border-1)' }}>
        <button onClick={() => { setShowSettings(true); setSettingsTab('general'); }}
          className="w-full flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors bg-transparent border-none text-left"
          style={{ color: 'var(--color-text-2)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-3)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
          <Settings size={13} />
          <span className="text-[11px] font-medium">Settings</span>
        </button>
        <button onClick={() => setShowYaml(true)}
          className="w-full flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors bg-transparent border-none text-left"
          style={{ color: 'var(--color-text-2)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-3)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
          <Code size={13} />
          <span className="text-[11px] font-medium">View YAML</span>
        </button>
        <button onClick={toggleTheme}
          className="w-full flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors bg-transparent border-none text-left"
          style={{ color: 'var(--color-text-2)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-3)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
          {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
          <span className="text-[11px] font-medium">{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
        </button>
      </div>
    </div>
  );
};

export default NodePalette;
