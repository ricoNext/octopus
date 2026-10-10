# Agents Settings MVP: Manual Acceptance Checklist

**Feature:** Settings → Agents（内置 codex / codebuddy、启动下拉、右栏启用过滤）  
**Spec:** `docs/superpowers/specs/2026-10-10-agents-settings-design.md`  
**Plan Task 6:** `docs/superpowers/plans/2026-10-10-agents-settings.md`  
**Code base for check:** Task 5 `785079c` + Task 6 polish (this commit)

**How to run:** `bun run tauri:dev`（需本机 GUI；未跑勿勾选）

**Status:** Checklist authored only. Manual GUI results not recorded (do not invent).

---

- [ ] 1. Settings → Agents：两者（Codex / CodeBuddy）显示；Refresh 后安装状态正确。
- [ ] 2. 改 command 为绝对路径 → 新建终端选该 agent → 终端内出现启动命令；Reset 恢复 catalog 默认。
- [ ] 3. 默认设为空白 / codex / codebuddy → 「+」下拉预选（或快捷键 `tab.newTerminal`）行为正确。
- [ ] 4. 禁用 codebuddy → 下拉无此项；正在跑的 codebuddy 行从右栏消失；再启用恢复识别。禁用当前默认时 Select 跳到回落值并 toast「默认 Agent 已改为 …」。
- [ ] 5. 未安装 agent 仍可选 → 有提示且不崩。
- [ ] 6. 右栏点击聚焦行为相对 Phase 1 不变。
