import { type FC, useEffect, useRef } from 'react';
import { Trash2, Pencil, Copy } from 'lucide-react';
import { useHarnessStore } from '../store/useHarnessStore';

interface MenuItem {
  icon: typeof Trash2;
  label: string;
  action: () => void;
  danger?: boolean;
}

const ContextMenu: FC = () => {
  const { contextMenu, setContextMenu, removeNode, removeEdge, setEditingNode, duplicateNode } = useHarnessStore();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenu(null); };
    window.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleKey);
    };
  }, [setContextMenu]);

  if (!contextMenu) return null;

  const items: MenuItem[] = contextMenu.type === 'node'
    ? [
        { icon: Pencil, label: 'Edit', action: () => { setEditingNode(contextMenu.id); setContextMenu(null); } },
        { icon: Copy, label: 'Duplicate', action: () => duplicateNode(contextMenu.id) },
        { icon: Trash2, label: 'Delete', action: () => removeNode(contextMenu.id), danger: true },
      ]
    : [
        { icon: Trash2, label: 'Delete', action: () => removeEdge(contextMenu.id), danger: true },
      ];

  return (
    <div
      ref={ref}
      className="fixed z-[100] rounded-xl overflow-hidden py-1"
      style={{
        left: contextMenu.x,
        top: contextMenu.y,
        background: 'var(--color-surface-2)',
        border: '1px solid var(--color-border-2)',
        boxShadow: '0 8px 32px var(--color-shadow)',
        minWidth: 150,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.label}
            onClick={item.action}
            className="w-full flex items-center gap-2.5 px-3 py-2 cursor-pointer bg-transparent border-none text-left transition-colors"
            style={{ color: item.danger ? 'var(--color-red)' : 'var(--color-text-2)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = item.danger ? 'var(--color-red-soft)' : 'var(--color-surface-3)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <Icon size={13} />
            <span className="text-[12px] font-medium">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default ContextMenu;
