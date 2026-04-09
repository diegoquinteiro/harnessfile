import { type FC, useState, useRef, useCallback, useEffect } from 'react';
import { X } from 'lucide-react';

interface TagInputProps {
  values: string[];
  onChange: (values: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  color?: string;        // pill accent color
  colorSoft?: string;    // pill background
  border?: string;       // pill border
  mono?: boolean;
}

const TagInput: FC<TagInputProps> = ({
  values,
  onChange,
  suggestions = [],
  placeholder = 'Add...',
  color = 'var(--color-blue)',
  colorSoft = 'var(--color-blue-soft)',
  border = 'rgba(61,139,253,0.25)',
  mono = false,
}) => {
  const [input, setInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = suggestions.filter(
    (s) => !values.includes(s) && s.toLowerCase().includes(input.toLowerCase())
  );

  const addTag = useCallback((tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setInput('');
    setShowSuggestions(false);
    setHighlightIdx(-1);
    inputRef.current?.focus();
  }, [values, onChange]);

  const removeTag = useCallback((idx: number) => {
    onChange(values.filter((_, i) => i !== idx));
  }, [values, onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightIdx >= 0 && highlightIdx < filtered.length) {
        addTag(filtered[highlightIdx]);
      } else if (input.trim()) {
        addTag(input);
      }
    } else if (e.key === 'Backspace' && !input && values.length > 0) {
      removeTag(values.length - 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setHighlightIdx(-1);
    }
  }, [input, values, filtered, highlightIdx, addTag, removeTag]);

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={containerRef} className="nodrag nowheel relative" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      {/* Tag area + input */}
      <div
        className="flex flex-wrap items-center gap-1 rounded-md px-1.5 py-1 min-h-[28px] cursor-text transition-colors"
        style={{
          background: 'var(--color-surface-0)',
          border: '1px solid var(--color-border-1)',
        }}
        onClick={() => inputRef.current?.focus()}
      >
        {values.map((tag, i) => (
          <span
            key={`${tag}-${i}`}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium shrink-0"
            style={{
              color,
              background: colorSoft,
              border: `1px solid ${border}`,
              fontFamily: mono ? 'var(--font-mono)' : 'inherit',
            }}
          >
            {tag}
            <button
              onClick={(e) => { e.stopPropagation(); removeTag(i); }}
              onMouseDown={(e) => e.stopPropagation()}
              className="bg-transparent border-none p-0 cursor-pointer flex items-center"
              style={{ color, opacity: 0.6 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = '0.6'; }}
            >
              <X size={9} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setShowSuggestions(true);
            setHighlightIdx(-1);
          }}
          onFocus={() => setShowSuggestions(true)}
          onKeyDown={handleKeyDown}
          placeholder={values.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[60px] bg-transparent border-none outline-none p-0 text-[10px]"
          style={{
            color: 'var(--color-text-1)',
            fontFamily: mono ? 'var(--font-mono)' : 'inherit',
          }}
        />
      </div>

      {/* Autocomplete dropdown */}
      {showSuggestions && filtered.length > 0 && (
        <div
          className="absolute left-0 right-0 z-50 mt-1 rounded-lg py-0.5 overflow-hidden"
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border-2)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            maxHeight: 120,
            overflowY: 'auto',
          }}
        >
          {filtered.map((s, i) => (
            <button
              key={s}
              onClick={() => addTag(s)}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHighlightIdx(i)}
              className="w-full text-left px-2.5 py-1.5 cursor-pointer bg-transparent border-none text-[10px] font-medium transition-colors"
              style={{
                color: i === highlightIdx ? color : 'var(--color-text-2)',
                background: i === highlightIdx ? colorSoft : 'transparent',
                fontFamily: mono ? 'var(--font-mono)' : 'inherit',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default TagInput;
