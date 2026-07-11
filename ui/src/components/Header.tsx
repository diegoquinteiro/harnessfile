import { useRef } from 'react'
import { filesFromInput, openDirectoryPicker, supportsFileSystemAccess } from '../lib/fs'
import { useStore } from '../store'

export function Header() {
  const harness = useStore((s) => s.harness)
  const sourceName = useStore((s) => s.sourceName)
  const dirty = useStore((s) => s.dirty)
  const handle = useStore((s) => s.handle)
  const loadDirectory = useStore((s) => s.loadDirectory)
  const loadDemo = useStore((s) => s.loadDemo)
  const saveInPlace = useStore((s) => s.saveInPlace)
  const downloadZip = useStore((s) => s.downloadZip)
  const setNotice = useStore((s) => s.setNotice)

  const inputRef = useRef<HTMLInputElement>(null)
  const dirtyCount = Object.keys(dirty).length

  const onOpen = async () => {
    if (supportsFileSystemAccess()) {
      try {
        const opened = await openDirectoryPicker()
        if (opened) loadDirectory(opened)
      } catch (e) {
        setNotice(e instanceof Error ? e.message : 'could not open directory')
      }
    } else {
      inputRef.current?.click()
    }
  }

  const onInputChange = async (list: FileList | null) => {
    if (!list || list.length === 0) return
    const opened = await filesFromInput(list)
    if (opened) loadDirectory(opened)
    else setNotice('no harness.yaml found in the selected directory')
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="wordmark">
          Harness<em>file</em>
        </span>
        <span className="topbar__harness">
          {typeof harness?.name === 'string' ? harness.name : 'no harness'}
          {sourceName ? ` · ${sourceName}` : ''}
          {dirtyCount > 0 && <span className="accent"> · {dirtyCount} edited</span>}
        </span>
      </div>
      <div className="topbar__actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={loadDemo}>
          Demo
        </button>
        <button type="button" className="btn btn--outline btn--sm" onClick={onOpen}>
          Open directory
        </button>
        <button
          type="button"
          className={`btn btn--sm ${handle ? 'btn--outline' : 'btn--primary'}`}
          onClick={() => void downloadZip()}
          title="Download the whole .agents/ directory as a zip"
        >
          Export zip
        </button>
        {handle && (
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => void saveInPlace()}
            title="Write only the changed files back to disk"
          >
            Save
          </button>
        )}
        {/* Fallback for browsers without the File System Access API */}
        <input
          ref={inputRef}
          type="file"
          style={{ display: 'none' }}
          // @ts-expect-error non-standard attribute, needed for the directory fallback
          webkitdirectory=""
          multiple
          onChange={(e) => void onInputChange(e.target.files)}
        />
      </div>
    </header>
  )
}
