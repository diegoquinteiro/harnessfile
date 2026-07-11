import yaml from 'js-yaml'

/**
 * Hand-rolled `---` frontmatter splitter (no dependency on gray-matter).
 * Returns the parsed frontmatter object and the Markdown body.
 */
export function splitFrontmatter(text: string): {
  fm: Record<string, unknown>
  body: string
} {
  if (!text.startsWith('---')) return { fm: {}, body: text }
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
  if (!match) return { fm: {}, body: text }
  let fm: Record<string, unknown> = {}
  try {
    const parsed = yaml.load(match[1])
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      fm = parsed as Record<string, unknown>
    }
  } catch {
    // Malformed frontmatter is reported by validation; treat as empty here.
  }
  let body = text.slice(match[0].length)
  body = body.replace(/^\r?\n/, '')
  return { fm, body }
}

/** Reassemble a Markdown entity file from frontmatter + body. */
export function joinFrontmatter(fm: Record<string, unknown>, body: string): string {
  const fmText = yaml.dump(fm, { lineWidth: 100, noRefs: true })
  const trimmed = body.replace(/\s+$/, '')
  return `---\n${fmText}---\n\n${trimmed}\n`
}
