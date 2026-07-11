import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { HarnessFlowNode } from '../../lib/layout'

export function HarnessNode({ data, selected }: NodeProps<HarnessFlowNode>) {
  return (
    <div className={`hnode hnode--${data.kind}${selected ? ' hnode--selected' : ''}`}>
      {data.kind !== 'trigger' && (
        <Handle type="target" position={Position.Left} isConnectable={false} />
      )}
      <div className="hnode__tag">{data.tag}</div>
      <div className="hnode__title">{data.title}</div>
      {data.meta && <div className="hnode__meta">{data.meta}</div>}
      {data.kind !== 'output' && (
        <Handle type="source" position={Position.Right} isConnectable={false} />
      )}
    </div>
  )
}
