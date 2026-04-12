import { useCallback, useRef, useEffect, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useReactFlow,
  type OnConnectEnd,
} from '@xyflow/react';
import { useHarnessStore } from './store/useHarnessStore';
import HarnessNode from './components/HarnessNode';
import HarnessEdge from './components/HarnessEdge';
import NodePalette from './components/NodePalette';
import ContextMenu from './components/ContextMenu';
import SettingsModal from './components/SettingsModal';
import YamlModal from './components/YamlModal';
import EdgeInspector from './components/EdgeInspector';
import { exportToYaml } from './utils/yamlExport';
import { saveFile } from './utils/fileIO';
import type { StepType } from './types/harnessfile';

if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__harnessStore = useHarnessStore;

const nodeTypes = { harnessNode: HarnessNode };
const edgeTypes = { harnessEdge: HarnessEdge };

/** Search for a React Flow handle within `radius` px of (x, y).
 * Used as a forgiving fallback when the user releases a connection
 * slightly off-target — without it the editor would create a stray
 * agent every time the cursor missed by a pixel. */
function findHandleNear(
  x: number,
  y: number,
  radius: number,
): { nodeId: string; handleId: string | null; handleType: 'source' | 'target' } | null {
  // Sample center plus 8 radial offsets
  const offsets: [number, number][] = [
    [0, 0],
    [radius, 0], [-radius, 0], [0, radius], [0, -radius],
    [radius, radius], [-radius, -radius], [radius, -radius], [-radius, radius],
  ];
  for (const [dx, dy] of offsets) {
    const el = document.elementFromPoint(x + dx, y + dy);
    if (!el) continue;
    const handle = (el as HTMLElement).closest('.react-flow__handle') as HTMLElement | null;
    if (!handle) continue;
    const nodeEl = handle.closest('.react-flow__node') as HTMLElement | null;
    const nodeId = nodeEl?.getAttribute('data-id');
    if (!nodeId) continue;
    const handleId = handle.getAttribute('data-handleid');
    const handleType = (handle.getAttribute('data-handletype') as 'source' | 'target') || 'target';
    return { nodeId, handleId, handleType };
  }
  return null;
}

function FlowCanvas() {
  const {
    nodes, edges,
    onNodesChange, onEdgesChange, onConnect,
    addNode, addNodeAndConnect, setSelectedNode, setEditingNode, setContextMenu,
    setInspectingEdge,
    theme,
  } = useHarnessStore();

  const { screenToFlowPosition } = useReactFlow();
  const connectingFrom = useRef<{ nodeId: string; handleId: string | null } | null>(null);

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/harnessNodeType') as StepType;
    if (!type) return;
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addNode(type, position);
  }, [addNode, screenToFlowPosition]);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setEditingNode(null);
    setContextMenu(null);
  }, [setSelectedNode, setEditingNode, setContextMenu]);

  const onNodeClick = useCallback((_: ReactMouseEvent, node: { id: string }) => {
    setSelectedNode(node.id);
    setContextMenu(null);
  }, [setSelectedNode, setContextMenu]);

  const onNodeDoubleClick = useCallback((_: ReactMouseEvent, node: { id: string }) => {
    setEditingNode(node.id);
  }, [setEditingNode]);

  const onEdgeContextMenu = useCallback((e: ReactMouseEvent, edge: { id: string }) => {
    e.preventDefault();
    setContextMenu({ type: 'edge', id: edge.id, x: e.clientX, y: e.clientY });
  }, [setContextMenu]);

  const onEdgeDoubleClick = useCallback((_: ReactMouseEvent, edge: { id: string }) => {
    setInspectingEdge(edge.id);
  }, [setInspectingEdge]);

  const onNodeContextMenu = useCallback((e: ReactMouseEvent, node: { id: string }) => {
    e.preventDefault();
    setContextMenu({ type: 'node', id: node.id, x: e.clientX, y: e.clientY });
  }, [setContextMenu]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onConnectStart = useCallback((_: any, params: { nodeId: string | null; handleId: string | null }) => {
    if (params.nodeId) {
      connectingFrom.current = { nodeId: params.nodeId, handleId: params.handleId };
    }
  }, []);

  const onConnectEnd: OnConnectEnd = useCallback((event) => {
    if (!connectingFrom.current) return;
    const me = event as MouseEvent;
    const target = me.target as HTMLElement;

    // 1. Released on a handle? React Flow already routed onConnect — bail.
    if (target.closest('.react-flow__handle')) {
      connectingFrom.current = null;
      return;
    }

    // 2. Released near (but not exactly on) a handle? Manually emit the
    //    connect rather than creating a stray new node.
    const { clientX, clientY } = me;
    const near = findHandleNear(clientX, clientY, 14);
    if (near && near.nodeId !== connectingFrom.current.nodeId) {
      onConnect({
        source: connectingFrom.current.nodeId,
        sourceHandle: connectingFrom.current.handleId,
        target: near.nodeId,
        targetHandle: near.handleId,
      });
      connectingFrom.current = null;
      return;
    }

    // 3. Released on an unrelated node? Don't spawn a duplicate.
    if (target.closest('.react-flow__node')) {
      connectingFrom.current = null;
      return;
    }

    // 4. Empty canvas → create a new connected node.
    const position = screenToFlowPosition({ x: clientX, y: clientY });
    addNodeAndConnect(connectingFrom.current.nodeId, connectingFrom.current.handleId, position);
    connectingFrom.current = null;
  }, [addNodeAndConnect, screenToFlowPosition, onConnect]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onConnectStart={onConnectStart}
      onConnectEnd={onConnectEnd}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onPaneClick={onPaneClick}
      onNodeClick={onNodeClick}
      onNodeDoubleClick={onNodeDoubleClick}
      onEdgeContextMenu={onEdgeContextMenu}
      onEdgeDoubleClick={onEdgeDoubleClick}
      onNodeContextMenu={onNodeContextMenu}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      snapToGrid
      snapGrid={[16, 16]}
      defaultEdgeOptions={{ type: 'harnessEdge' }}
      proOptions={{ hideAttribution: true }}
      deleteKeyCode={['Backspace', 'Delete']}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--color-border-1)" />
      <Controls position="bottom-left" showInteractive={false} />
      <MiniMap
        position="bottom-right"
        nodeColor={() => 'var(--color-surface-4)'}
        maskColor={theme === 'dark' ? 'rgba(10,10,12,0.8)' : 'rgba(245,245,247,0.8)'}
      />
    </ReactFlow>
  );
}

function App() {
  const { nodes, theme } = useHarnessStore();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Cmd/Ctrl+S → save the current harness. Uses the existing file handle
  // when present, otherwise prompts Save As.
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!(mod && e.key.toLowerCase() === 's')) return;
      e.preventDefault();
      const s = useHarnessStore.getState();
      const yamlStr = exportToYaml(
        s.nodes, s.edges, s.agents, s.harnessName,
        s.observability, s.memory, s.security, s.resilience, s.hooks,
      );
      const suggested = (s.fileName || `${s.harnessName || 'harnessfile'}.yaml`)
        .replace(/\.ya?ml$/, '') + '.yaml';
      try {
        const result = await saveFile(yamlStr, s.fileHandle, suggested);
        if (result) {
          s.setFileHandle(result.handle);
          s.setFileName(result.name);
        }
      } catch (err) {
        console.error('Save failed', err);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-screen w-screen" style={{ background: 'var(--color-surface-0)' }}>
      <NodePalette />

      <div className="flex-1 relative">
        <div className="absolute inset-0 pointer-events-none z-10"
          style={{
            background: `
              linear-gradient(to right, var(--color-surface-0) 0%, transparent 1.5%),
              linear-gradient(to left, var(--color-surface-0) 0%, transparent 1.5%),
              linear-gradient(to bottom, var(--color-surface-0) 0%, transparent 1.5%),
              linear-gradient(to top, var(--color-surface-0) 0%, transparent 1.5%)
            `,
          }}
        />

        <ReactFlowProvider>
          <FlowCanvas />
        </ReactFlowProvider>

        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="text-center">
              <div className="text-6xl font-bold tracking-tighter mb-3 opacity-[0.06]">harnessfile</div>
              <p className="text-[13px]" style={{ color: 'var(--color-text-3)', opacity: 0.6 }}>
                Drag steps from the left panel to start building
              </p>
            </div>
          </div>
        )}
      </div>

      <ContextMenu />
      <SettingsModal />
      <YamlModal />
      <EdgeInspector />
    </div>
  );
}

export default App;
