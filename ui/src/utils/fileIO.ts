/**
 * Browser-native file open/save helpers.
 * Uses the File System Access API where available, falls back to
 * hidden <input type="file"> and <a download> for Safari/Firefox.
 */

// Minimal type declarations — avoid pulling DOM lib dependencies.
interface FSFileHandle {
  name: string;
  createWritable(): Promise<{
    write(data: string | Blob): Promise<void>;
    close(): Promise<void>;
  }>;
  getFile(): Promise<File>;
}

interface FSWindow {
  showOpenFilePicker?: (opts?: unknown) => Promise<FSFileHandle[]>;
  showSaveFilePicker?: (opts?: unknown) => Promise<FSFileHandle>;
}

export interface OpenedFile {
  text: string;
  handle: FSFileHandle | null;
  name: string;
}

const pickerTypes = [
  {
    description: 'Harnessfile (YAML)',
    accept: {
      'text/yaml': ['.yaml', '.yml', '.harnessfile'],
    },
  },
];

export async function openFile(): Promise<OpenedFile | null> {
  const w = window as unknown as FSWindow;

  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({
        types: pickerTypes,
        multiple: false,
      });
      const file = await handle.getFile();
      const text = await file.text();
      return { text, handle, name: file.name };
    } catch (err) {
      if ((err as Error).name === 'AbortError') return null;
      throw err;
    }
  }

  // Fallback: hidden file input
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.yaml,.yml,.harnessfile';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const text = await file.text();
      resolve({ text, handle: null, name: file.name });
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Save using existing handle if present, otherwise prompt Save As. */
export async function saveFile(
  content: string,
  handle: FSFileHandle | null,
  suggestedName = 'harnessfile.yaml',
): Promise<{ handle: FSFileHandle | null; name: string } | null> {
  if (handle) {
    try {
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return { handle, name: handle.name };
    } catch (err) {
      console.error('Save failed, falling back to Save As', err);
    }
  }
  return saveAsFile(content, suggestedName);
}

export async function saveAsFile(
  content: string,
  suggestedName = 'harnessfile.yaml',
): Promise<{ handle: FSFileHandle | null; name: string } | null> {
  const w = window as unknown as FSWindow;

  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName,
        types: pickerTypes,
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return { handle, name: handle.name };
    } catch (err) {
      if ((err as Error).name === 'AbortError') return null;
      throw err;
    }
  }

  // Fallback: anchor download
  const blob = new Blob([content], { type: 'text/yaml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(url);
  return { handle: null, name: suggestedName };
}

export type { FSFileHandle };
