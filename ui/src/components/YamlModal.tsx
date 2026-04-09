import { type FC, useMemo } from 'react';
import { X, Copy, Download, Check } from 'lucide-react';
import { useHarnessStore } from '../store/useHarnessStore';
import { exportToYaml } from '../utils/yamlExport';
import { useState } from 'react';

const YamlModal: FC = () => {
  const {
    showYaml, setShowYaml,
    nodes, edges, agents, harnessName,
    observability, memory, security, resilience, hooks,
  } = useHarnessStore();
  const [copied, setCopied] = useState(false);

  const yamlStr = useMemo(() => {
    if (!showYaml) return '';
    return exportToYaml(nodes, edges, agents, harnessName, observability, memory, security, resilience, hooks);
  }, [showYaml, nodes, edges, agents, harnessName, observability, memory, security, resilience, hooks]);

  if (!showYaml) return null;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(yamlStr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([yamlStr], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'harnessfile.yaml';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
      onClick={() => setShowYaml(false)}
    >
      <div
        className="rounded-2xl overflow-hidden max-w-2xl w-full mx-4 flex flex-col"
        style={{
          background: 'var(--color-surface-1)',
          border: '1px solid var(--color-border-2)',
          boxShadow: '0 32px 64px rgba(0,0,0,0.6)',
          height: '75vh',
          maxHeight: 700,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid var(--color-border-1)' }}>
          <div>
            <h3 className="text-sm font-semibold m-0" style={{ color: 'var(--color-text-1)' }}>
              harnessfile.yaml
            </h3>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-3)' }}>
              Generated from your visual graph
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer transition-colors border-none"
              style={{
                background: copied ? 'var(--color-green-soft)' : 'var(--color-surface-3)',
                color: copied ? 'var(--color-green)' : 'var(--color-text-2)',
              }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer transition-colors border-none"
              style={{ background: 'var(--color-amber-soft)', color: 'var(--color-amber)' }}
            >
              <Download size={13} />
              Download
            </button>
            <button
              onClick={() => setShowYaml(false)}
              className="p-1.5 bg-transparent border-none cursor-pointer ml-2"
              style={{ color: 'var(--color-text-3)' }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* YAML content */}
        <div className="flex-1 overflow-auto p-5">
          <pre
            className="text-[13px] leading-relaxed m-0 whitespace-pre"
            style={{
              fontFamily: 'var(--font-mono)',
              color: 'var(--color-text-2)',
            }}
          >
            {yamlStr || '# Empty harness — add agents and steps to generate YAML'}
          </pre>
        </div>
      </div>
    </div>
  );
};

export default YamlModal;
