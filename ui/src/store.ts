import { create } from 'zustand'
import { DEMO_NAME, demoFiles } from './demo'
import { exportZip, writeFiles, type FSDirectoryHandle, type OpenedDirectory } from './lib/fs'
import { parseProject, type ParsedProject } from './lib/parse'
import { dumpHarness, joinFrontmatter } from './lib/serialize'
import { validate } from './lib/validate'
import type { EntityDoc, HarnessDoc, Problem, SkillInfo } from './types'

export type EntityKind = 'agent' | 'squad' | 'skill'

export type View =
  | { kind: 'graph' }
  | { kind: 'entity'; entity: EntityKind; slug: string }
  | { kind: 'targets' }

interface HarnessState {
  // virtual file set — paths relative to the .agents/ root
  files: Record<string, string>
  dirty: Record<string, true>
  handle: FSDirectoryHandle | null
  sourceName: string

  // parsed model
  harness: HarnessDoc | null
  parseError: string | null
  agents: EntityDoc[]
  squads: EntityDoc[]
  skills: SkillInfo[]
  problems: Problem[]

  // ui
  view: View
  selectedNode: string | null
  problemsOpen: boolean
  notice: string | null

  loadDemo: () => void
  loadDirectory: (opened: OpenedDirectory) => void
  setView: (view: View) => void
  selectNode: (id: string | null) => void
  toggleProblems: () => void
  setNotice: (notice: string | null) => void

  updateHarness: (mutate: (doc: HarnessDoc) => void) => void
  updateEntity: (kind: 'agent' | 'squad', slug: string, fm: Record<string, unknown>, body: string) => void
  updateFile: (path: string, text: string) => void

  saveInPlace: () => Promise<void>
  downloadZip: () => Promise<void>
}

function derive(files: Record<string, string>): ParsedProject & { problems: Problem[] } {
  const parsed = parseProject(files)
  return { ...parsed, problems: validate(parsed) }
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined

export const useStore = create<HarnessState>((set, get) => ({
  files: {},
  dirty: {},
  handle: null,
  sourceName: '',
  harness: null,
  parseError: null,
  agents: [],
  squads: [],
  skills: [],
  problems: [],
  view: { kind: 'graph' },
  selectedNode: null,
  problemsOpen: true,
  notice: null,

  loadDemo: () => {
    const files = demoFiles()
    set({
      files,
      dirty: {},
      handle: null,
      sourceName: DEMO_NAME,
      view: { kind: 'graph' },
      selectedNode: null,
      problemsOpen: true,
      ...derive(files),
    })
  },

  loadDirectory: (opened) => {
    set({
      files: opened.files,
      dirty: {},
      handle: opened.handle,
      sourceName: opened.name,
      view: { kind: 'graph' },
      selectedNode: null,
      problemsOpen: true,
      ...derive(opened.files),
    })
  },

  setView: (view) => set({ view }),
  selectNode: (id) => set({ selectedNode: id }),
  toggleProblems: () => set((s) => ({ problemsOpen: !s.problemsOpen })),

  setNotice: (notice) => {
    if (noticeTimer) clearTimeout(noticeTimer)
    set({ notice })
    if (notice) {
      noticeTimer = setTimeout(() => set({ notice: null }), 4000)
    }
  },

  updateHarness: (mutate) => {
    const { harness, files, dirty } = get()
    if (!harness) return
    const doc = structuredClone(harness)
    mutate(doc)
    const nextFiles = { ...files, 'harness.yaml': dumpHarness(doc) }
    set({
      files: nextFiles,
      dirty: { ...dirty, 'harness.yaml': true },
      ...derive(nextFiles),
    })
  },

  updateEntity: (kind, slug, fm, body) => {
    const { files, dirty } = get()
    const list = kind === 'agent' ? get().agents : get().squads
    const entity = list.find((e) => e.slug === slug)
    if (!entity) return
    const nextFiles = { ...files, [entity.path]: joinFrontmatter(fm, body) }
    set({
      files: nextFiles,
      dirty: { ...dirty, [entity.path]: true },
      ...derive(nextFiles),
    })
  },

  updateFile: (path, text) => {
    const { files, dirty } = get()
    if (!(path in files) || files[path] === text) return
    const nextFiles = { ...files, [path]: text }
    set({
      files: nextFiles,
      dirty: { ...dirty, [path]: true },
      ...derive(nextFiles),
    })
  },

  saveInPlace: async () => {
    const { handle, files, dirty, setNotice } = get()
    if (!handle) {
      await get().downloadZip()
      return
    }
    const paths = Object.keys(dirty)
    if (paths.length === 0) {
      setNotice('nothing to save')
      return
    }
    await writeFiles(handle, files, paths)
    set({ dirty: {} })
    setNotice(`saved · ${paths.length} file${paths.length === 1 ? '' : 's'}`)
  },

  downloadZip: async () => {
    const { files, harness, setNotice } = get()
    await exportZip(files, typeof harness?.name === 'string' ? harness.name : 'harness')
    setNotice('exported zip')
  },
}))

// Dev-only hook for driving the store from browser automation.
if (import.meta.env.DEV) {
  ;(window as unknown as { __harnessStore?: typeof useStore }).__harnessStore = useStore
}
