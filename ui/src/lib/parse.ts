import yaml from 'js-yaml'
import { splitFrontmatter } from './frontmatter'
import type { EntityDoc, HarnessDoc, SkillInfo } from '../types'

export interface ParsedProject {
  harness: HarnessDoc | null
  parseError: string | null
  agents: EntityDoc[]
  squads: EntityDoc[]
  skills: SkillInfo[]
}

/**
 * Parse a `.agents/` directory (as a path -> text map, paths relative to the
 * directory root) into the editor model.
 */
export function parseProject(files: Record<string, string>): ParsedProject {
  let harness: HarnessDoc | null = null
  let parseError: string | null = null

  const harnessText = files['harness.yaml']
  if (harnessText === undefined) {
    parseError = 'harness.yaml not found in the directory'
  } else {
    try {
      const doc = yaml.load(harnessText)
      if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
        harness = doc as HarnessDoc
      } else {
        parseError = 'harness.yaml is not a YAML mapping'
      }
    } catch (e) {
      parseError = `harness.yaml: ${e instanceof Error ? e.message.split('\n')[0] : 'YAML parse error'}`
    }
  }

  const agents: EntityDoc[] = []
  const squads: EntityDoc[] = []
  const skills: SkillInfo[] = []

  for (const [path, text] of Object.entries(files)) {
    let m = path.match(/^agents\/([^/]+)\.md$/)
    if (m) {
      const { fm, body } = splitFrontmatter(text)
      agents.push({ slug: m[1], path, fm, body })
      continue
    }
    m = path.match(/^squads\/([^/]+)\.md$/)
    if (m) {
      const { fm, body } = splitFrontmatter(text)
      squads.push({ slug: m[1], path, fm, body })
      continue
    }
    m = path.match(/^skills\/([^/]+)\/SKILL\.md$/)
    if (m) {
      const { fm } = splitFrontmatter(text)
      skills.push({
        name: typeof fm.name === 'string' ? fm.name : m[1],
        description: typeof fm.description === 'string' ? fm.description : '',
        path,
      })
    }
  }

  const bySlug = (a: { slug: string }, b: { slug: string }) => a.slug.localeCompare(b.slug)
  agents.sort(bySlug)
  squads.sort(bySlug)
  skills.sort((a, b) => a.name.localeCompare(b.name))

  return { harness, parseError, agents, squads, skills }
}

/** Resolve a trigger `prompt:` value to a file path in the set, if it is one. */
export function resolvePromptPath(
  prompt: string | undefined,
  files: Record<string, string>,
): string | null {
  if (!prompt) return null
  const candidate = prompt.replace(/^\.\//, '')
  if (candidate in files) return candidate
  return null
}
