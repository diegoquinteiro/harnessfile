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
import type { StepType } from './types/harnessfile';

if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__harnessStore = useHarnessStore;

const nodeTypes = { harnessNode: HarnessNode };
const edgeTypes = { harnessEdge: HarnessEdge };

function FlowCanvas() {
  const {
    nodes, edges,
    onNodesChange, onEdgesChange, onConnect,
    addNode, addNodeAndConnect, setSelectedNode, setEditingNode, setContextMenu,
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
    const target = (event as MouseEvent).target as HTMLElement;
    if (target.closest('.react-flow__node') || target.closest('.react-flow__handle')) {
      connectingFrom.current = null;
      return;
    }
    const { clientX, clientY } = event as MouseEvent;
    const position = screenToFlowPosition({ x: clientX, y: clientY });
    addNodeAndConnect(connectingFrom.current.nodeId, connectingFrom.current.handleId, position);
    connectingFrom.current = null;
  }, [addNodeAndConnect, screenToFlowPosition]);

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
    </div>
  );
}

export default App;
