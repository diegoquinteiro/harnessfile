/**
 * Built-in demo: the AltaVox development harness.
 *
 * The files under ./altavox/ are a copy of examples/altavox/.agents/ from the
 * repository root — copied in because import.meta.glob cannot reach outside
 * the Vite root (ui/). Keep them in sync with the canonical example.
 */
const raw = import.meta.glob('./altavox/**/*', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export function demoFiles(): Record<string, string> {
  const files: Record<string, string> = {}
  for (const [key, text] of Object.entries(raw)) {
    files[key.replace(/^\.\/altavox\//, '')] = text
  }
  return files
}

export const DEMO_NAME = 'altavox (demo)'
