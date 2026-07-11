import { ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react'
import { useEffect, useMemo } from 'react'
import { buildGraph } from '../lib/layout'
import { useStore } from '../store'
import { HarnessNode } from './nodes/HarnessNode'

const nodeTypes = { harness: HarnessNode }

function Canvas() {
  const harness = useStore((s) => s.harness)
  const agents = useStore((s) => s.agents)
  const squads = useStore((s) => s.squads)
  const selectedNode = useStore((s) => s.selectedNode)
  const selectNode = useStore((s) => s.selectNode)
  const { fitView } = useReactFlow()

  const { nodes, edges } = useMemo(() => {
    if (!harness) return { nodes: [], edges: [] }
    return buildGraph(harness, agents, squads)
  }, [harness, agents, squads])

  const displayNodes = useMemo(
    () => nodes.map((n) => ({ ...n, selected: n.id === selectedNode })),
    [nodes, selectedNode],
  )

  // Re-fit when the graph shape changes (e.g. a different directory is opened).
  const shapeKey = useMemo(() => nodes.map((n) => n.id).join('|'), [nodes])
  useEffect(() => {
    const t = setTimeout(() => void fitView({ padding: 0.18, duration: 0 }), 30)
    return () => clearTimeout(t)
  }, [shapeKey, fitView])

  return (
    <ReactFlow
      nodes={displayNodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, node) => selectNode(node.id)}
      onPaneClick={() => selectNode(null)}
      nodesConnectable={false}
      nodesDraggable={false}
      elementsSelectable
      minZoom={0.3}
      maxZoom={1.6}
      proOptions={{ hideAttribution: true }}
      style={{ background: 'transparent' }}
    />
  )
}

export function GraphView() {
  return (
    <>
      <ReactFlowProvider>
        <Canvas />
      </ReactFlowProvider>
      <div className="canvas-hint">Scroll to zoom · drag to pan · click a node to inspect</div>
    </>
  )
}
