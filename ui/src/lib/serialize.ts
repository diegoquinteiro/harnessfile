import yaml from 'js-yaml'
import type { HarnessDoc } from '../types'

export { joinFrontmatter } from './frontmatter'

/**
 * Serialize harness.yaml. Only called for documents the user actually edited;
 * untouched files always round-trip byte-for-byte from the original text.
 */
export function dumpHarness(doc: HarnessDoc): string {
  return yaml.dump(doc, { lineWidth: 100, noRefs: true, quotingType: '"' })
}
