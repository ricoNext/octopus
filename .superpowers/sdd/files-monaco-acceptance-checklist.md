# Monaco file editor acceptance checklist

**Scope:** Task 5 polish and manual acceptance for editable Monaco file tabs.
**Manual owner:** User. The GUI items below intentionally remain unchecked; no GUI acceptance is claimed by this task.

## Automated verification

These checks are automated implementation checks, not a substitute for the manual GUI pass:

- [x] `bunx tsc --noEmit` — passes.
- [x] `bun test src/lib/files/language-from-path.test.ts` — 15 tests pass, including `.ts`/`.js` mappings and unknown-extension `plaintext` fallback.
- [x] `cd src-tauri && cargo test write_ -- --nocapture` — Rust write round-trip and path-escape tests pass.

## Manual GUI acceptance (user-owned)

Run the app with `bun run tauri:dev`, then exercise the following in a workspace with representative text files:

- [ ] **TypeScript and JavaScript editing:** Open a `.ts` file and a `.js` file from Files. Syntax highlighting is visible for each; the editor accepts keyboard input, cursor movement, click placement, text selection, and replacement.
- [ ] **Dirty state and explicit save:** Edit a file and confirm a dirty dot appears beside its center-tab label. Click **保存** and confirm the dot clears and the changed contents persist on disk. Repeat with Cmd+S (Ctrl+S where applicable); confirm it also clears the dot and persists the contents. No save should happen merely by switching tabs.
- [ ] **Dirty close choices:** After editing a file, close its dirty tab and verify:
  - [ ] **保存** writes the buffer and closes the tab.
  - [ ] **不保存** discards the buffer and closes the tab.
  - [ ] **取消** leaves the tab open with its buffer and dirty marker unchanged.
- [ ] **Theme synchronization:** Toggle the App between light and dark themes while a file editor is open. Monaco follows with the light (`vs`) and dark (`vs-dark`) editor themes.
- [ ] **Unknown extension:** Open a file with an unmapped extension (for example `.unknown`). It opens as editable plaintext; typing, selection, and explicit save work.
- [ ] **Terminal strip parity:** Confirm terminal tabs and their strip behavior remain unchanged: terminal tabs still open, activate, close, and retain their existing strip controls/layout; the file editor adds no duplicate filename header or terminal controls.
- [ ] **Batch-close dirty guard:** With dirty file tabs included in the target set, verify each of **Close others**, **Close to the left**, and **Close to the right** is blocked and shows the unsaved-file toast (`有未保存的文件标签，请先保存或单独关闭后再试`). No targeted dirty file tab closes. After saving or individually closing the dirty file, repeat the batch action and confirm the eligible clean tabs close normally.

## Result

- Manual GUI acceptance: **pending user verification**.
- Automated checks above are green; they do not mark the manual items as passed.
