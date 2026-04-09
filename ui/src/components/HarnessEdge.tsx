import { type FC, memo, useState, useRef, useEffect, useCallback } from 'react';
import { getSmoothStepPath, type EdgeProps, BaseEdge, EdgeLabelRenderer } from '@xyflow/react';
import type { HarnessEdgeData } from '../store/useHarnessStore';
import { useHarnessStore } from '../store/useHarnessStore';

const HarnessEdge: FC<EdgeProps> = ({
  id,
  sourceX, sourceY,
  targetX, targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
  sourceHandleId,
}) => {
  const edgeData = (data || {}) as HarnessEdgeData;
  const isError = edgeData.isError || sourceHandleId === 'error';
  const isRoute = !!edgeData.routeLabel || sourceHandleId === 'route';
  const routeLabel = edgeData.routeLabel || '';

  const updateEdgeData = useHarnessStore((s) => s.updateEdgeData);
  const setContextMenu = useHarnessStore((s) => s.setContextMenu);

  const [editingLabel, setEditingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState(routeLabel);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setLabelValue(routeLabel); }, [routeLabel]);
  useEffect(() => {
    if (editingLabel && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingLabel]);

  const commitLabel = useCallback(() => {
    updateEdgeData(id, { routeLabel: labelValue || 'route' });
    setEditingLabel(false);
  }, [id, labelValue, updateEdgeData]);

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY,
    targetX, targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 16,
  });

  const strokeColor = isError
    ? (selected ? 'var(--color-red)' : 'rgba(239,96,96,0.5)')
    : isRoute
    ? (selected ? 'var(--color-purple)' : 'rgba(155,122,255,0.5)')
    : (selected ? 'var(--color-amber)' : 'var(--color-border-3)');

  const dotColor = isError ? 'var(--color-red)' : isRoute ? 'var(--color-purple)' : 'var(--color-amber)';

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ type: 'edge', id, x: e.clientX, y: e.clientY });
  }, [id, setContextMenu]);

  return (
    <g onContextMenu={handleContextMenu}>
      {/* Wide invisible hit area */}
      <path d={edgePath} fill="none" stroke="transparent" strokeWidth={20} />

      {/* Glow */}
      {selected && (
        <path d={edgePath} fill="none" stroke={strokeColor} strokeWidth={6} strokeOpacity={0.25} filter="blur(4px)" />
      )}

      {/* Dash pattern for error edges */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: strokeColor,
          strokeWidth: 2,
          strokeDasharray: isError ? '6 4' : undefined,
        }}
      />

      {/* Animated dot */}
      <circle r={isError ? 2 : 3} fill={dotColor} opacity={0.5}>
        <animateMotion dur={isError ? '4s' : '3s'} repeatCount="indefinite" path={edgePath} />
      </circle>

      {/* No SVG markers — the node handles already provide visual cues */}

      {/* Editable route label */}
      {isRoute && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
          >
            {editingLabel ? (
              <input
                ref={inputRef}
                value={labelValue}
                onChange={(e) => setLabelValue(e.target.value)}
                onBlur={commitLabel}
                onKeyDown={(e) => { if (e.key === 'Enter') commitLabel(); if (e.key === 'Escape') setEditingLabel(false); }}
                className="outline-none text-center rounded-md px-2 py-0.5"
                style={{
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-purple)',
                  color: 'var(--color-purple)',
                  fontSize: '10px',
                  fontFamily: 'var(--font-mono)',
                  width: Math.max(50, labelValue.length * 7 + 20),
                }}
              />
            ) : (
              <button
                onClick={() => setEditingLabel(true)}
                className="cursor-pointer rounded-md px-2 py-0.5 border-none transition-all hover:scale-105"
                style={{
                  background: 'var(--color-surface-2)',
                  border: '1px solid rgba(155,122,255,0.3)',
                  color: 'var(--color-purple)',
                  fontSize: '10px',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 600,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                }}
              >
                {routeLabel || 'route'}
              </button>
            )}
          </div>
        </EdgeLabelRenderer>
      )}

      {/* Error label */}
      {isError && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'none',
            }}
          >
            <span className="rounded-md px-1.5 py-0.5"
              style={{
                background: 'var(--color-surface-2)',
                border: '1px solid rgba(239,96,96,0.3)',
                color: 'var(--color-red)',
                fontSize: '9px',
                fontFamily: 'var(--font-mono)',
                fontWeight: 600,
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
              }}>
              error
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  );
};

export default memo(HarnessEdge);
