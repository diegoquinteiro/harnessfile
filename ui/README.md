# Harnessfile visual editor

A local-first visual editor/viewer for a Harnessfile v0.2 `.agents/` directory: load a
directory, see the harness graph and every entity (agents, squads, skills, targets), edit
them, and write the result back.

- **Open**: File System Access API (`showDirectoryPicker`) where available, with an
  `<input webkitdirectory>` fallback. Pick either the `.agents/` directory itself or a
  repository root containing one.
- **Save**: writes only the changed files back in place (File System Access), or exports
  the whole directory as a zip.
- **Round-trip fidelity**: files you did not edit pass through byte-for-byte; unknown
  frontmatter keys (e.g. `multica.display_name`) are preserved.
- **Demo**: the AltaVox harness from `examples/altavox/.agents/` is bundled as the built-in
  demo (copied into `src/demo/altavox/` — keep it in sync with the canonical example).
- **Design**: Fermata design system (Linho + Carmim, Cormorant Garamond / Inter / DM Mono),
  plain CSS custom properties — no CSS framework.

## Develop

```
npm install
npm run dev      # local dev server
npm run build    # tsc + vite build
```

## Layout

```
src/
├── lib/          # parse / serialize / validate / dagre layout / file-system access
├── components/   # header, library, graph, inspector, entity editor, targets, status bar
├── styles/       # fermata.css (tokens, replicated from the Fermata repo) + app.css
├── demo/         # bundled AltaVox example (.agents mirror)
└── store.ts      # single zustand store; the file map is the source of truth
```
