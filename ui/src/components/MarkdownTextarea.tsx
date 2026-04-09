import { type FC, useState, useRef, useCallback } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface MarkdownTextareaProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minRows?: number;
  maxRows?: number;
}

// Minimal markdown to HTML (bold, italic, code, links, line breaks)
function renderMarkdown(md: string): string {
  return md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/`([^`]+)`/g, '<code style="background:var(--color-surface-3);padding:1px 4px;border-radius:3px;font-size:0.9em">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br/>');
}

const MarkdownTextarea: FC<MarkdownTextareaProps> = ({
  value,
  onChange,
  placeholder = 'Write here...',
  minRows = 3,
  maxRows = 10,
}) => {
  const [preview, setPreview] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Block all drag/mouse events from propagating to React Flow
  const blockDrag = useCallback((e: React.SyntheticEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      className="nodrag nowheel rounded-lg overflow-hidden"
      style={{
        background: 'var(--color-surface-0)',
        border: '1px solid var(--color-border-1)',
      }}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-2 py-1"
        style={{ borderBottom: '1px solid var(--color-border-1)' }}>
        <span className="text-[8px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-3)' }}>
          markdown
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); setPreview(!preview); }}
          onMouseDown={blockDrag}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-medium bg-transparent border-none transition-colors"
          style={{ color: preview ? 'var(--color-amber)' : 'var(--color-text-3)', cursor: 'default' }}
        >
          {preview ? <EyeOff size={9} /> : <Eye size={9} />}
          {preview ? 'edit' : 'preview'}
        </button>
      </div>

      {preview ? (
        <div
          className="px-2.5 py-2 text-[10px] leading-relaxed overflow-auto"
          style={{
            color: 'var(--color-text-1)',
            minHeight: minRows * 18,
            maxHeight: maxRows * 18,
          }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(value || '<span style="color:var(--color-text-3)">Nothing to preview</span>') }}
        />
      ) : (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={minRows}
          className="nodrag nowheel nopan w-full px-2.5 py-2 outline-none resize-y text-[10px] leading-relaxed bg-transparent border-none"
          style={{
            color: 'var(--color-text-1)',
            fontFamily: 'var(--font-mono)',
            minHeight: minRows * 18,
            maxHeight: maxRows * 18,
          }}
        />
      )}
    </div>
  );
};

export default MarkdownTextarea;
