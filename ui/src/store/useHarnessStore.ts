import { create } from 'zustand';
import { type Node, type Edge, type Connection, addEdge, applyNodeChanges, applyEdgeChanges, type NodeChange, type EdgeChange } from '@xyflow/react';
import type { Agent, StepType, EvalConfig, Observability, Memory, Security, Resilience, HooksConfig } from '../types/harnessfile';
import { demoAgents, demoNodes, demoEdges } from './demoSeed';
import type { ParsedHarness } from '../utils/yamlImport';
import type { FSFileHandle } from '../utils/fileIO';

type HarnessNode = Node<StepNodeData, 'harnessNode'>;

export interface StepNodeData {
  label: string;
  stepType: StepType;
  agent?: string;
  // Trigger
  event?: string;
  filter?: string;
  provider?: string;
  outputSchema?: Record<string, string>;
  // Output
  inputSchema?: Record<string, string>;
  // Gate
  approve?: 'human';
  channel?: string;
  timeout?: string;
  fallback?: 'reject' | 'approve' | 'escalate';
  // Router — routes are now on edges, but agent is still here
  // Orchestrator
  pool?: string[];
  maxAgents?: number;
  // Eval
  eval?: EvalConfig[];
  maxIterations?: number;
  // Error handling
  retry?: number;
  onError?: 'fail' | 'skip' | 'continue';
  // Data flow
  context?: string;
  // Hooks
  hooks?: HooksConfig;
  // UI state
  editing?: boolean;
  [key: string]: unknown;
}

export interface HarnessEdgeData {
  routeLabel?: string; // for router conditional edges
  isError?: boolean;   // for error output edges
  [key: string]: unknown;
}

interface ContextMenu {
  type: 'node' | 'edge';
  id: string;
  x: number;
  y: number;
}

export type SidebarSection = 'file' | 'steps' | 'agents';

interface HarnessState {
  nodes: HarnessNode[];
  edges: Edge<HarnessEdgeData>[];
  selectedNodeId: string | null;
  editingNodeId: string | null;

  agents: Record<string, Agent>;

  harnessName: string;
  observability: Observability;
  memory: Memory | null;
  security: Security;
  resilience: Resilience;
  hooks: HooksConfig;

  // UI
  theme: 'dark' | 'light';
  showSettings: boolean;
  settingsTab: string;
  showYaml: boolean;
  contextMenu: ContextMenu | null;

  // Sidebar
  sidebarSection: SidebarSection;
  sidebarCollapsed: boolean;

  // Edge inspector
  inspectingEdgeId: string | null;

  // File state
  fileHandle: FSFileHandle | null;
  fileName: string | null;

  // Actions
  onNodesChange: (changes: NodeChange<HarnessNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (type: StepType, position: { x: number; y: number }) => void;
  addNodeAndConnect: (sourceId: string, sourceHandle: string | null, position: { x: number; y: number }) => void;
  duplicateNode: (id: string) => void;
  changeNodeType: (id: string, newType: StepType) => void;
  updateNodeData: (id: string, data: Partial<StepNodeData>) => void;
  removeNode: (id: string) => void;
  removeEdge: (id: string) => void;
  setSelectedNode: (id: string | null) => void;
  setEditingNode: (id: string | null) => void;
  updateEdgeData: (id: string, data: Partial<HarnessEdgeData>) => void;

  addAgent: (id: string, agent: Agent) => void;
  updateAgent: (id: string, agent: Partial<Agent>) => void;
  removeAgent: (id: string) => void;
  renameAgent: (oldId: string, newId: string) => void;

  setHarnessName: (name: string) => void;
  setObservability: (obs: Partial<Observability>) => void;
  setMemory: (mem: Memory | null) => void;
  setSecurity: (sec: Partial<Security>) => void;
  setResilience: (res: Partial<Resilience>) => void;
  setHooks: (hooks: HooksConfig) => void;

  setTheme: (theme: 'dark' | 'light') => void;
  toggleTheme: () => void;
  setShowSettings: (show: boolean) => void;
  setSettingsTab: (tab: string) => void;
  setShowYaml: (show: boolean) => void;
  setContextMenu: (menu: ContextMenu | null) => void;

  // Sidebar
  setSidebarSection: (section: SidebarSection) => void;
  toggleSidebarSection: (section: SidebarSection) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  // Edge inspector
  setInspectingEdge: (id: string | null) => void;

  // File operations
  setFileHandle: (handle: FSFileHandle | null) => void;
  setFileName: (name: string | null) => void;
  loadHarnessfile: (parsed: ParsedHarness) => void;
  newHarnessfile: () => void;
}

let nodeIdCounter = 0;
const nextId = () => `step_${++nodeIdCounter}`;

// Build initial seed data
const seedNodes: HarnessNode[] = demoNodes.map((n, i) => {
  const id = `step_${i + 1}`;
  nodeIdCounter = Math.max(nodeIdCounter, i + 1);
  return { id, type: 'harnessNode' as const, position: n.position, data: n.data };
});

const seedEdges: Edge<HarnessEdgeData>[] = demoEdges.map(([src, tgt, label], i) => ({
  id: `e_${i}`,
  source: seedNodes[src].id,
  target: seedNodes[tgt].id,
  sourceHandle: label ? 'route' : undefined,
  type: 'harnessEdge',
  data: label ? { routeLabel: label } : {},
}));

const defaultLabels: Record<StepType, string> = {
  agent: 'Agent Step',
  trigger: 'Trigger',
  output: 'Output',
  gate: 'Gate',
  router: 'Router',
  orchestrator: 'Orchestrator',
};

export const useHarnessStore = create<HarnessState>((set, get) => ({
  nodes: seedNodes,
  edges: seedEdges,
  selectedNodeId: null,
  editingNodeId: null,
  agents: { ...demoAgents },
  harnessName: 'jira-feature-pipeline',
  observability: {},
  memory: null,
  security: {},
  resilience: {},
  hooks: {},
  theme: (localStorage.getItem('hf-theme') as 'dark' | 'light') || 'dark',
  showSettings: false,
  settingsTab: 'general',
  showYaml: false,
  contextMenu: null,

  sidebarSection: (localStorage.getItem('hf-sidebar-section') as SidebarSection) || 'steps',
  sidebarCollapsed: localStorage.getItem('hf-sidebar-collapsed') === '1',

  fileHandle: null,
  fileName: null,

  inspectingEdgeId: null,

  onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) as HarnessNode[] }),
  onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) as Edge<HarnessEdgeData>[] }),
  onConnect: (connection) => {
    const sourceNode = get().nodes.find(n => n.id === connection.source);
    const isRouter = sourceNode?.data.stepType === 'router' && connection.sourceHandle === 'route';
    const isError = connection.sourceHandle === 'error';
    const newEdge: Edge<HarnessEdgeData> = {
      ...connection,
      id: `e_${Date.now()}`,
      type: 'harnessEdge',
      data: {
        ...(isRouter && { routeLabel: 'route' }),
        ...(isError && { isError: true }),
      },
    };
    set({ edges: addEdge(newEdge, get().edges) as Edge<HarnessEdgeData>[] });
  },

  addNode: (type, position) => {
    const id = nextId();
    const data: StepNodeData = {
      label: defaultLabels[type],
      stepType: type,
      ...(type === 'gate' && { approve: 'human' as const, fallback: 'reject' as const, timeout: '1h' }),
      ...(type === 'trigger' && { event: 'webhook' }),
    };
    const newNode: HarnessNode = { id, type: 'harnessNode', position, data };
    set({ nodes: [...get().nodes, newNode], editingNodeId: id, selectedNodeId: id });
  },

  addNodeAndConnect: (sourceId, sourceHandle, position) => {
    const id = nextId();
    const data: StepNodeData = { label: 'Agent Step', stepType: 'agent' };
    const newNode: HarnessNode = { id, type: 'harnessNode', position, data };
    const sourceNode = get().nodes.find(n => n.id === sourceId);
    const isRouter = sourceNode?.data.stepType === 'router' && sourceHandle === 'route';
    const isError = sourceHandle === 'error';
    const newEdge: Edge<HarnessEdgeData> = {
      id: `e_${Date.now()}`,
      source: sourceId,
      target: id,
      sourceHandle,
      targetHandle: 'input',
      type: 'harnessEdge',
      data: {
        ...(isRouter && { routeLabel: 'route' }),
        ...(isError && { isError: true }),
      },
    };
    set({
      nodes: [...get().nodes, newNode],
      edges: [...get().edges, newEdge],
      selectedNodeId: id,
      editingNodeId: id,
    });
  },

  duplicateNode: (id) => {
    const node = get().nodes.find((n) => n.id === id);
    if (!node) return;
    const newId = nextId();
    const newNode: HarnessNode = {
      ...node,
      id: newId,
      position: { x: node.position.x + 40, y: node.position.y + 40 },
      data: { ...node.data, label: `${node.data.label} (copy)` },
      selected: false,
    };
    set({ nodes: [...get().nodes, newNode], selectedNodeId: newId, contextMenu: null });
  },

  changeNodeType: (id, newType) => {
    const node = get().nodes.find((n) => n.id === id);
    if (!node) return;
    const oldType = node.data.stepType;
    if (oldType === newType) return;

    // Determine which edges would be lost
    const edges = get().edges;
    const incomingEdges = edges.filter((e) => e.target === id);
    const outgoingEdges = edges.filter((e) => e.source === id);
    const losesInput = newType === 'trigger' && incomingEdges.length > 0;
    const losesOutput = newType === 'output' && outgoingEdges.length > 0;

    if (losesInput || losesOutput) {
      const lost = [];
      if (losesInput) lost.push(`${incomingEdges.length} incoming`);
      if (losesOutput) lost.push(`${outgoingEdges.length} outgoing`);
      if (!window.confirm(`Changing to ${newType} will remove ${lost.join(' and ')} edge(s). Continue?`)) return;
    }

    // Keep compatible fields, reset type-specific ones
    const newData: StepNodeData = {
      label: node.data.label,
      stepType: newType,
      ...(node.data.agent && (newType === 'agent' || newType === 'router' || newType === 'orchestrator') && { agent: node.data.agent }),
      ...(newType === 'gate' && { approve: 'human' as const, fallback: 'reject' as const, timeout: '1h' }),
      ...(newType === 'trigger' && { event: 'webhook' }),
    };

    let newEdges = edges;
    if (losesInput) newEdges = newEdges.filter((e) => e.target !== id);
    if (losesOutput) newEdges = newEdges.filter((e) => e.source !== id);

    set({
      nodes: get().nodes.map((n) => n.id === id ? { ...n, data: newData } : n),
      edges: newEdges,
      contextMenu: null,
    });
  },

  updateNodeData: (id, data) => {
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...data } } : n
      ),
    });
  },

  removeNode: (id) => {
    set({
      nodes: get().nodes.filter((n) => n.id !== id),
      edges: get().edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId,
      editingNodeId: get().editingNodeId === id ? null : get().editingNodeId,
      contextMenu: null,
    });
  },

  removeEdge: (id) => {
    set({
      edges: get().edges.filter((e) => e.id !== id),
      contextMenu: null,
    });
  },

  setSelectedNode: (id) => set({ selectedNodeId: id }),
  setEditingNode: (id) => set({ editingNodeId: id }),

  updateEdgeData: (id, data) => {
    set({
      edges: get().edges.map((e) =>
        e.id === id ? { ...e, data: { ...(e.data || {}), ...data } } : e
      ),
    });
  },

  addAgent: (id, agent) => set({ agents: { ...get().agents, [id]: agent } }),
  updateAgent: (id, agent) => {
    const current = get().agents[id];
    if (current) {
      set({ agents: { ...get().agents, [id]: { ...current, ...agent } } });
    }
  },
  removeAgent: (id) => {
    const { [id]: _, ...rest } = get().agents;
    set({ agents: rest });
  },
  renameAgent: (oldId, newId) => {
    const agents = get().agents;
    const agent = agents[oldId];
    if (!agent) return;
    const { [oldId]: _, ...rest } = agents;
    set({
      agents: { ...rest, [newId]: agent },
      nodes: get().nodes.map((n) =>
        n.data.agent === oldId ? { ...n, data: { ...n.data, agent: newId } } : n
      ),
    });
  },

  setHarnessName: (name) => set({ harnessName: name }),
  setObservability: (obs) => set({ observability: { ...get().observability, ...obs } }),
  setMemory: (mem) => set({ memory: mem }),
  setSecurity: (sec) => set({ security: { ...get().security, ...sec } }),
  setResilience: (res) => set({ resilience: { ...get().resilience, ...res } }),
  setHooks: (hooks) => set({ hooks }),

  setShowSettings: (show) => set({ showSettings: show }),
  setSettingsTab: (tab) => set({ settingsTab: tab }),
  setShowYaml: (show) => set({ showYaml: show }),
  setContextMenu: (menu) => set({ contextMenu: menu }),
  setTheme: (theme) => {
    localStorage.setItem('hf-theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    set({ theme });
  },
  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    get().setTheme(next);
  },

  setSidebarSection: (section) => {
    localStorage.setItem('hf-sidebar-section', section);
    localStorage.setItem('hf-sidebar-collapsed', '0');
    set({ sidebarSection: section, sidebarCollapsed: false });
  },
  toggleSidebarSection: (section) => {
    const { sidebarSection, sidebarCollapsed } = get();
    if (sidebarSection === section && !sidebarCollapsed) {
      localStorage.setItem('hf-sidebar-collapsed', '1');
      set({ sidebarCollapsed: true });
    } else {
      localStorage.setItem('hf-sidebar-section', section);
      localStorage.setItem('hf-sidebar-collapsed', '0');
      set({ sidebarSection: section, sidebarCollapsed: false });
    }
  },
  setSidebarCollapsed: (collapsed) => {
    localStorage.setItem('hf-sidebar-collapsed', collapsed ? '1' : '0');
    set({ sidebarCollapsed: collapsed });
  },

  setFileHandle: (handle) => set({ fileHandle: handle }),
  setFileName: (name) => set({ fileName: name }),

  setInspectingEdge: (id) => set({ inspectingEdgeId: id }),

  loadHarnessfile: (parsed) => {
    // Rebuild nodes with fresh internal IDs
    const rebuiltNodes: HarnessNode[] = parsed.nodes.map((n, i) => {
      nodeIdCounter = Math.max(nodeIdCounter, i + 1);
      return {
        id: n.id,
        type: 'harnessNode' as const,
        position: n.position,
        data: n.data,
      };
    });
    // Reset the counter baseline based on incoming IDs
    const maxId = parsed.nodes.reduce((max, n) => {
      const m = /^step_(\d+)$/.exec(n.id);
      return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, 0);
    nodeIdCounter = maxId;

    set({
      nodes: rebuiltNodes,
      edges: parsed.edges,
      agents: parsed.agents,
      harnessName: parsed.harnessName,
      observability: parsed.observability,
      memory: parsed.memory,
      security: parsed.security,
      resilience: parsed.resilience,
      hooks: parsed.hooks,
      selectedNodeId: null,
      editingNodeId: null,
      contextMenu: null,
    });
  },

  newHarnessfile: () => {
    nodeIdCounter = 0;
    set({
      nodes: [],
      edges: [],
      agents: {},
      harnessName: 'untitled',
      observability: {},
      memory: null,
      security: {},
      resilience: {},
      hooks: {},
      selectedNodeId: null,
      editingNodeId: null,
      contextMenu: null,
      fileHandle: null,
      fileName: null,
    });
  },
}));
