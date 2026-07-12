import { type FC, type DragEvent, useState, useEffect } from 'react';
import {
  Zap, Bot, ShieldCheck, GitFork, Workflow, LogOut,
  Plus, Cpu, Settings, Code, Sun, Moon,
  FilePlus, FolderOpen, Save, Download, FileText,
  Boxes, Users, ChevronLeft,
  type LucideIcon,
} from 'lucide-react';
import { useHarnessStore, type SidebarSection } from '../store/useHarnessStore';
import type { StepType } from '../types/harnessfile';
import { exportToYaml } from '../utils/yamlExport';
import { importFromYaml } from '../utils/yamlImport';
import { openFile, saveFile, saveAsFile } from '../utils/fileIO';

interface PaletteItem {
  type: StepType;
  label: string;
  description: string;
  icon: LucideIcon;
  color: string;
  colorSoft: string;
}

const paletteItems: PaletteItem[] = [
  { type: 'trigger',      label: 'Trigger',      description: 'Kick off a run from an event',   icon: Zap,         color: 'var(--color-amber)',  colorSoft: 'var(--color-amber-soft)' },
  { type: 'agent',        label: 'Agent',        description: 'Run an LLM agent step',          icon: Bot,         color: 'var(--color-blue)',   colorSoft: 'var(--color-blue-soft)' },
  { type: 'gate',         label: 'Gate',         description: 'Human approval checkpoint',      icon: ShieldCheck, color: 'var(--color-green)',  colorSoft: 'var(--color-green-soft)' },
  { type: 'router',       label: 'Router',       description: 'Branch by classifier output',    icon: GitFork,     color: 'var(--color-purple)', colorSoft: 'var(--color-purple-soft)' },
  { type: 'orchestrator', label: 'Orchestrator', description: 'Spawn a dynamic pool of agents', icon: Workflow,    color: 'var(--color-cyan)',   colorSoft: 'var(--color-cyan-soft)' },
  { type: 'output',       label: 'Output',       description: 'Terminate and emit a result',    icon: LogOut,      color: 'var(--color-pink)',   colorSoft: 'var(--color-pink-soft)' },
];

interface RailItem {
  key: SidebarSection;
  label: string;
  icon: LucideIcon;
}

const railItems: RailItem[] = [
  { key: 'file',   label: 'File',   icon: FileText },
  { key: 'steps',  label: 'Steps',  icon: Boxes },
  { key: 'agents', label: 'Agents', icon: Users },
];

// -----------------------------------------------------------------------------
// Activity Rail (always visible)
// -----------------------------------------------------------------------------

const ActivityRail: FC = () => {
  const {
    sidebarSection, sidebarCollapsed,
    toggleSidebarSection, setSidebarCollapsed,
    theme, toggleTheme,
    setShowSettings, setSettingsTab,
  } = useHarnessStore();

  return (
    <div
      className="flex flex-col h-full select-none"
      style={{
        width: 52,
        background: 'var(--color-surface-1)',
        borderRight: '1px solid var(--color-border-1)',
        flexShrink: 0,
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center justify-center"
        style={{ height: 56, borderBottom: '1px solid var(--color-border-1)' }}
      >
        <div
          className="w-8 h-8 rounded-[10px] flex items-center justify-center"
          style={{
            background: 'var(--color-amber-soft)',
            border: '1px solid rgba(232,149,42,0.28)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
          }}
        >
          <Cpu size={15} style={{ color: 'var(--color-amber)' }} />
        </div>
      </div>

      {/* Section icons */}
      <div className="flex-1 flex flex-col items-center gap-1 pt-3">
        {railItems.map((item) => {
          const Icon = item.icon;
          const active = sidebarSection === item.key && !sidebarCollapsed;
          return (
            <button
              key={item.key}
              title={item.label}
              onClick={() => toggleSidebarSection(item.key)}
              className="relative flex items-center justify-center cursor-pointer bg-transparent border-none"
              style={{
                width: 40,
                height: 38,
                borderRadius: 10,
                color: active ? 'var(--color-amber)' : 'var(--color-text-2)',
                background: active ? 'var(--color-amber-soft)' : 'transparent',
                transition: 'all 120ms ease',
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.background = 'var(--color-surface-2)';
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.background = 'transparent';
              }}
            >
              {active && (
                <span
                  className="absolute"
                  style={{
                    left: -9,
                    top: 8,
                    bottom: 8,
                    width: 3,
                    borderRadius: '0 3px 3px 0',
                    background: 'var(--color-amber)',
                  }}
                />
              )}
              <Icon size={17} strokeWidth={1.75} />
            </button>
          );
        })}
      </div>

      {/* Footer utilities */}
      <div
        className="flex flex-col items-center gap-1 py-2"
        style={{ borderTop: '1px solid var(--color-border-1)' }}
      >
        <RailIconButton
          title="Settings"
          icon={Settings}
          onClick={() => { setShowSettings(true); setSettingsTab('general'); }}
        />
        <RailIconButton
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          icon={theme === 'dark' ? Sun : Moon}
          onClick={toggleTheme}
        />
        <RailIconButton
          title={sidebarCollapsed ? 'Expand panel' : 'Collapse panel'}
          icon={ChevronLeft}
          rotated={sidebarCollapsed}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
      </div>
    </div>
  );
};

const RailIconButton: FC<{
  title: string;
  icon: LucideIcon;
  onClick: () => void;
  rotated?: boolean;
}> = ({ title, icon: Icon, onClick, rotated }) => (
  <button
    title={title}
    onClick={onClick}
    className="flex items-center justify-center cursor-pointer bg-transparent border-none"
    style={{
      width: 40,
      height: 34,
      borderRadius: 8,
      color: 'var(--color-text-2)',
      transition: 'all 120ms ease',
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.background = 'var(--color-surface-2)';
      e.currentTarget.style.color = 'var(--color-text-1)';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.background = 'transparent';
      e.currentTarget.style.color = 'var(--color-text-2)';
    }}
  >
    <Icon
      size={15}
      strokeWidth={1.75}
      style={{ transform: rotated ? 'rotate(180deg)' : 'none', transition: 'transform 200ms ease' }}
    />
  </button>
);

// -----------------------------------------------------------------------------
// Panels
// -----------------------------------------------------------------------------

const PanelHeader: FC<{ title: string; subtitle?: string; right?: React.ReactNode }> = ({
  title, subtitle, right,
}) => (
  <div
    className="px-4 flex items-center justify-between"
    style={{ height: 56, borderBottom: '1px solid var(--color-border-1)', flexShrink: 0 }}
  >
    <div>
      <div className="text-[13px] font-semibold" style={{ color: 'var(--color-text-1)', letterSpacing: '-0.01em' }}>
        {title}
      </div>
      {subtitle && (
        <div className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-3)' }}>
          {subtitle}
        </div>
      )}
    </div>
    {right}
  </div>
);

const SectionLabel: FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    className="text-[9px] font-semibold uppercase tracking-[0.14em] mb-2 px-1"
    style={{ color: 'var(--color-text-3)' }}
  >
    {children}
  </div>
);

// -------- File Panel ---------

const FilePanel: FC = () => {
  const store = useHarnessStore();
  const {
    harnessName, setHarnessName,
    fileHandle, fileName, setFileHandle, setFileName,
    loadHarnessfile, newHarnessfile,
    setShowYaml,
    nodes, edges, agents, observability, memory, security, resilience, hooks,
  } = store;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 1400);
    return () => clearTimeout(t);
  }, [justSaved]);

  const suggestedName = (fileName || `${harnessName || 'harnessfile'}.yaml`).replace(/\.ya?ml$/, '') + '.yaml';

  const handleOpen = async () => {
    setError(null);
    setBusy('open');
    try {
      const opened = await openFile();
      if (!opened) return;
      const parsed = importFromYaml(opened.text);
      loadHarnessfile(parsed);
      setFileHandle(opened.handle);
      setFileName(opened.name);
    } catch (err) {
      setError((err as Error).message || 'Failed to open file');
    } finally {
      setBusy(null);
    }
  };

  const handleSave = async () => {
    setError(null);
    setBusy('save');
    try {
      const yamlStr = exportToYaml(
        nodes, edges, agents, harnessName,
        observability, memory, security, resilience, hooks,
      );
      const result = await saveFile(yamlStr, fileHandle, suggestedName);
      if (result) {
        setFileHandle(result.handle);
        setFileName(result.name);
        setJustSaved(true);
      }
    } catch (err) {
      setError((err as Error).message || 'Failed to save file');
    } finally {
      setBusy(null);
    }
  };

  const handleSaveAs = async () => {
    setError(null);
    setBusy('saveAs');
    try {
      const yamlStr = exportToYaml(
        nodes, edges, agents, harnessName,
        observability, memory, security, resilience, hooks,
      );
      const result = await saveAsFile(yamlStr, suggestedName);
      if (result) {
        setFileHandle(result.handle);
        setFileName(result.name);
        setJustSaved(true);
      }
    } catch (err) {
      setError((err as Error).message || 'Failed to save file');
    } finally {
      setBusy(null);
    }
  };

  const handleNew = () => {
    if (!window.confirm('Discard current harness and start a new one?')) return;
    newHarnessfile();
  };

  return (
    <>
      <PanelHeader title="File" subtitle="Load, save, and export your harness" />
      <div className="flex-1 overflow-y-auto px-3 py-4">
        {/* Harness name */}
        <SectionLabel>Harness name</SectionLabel>
        <input
          type="text"
          value={harnessName}
          onChange={(e) => setHarnessName(e.target.value)}
          placeholder="my-harness"
          className="w-full px-3 py-2 mb-4 text-[12px] outline-none rounded-lg"
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border-1)',
            color: 'var(--color-text-1)',
            fontFamily: 'var(--font-mono)',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-amber)'; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--color-border-1)'; }}
        />

        {/* Current file */}
        <SectionLabel>Current file</SectionLabel>
        <div
          className="flex items-center gap-2 px-3 py-2.5 mb-4 rounded-lg"
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border-1)',
          }}
        >
          <FileText size={13} style={{ color: fileName ? 'var(--color-amber)' : 'var(--color-text-3)' }} />
          <div className="min-w-0 flex-1">
            <div
              className="text-[11px] font-medium truncate"
              style={{
                color: fileName ? 'var(--color-text-1)' : 'var(--color-text-3)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {fileName || 'Untitled'}
            </div>
            <div className="text-[9px] mt-0.5" style={{ color: 'var(--color-text-3)' }}>
              {fileHandle ? 'Linked to disk' : fileName ? 'Detached copy' : 'Not saved'}
            </div>
          </div>
          {justSaved && (
            <span
              className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{ background: 'var(--color-green-soft)', color: 'var(--color-green)' }}
            >
              Saved
            </span>
          )}
        </div>

        {/* Actions */}
        <SectionLabel>Actions</SectionLabel>
        <div className="flex flex-col gap-1">
          <FileAction icon={FilePlus}   label="New"       hint="Start empty"            onClick={handleNew} />
          <FileAction icon={FolderOpen} label="Open…"     hint="Load .yaml / .yml"      onClick={handleOpen} busy={busy === 'open'} />
          <FileAction icon={Save}       label="Save"      hint={fileHandle ? 'Overwrite' : 'Pick location'} onClick={handleSave} busy={busy === 'save'} primary />
          <FileAction icon={Download}   label="Save As…"  hint="Choose new location"    onClick={handleSaveAs} busy={busy === 'saveAs'} />
        </div>

        <div
          className="my-4"
          style={{ height: 1, background: 'linear-gradient(to right, transparent, var(--color-border-1), transparent)' }}
        />

        <FileAction icon={Code} label="View YAML" hint="Preview generated spec" onClick={() => setShowYaml(true)} />

        {error && (
          <div
            className="mt-4 px-3 py-2 rounded-lg text-[11px]"
            style={{
              background: 'var(--color-red-soft)',
              color: 'var(--color-red)',
              border: '1px solid rgba(239,96,96,0.25)',
            }}
          >
            {error}
          </div>
        )}
      </div>
    </>
  );
};

const FileAction: FC<{
  icon: LucideIcon;
  label: string;
  hint: string;
  onClick: () => void;
  busy?: boolean;
  primary?: boolean;
}> = ({ icon: Icon, label, hint, onClick, busy, primary }) => (
  <button
    onClick={onClick}
    disabled={busy}
    className="w-full flex items-center gap-3 px-3 py-2.5 cursor-pointer text-left rounded-lg"
    style={{
      background: primary ? 'var(--color-amber-soft)' : 'var(--color-surface-2)',
      border: `1px solid ${primary ? 'rgba(232,149,42,0.28)' : 'var(--color-border-1)'}`,
      color: primary ? 'var(--color-amber)' : 'var(--color-text-2)',
      opacity: busy ? 0.6 : 1,
      transition: 'all 120ms ease',
    }}
    onMouseEnter={(e) => {
      if (busy) return;
      e.currentTarget.style.borderColor = primary ? 'var(--color-amber)' : 'var(--color-border-2)';
      if (!primary) e.currentTarget.style.background = 'var(--color-surface-3)';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.borderColor = primary ? 'rgba(232,149,42,0.28)' : 'var(--color-border-1)';
      if (!primary) e.currentTarget.style.background = 'var(--color-surface-2)';
    }}
  >
    <Icon size={14} strokeWidth={1.75} />
    <div className="flex-1 min-w-0">
      <div
        className="text-[11px] font-semibold"
        style={{ color: primary ? 'var(--color-amber)' : 'var(--color-text-1)' }}
      >
        {label}
      </div>
      <div className="text-[9px] mt-0.5" style={{ color: 'var(--color-text-3)' }}>
        {hint}
      </div>
    </div>
  </button>
);

// -------- Steps Panel ---------

const StepsPanel: FC = () => {
  const onDragStart = (e: DragEvent, type: StepType) => {
    e.dataTransfer.setData('application/harnessNodeType', type);
    e.dataTransfer.effectAllowed = 'move';
  };
  return (
    <>
      <PanelHeader title="Steps" subtitle="Drag onto the canvas to add" />
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <SectionLabel>Palette</SectionLabel>
        <div className="flex flex-col gap-1.5">
          {paletteItems.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.type}
                draggable
                onDragStart={(e) => onDragStart(e, item.type)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-grab active:cursor-grabbing"
                style={{
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-border-1)',
                  transition: 'all 120ms ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = item.color;
                  e.currentTarget.style.background = item.colorSoft;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--color-border-1)';
                  e.currentTarget.style.background = 'var(--color-surface-2)';
                }}
              >
                <div
                  className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
                  style={{ background: item.colorSoft, border: `1px solid ${item.color}33` }}
                >
                  <Icon size={14} style={{ color: item.color }} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold" style={{ color: 'var(--color-text-1)' }}>
                    {item.label}
                  </div>
                  <div className="text-[9px] mt-0.5 truncate" style={{ color: 'var(--color-text-3)' }}>
                    {item.description}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
};

// -------- Agents Panel ---------

const AgentsPanel: FC = () => {
  const { agents, addAgent, setShowSettings, setSettingsTab } = useHarnessStore();

  const handleAddAgent = () => {
    const ids = Object.keys(agents);
    let i = ids.length + 1;
    let newId = `agent-${i}`;
    while (ids.includes(newId)) { i++; newId = `agent-${i}`; }
    addAgent(newId, { model: 'anthropic/claude-sonnet-4-6', instructions: '' });
    setShowSettings(true);
    setSettingsTab('agents');
  };

  const entries = Object.entries(agents);

  return (
    <>
      <PanelHeader
        title="Agents"
        subtitle={`${entries.length} defined`}
        right={
          <button
            onClick={handleAddAgent}
            title="New agent"
            className="flex items-center justify-center cursor-pointer bg-transparent border-none"
            style={{
              width: 28, height: 28, borderRadius: 8,
              color: 'var(--color-text-2)',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-border-1)',
              transition: 'all 120ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--color-blue)';
              e.currentTarget.style.borderColor = 'var(--color-blue)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--color-text-2)';
              e.currentTarget.style.borderColor = 'var(--color-border-1)';
            }}
          >
            <Plus size={13} />
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto px-3 py-4">
        {entries.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center text-center py-10 px-6 rounded-lg"
            style={{ border: '1px dashed var(--color-border-2)' }}
          >
            <Bot size={22} style={{ color: 'var(--color-text-3)' }} />
            <div className="text-[11px] font-medium mt-3" style={{ color: 'var(--color-text-2)' }}>
              No agents yet
            </div>
            <div className="text-[10px] mt-1" style={{ color: 'var(--color-text-3)' }}>
              Add one to reference from agent, router, and orchestrator steps.
            </div>
            <button
              onClick={handleAddAgent}
              className="mt-4 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer border-none"
              style={{ background: 'var(--color-blue-soft)', color: 'var(--color-blue)' }}
            >
              <Plus size={12} />
              New agent
            </button>
          </div>
        ) : (
          <>
            <SectionLabel>Defined agents</SectionLabel>
            <div className="flex flex-col gap-1">
              {entries.map(([id, agent]) => (
                <div
                  key={id}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg"
                  style={{
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-border-1)',
                  }}
                >
                  <div
                    className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
                    style={{ background: 'var(--color-blue-soft)', border: '1px solid rgba(61,139,253,0.28)' }}
                  >
                    <Bot size={13} style={{ color: 'var(--color-blue)' }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-semibold truncate" style={{ color: 'var(--color-text-1)' }}>
                      {id}
                    </div>
                    <div
                      className="text-[9px] truncate"
                      style={{ color: 'var(--color-text-3)', fontFamily: 'var(--font-mono)' }}
                    >
                      {agent.model.split('/').pop()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
};

// -----------------------------------------------------------------------------
// Root Sidebar
// -----------------------------------------------------------------------------

const PANEL_WIDTH = 276;

const NodePalette: FC = () => {
  const { sidebarSection, sidebarCollapsed } = useHarnessStore();

  return (
    <div className="flex h-full" style={{ flexShrink: 0 }}>
      <ActivityRail />

      {/* Panel — collapses to 0 width with smooth transition */}
      <div
        className="h-full overflow-hidden"
        style={{
          width: sidebarCollapsed ? 0 : PANEL_WIDTH,
          transition: 'width 220ms cubic-bezier(0.22, 1, 0.36, 1)',
          background: 'var(--color-surface-1)',
          borderRight: sidebarCollapsed ? 'none' : '1px solid var(--color-border-1)',
          flexShrink: 0,
        }}
      >
        <div
          className="flex flex-col h-full"
          style={{ width: PANEL_WIDTH }}
        >
          {sidebarSection === 'file' && <FilePanel />}
          {sidebarSection === 'steps' && <StepsPanel />}
          {sidebarSection === 'agents' && <AgentsPanel />}
        </div>
      </div>
    </div>
  );
};

export default NodePalette;
