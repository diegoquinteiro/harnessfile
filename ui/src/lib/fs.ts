import JSZip from 'jszip'

/** Minimal typings for the File System Access API (not yet in lib.dom). */
interface FSFileHandle {
  kind: 'file'
  name: string
  getFile(): Promise<File>
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>
}
export interface FSDirectoryHandle {
  kind: 'directory'
  name: string
  values(): AsyncIterable<FSFileHandle | FSDirectoryHandle>
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FSDirectoryHandle>
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FSFileHandle>
}

declare global {
  interface Window {
    showDirectoryPicker?(opts?: { mode?: 'read' | 'readwrite' }): Promise<FSDirectoryHandle>
  }
}

export function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.DS_Store'])
const TEXT_LIMIT = 2 * 1024 * 1024 // don't slurp binaries/huge files into the editor

async function readDirRecursive(
  dir: FSDirectoryHandle,
  prefix: string,
  out: Record<string, string>,
): Promise<void> {
  for await (const entry of dir.values()) {
    if (SKIP_DIRS.has(entry.name)) continue
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.kind === 'file') {
      const file = await entry.getFile()
      if (file.size > TEXT_LIMIT) continue
      out[path] = await file.text()
    } else {
      await readDirRecursive(entry, path, out)
    }
  }
}

/**
 * Given a picked directory, locate the `.agents/` root: either the directory
 * itself contains harness.yaml, or it has a `.agents/` child that does.
 */
async function findAgentsRoot(dir: FSDirectoryHandle): Promise<FSDirectoryHandle | null> {
  try {
    await dir.getFileHandle('harness.yaml')
    return dir
  } catch {
    /* not here */
  }
  try {
    const child = await dir.getDirectoryHandle('.agents')
    await child.getFileHandle('harness.yaml')
    return child
  } catch {
    return null
  }
}

export interface OpenedDirectory {
  files: Record<string, string>
  name: string
  handle: FSDirectoryHandle | null
}

/** Open via the File System Access API. Returns null if the user cancelled. */
export async function openDirectoryPicker(): Promise<OpenedDirectory | null> {
  if (!window.showDirectoryPicker) return null
  let dir: FSDirectoryHandle
  try {
    dir = await window.showDirectoryPicker({ mode: 'readwrite' })
  } catch {
    return null // cancelled
  }
  const root = await findAgentsRoot(dir)
  if (!root) throw new Error(`No harness.yaml found in "${dir.name}" or its .agents/ child`)
  const files: Record<string, string> = {}
  await readDirRecursive(root, '', files)
  return { files, name: dir.name, handle: root }
}

/** Fallback open: a FileList from an <input webkitdirectory> element. */
export async function filesFromInput(list: FileList): Promise<OpenedDirectory | null> {
  const entries: { rel: string; file: File }[] = []
  for (const file of Array.from(list)) {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
    entries.push({ rel, file })
  }
  // Find the harness.yaml closest to the top; strip everything above it.
  const harness = entries
    .filter((e) => e.rel.endsWith('/harness.yaml') || e.rel === 'harness.yaml')
    .sort((a, b) => a.rel.split('/').length - b.rel.split('/').length)[0]
  if (!harness) return null
  const prefix = harness.rel.slice(0, harness.rel.length - 'harness.yaml'.length)
  const files: Record<string, string> = {}
  for (const { rel, file } of entries) {
    if (!rel.startsWith(prefix)) continue
    if (file.size > TEXT_LIMIT) continue
    const path = rel.slice(prefix.length)
    if (path.split('/').some((seg) => SKIP_DIRS.has(seg))) continue
    files[path] = await file.text()
  }
  const name = prefix.split('/').filter(Boolean)[0] ?? 'directory'
  return { files, name, handle: null }
}

/** Write only the changed files back through the directory handle. */
export async function writeFiles(
  root: FSDirectoryHandle,
  files: Record<string, string>,
  paths: string[],
): Promise<void> {
  for (const path of paths) {
    const segments = path.split('/')
    const fileName = segments.pop()!
    let dir = root
    for (const segment of segments) {
      dir = await dir.getDirectoryHandle(segment, { create: true })
    }
    const handle = await dir.getFileHandle(fileName, { create: true })
    const writable = await handle.createWritable()
    await writable.write(files[path])
    await writable.close()
  }
}

/** Export the whole directory as a zip download. */
export async function exportZip(files: Record<string, string>, name: string): Promise<void> {
  const zip = new JSZip()
  for (const [path, text] of Object.entries(files)) {
    zip.file(`.agents/${path}`, text)
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name || 'harness'}-agents.zip`
  a.click()
  URL.revokeObjectURL(url)
}
