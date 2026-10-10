# Agents Settings MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 octopus 中落地「配置应用支持的 agent 工具」MVP：内置 `codex` / `codebuddy` 目录、PATH 检测、启用/禁用、全局默认（含空白终端）、command/args/env 覆盖与 Reset、新建终端下拉启动、右栏只认已启用 id。

**Architecture:** Rust 内置 catalog + 用户覆盖持久化到 `app_data_dir/agent-settings.json`；Tauri commands 负责读/写/检测/解析启动行；PTY 仍先开登录壳，选 agent 时在 open 后由 host 向该 session `pty_write` 解析后的启动行（并合并 env 到 shell export 前缀）。Daemon 继续做进程名匹配；**禁用过滤在 host 桥接层**（emit / `list_agent_presence`）完成，避免改 daemon 协议。FE：`Settings → Agents` 新分区 + 新建终端 `DropdownMenu`；快捷键 `tab.newTerminal` 直接用当前默认（不弹菜单）。

**Tech Stack:** Tauri 2 + Rust（`agent_catalog` / `agent_detect` / `pty` / `commands`）、React 19 + Vitest、现有 `SettingsPage`（`App.tsx`）、`sonner` toast、`DropdownMenu` / `Select` / `Checkbox` / `Input`。

**Spec:** `docs/superpowers/specs/2026-10-10-agents-settings-design.md`（commit `75b38dc`）

## Global Constraints

- Local MacBook only（`/Users/ricolee/Desktop/rico/octopus`）；**禁止** Cloud Agent / 远程改代码。
- 目录第一期**仅** `codex` + `codebuddy`；不做用户自定义新 agent 类型。
- **不做** prompt 注入（argv / flag / stdin 任务文本）。
- 新建终端下拉必须保留 **空白终端**；默认可为 `blank`。
- 禁用某 agent：**下拉不出现** 且 **右栏不再认**（host 过滤 presence）。
- 拖动/看板等不得自动启停 agent。
- UI 文案中文，与现有设置页语气一致（如「未检测到」「设为默认」「重置」「空白终端」）。
- TDD：Rust 纯函数与 FE 解析/回落逻辑优先写失败测试。
- 设置持久化走 **Rust `agent-settings.json`**（daemon/host 可同源读取），**不要**只写 localStorage（主题那套不够给 presence 过滤用）。
- 变更默认时若禁用当前 `defaultAgent`：回落到第一个仍启用的 catalog id；若无一启用 → `"blank"`，并 toast 提示。

---

## File map

| File | Responsibility |
|---|---|
| `src-tauri/src/agent_catalog.rs` | 内置目录；启用判定；override 合并；defaultAgent 回落；PATH 检测；拼启动行；单元测试 |
| `src-tauri/src/agent_detect.rs` | `match_agent_names` 改为接受「启用 processMatch 集合」（保持 CodeBuddy > Codex 优先）；旧硬编码改为由调用方传入或默认全开 |
| `src-tauri/src/agent_settings.rs` | `AgentUserSettings` 读写 `agent-settings.json` |
| `src-tauri/src/commands.rs` | Tauri cmds：`agents_get_state` / `agents_save_settings` / `agents_refresh_detection` / `agents_resolve_launch`；`list_agent_presence` 按启用过滤 |
| `src-tauri/src/pty.rs` | Host 桥接 `agentPresence` 时按启用 id 过滤；可选：`pty_open` 增加可选 launch 后写入（见 Task 5） |
| `src-tauri/src/lib.rs` | `mod agent_catalog; mod agent_settings;` 注册新 commands |
| `src/lib/agents/types.ts` | 扩展 settings / catalog 行类型；`DefaultAgentId = AgentId \| "blank"` |
| `src/lib/agents/settings-resolve.ts` | FE 侧回落/启用列表纯函数（与 Rust 对齐，便于 Vitest） |
| `src/lib/agents/settings-resolve.test.ts` | Vitest |
| `src/lib/api.ts` | 新 agents\* API |
| `src/components/settings/AgentsSettingsSection.tsx` | Settings → Agents UI |
| `src/App.tsx` | SettingsPage 加「Agents」分区；`addTerminalTab(launch)`；+ 按钮改下拉；默认 agent 状态 |
| `src/components/TerminalPane.tsx` | 支持一次性 `launchAgentId`：open 成功后 resolve + ptyWrite |
| `src/lib/terminal/terminal-tab.ts` | 可选：`launchAgentId?: AgentId` 挂在 tab 或并行 `pendingLaunchBySession` map（推荐 App 侧 map，少改持久化 schema） |

---

### Task 1: Rust catalog + resolve + enabled + unit tests（TDD）

**Files:**
- Create: `src-tauri/src/agent_catalog.rs`
- Modify: `src-tauri/src/lib.rs`（`mod agent_catalog;`）
- Test: `agent_catalog.rs` 内 `#[cfg(test)]`

**Interfaces:**

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CatalogAgentId { Codex, CodeBuddy }

#[derive(Debug, Clone)]
pub struct CatalogEntry {
    pub id: CatalogAgentId,
    pub label: &'static str,
    pub detect_cmd: &'static str,
    pub launch_cmd: &'static str,
    pub process_match: &'static str,
    pub default_args: &'static [&'static str],
    pub default_env: &'static [(&'static str, &'static str)],
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentOverride {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cmd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<std::collections::BTreeMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentUserSettings {
    /// "codex" | "codebuddy" | "blank"
    pub default_agent: String,
    pub disabled_agents: Vec<String>,
    pub agent_overrides: std::collections::BTreeMap<String, AgentOverride>,
}

pub fn builtin_catalog() -> &'static [CatalogEntry];
pub fn parse_catalog_id(s: &str) -> Option<CatalogAgentId>;
pub fn is_enabled(settings: &AgentUserSettings, id: CatalogAgentId) -> bool;
pub fn enabled_ids(settings: &AgentUserSettings) -> Vec<CatalogAgentId>;
pub fn resolve_default_agent(settings: &AgentUserSettings) -> String; // may remap disabled → fallback
pub fn coalesce_default_on_disable(settings: &mut AgentUserSettings) -> bool; // true if changed
pub fn resolve_launch(settings: &AgentUserSettings, id: CatalogAgentId) -> ResolvedLaunch;
// ResolvedLaunch { cmd: String, args: Vec<String>, env: BTreeMap<String,String>, shell_line: String }
pub fn shell_quote_arg(s: &str) -> String;
pub fn build_shell_line(cmd: &str, args: &[String], env: &BTreeMap<String, String>) -> String;
pub fn detect_installed(detect_cmd: &str) -> bool; // PATH which；绝对路径则 metadata::is_file
```

默认迁移值：`default_agent = "codex"`，`disabled_agents = []`，`agent_overrides = {}`。

Catalog 初值（第一期）：

| id | detect/launch | process_match |
|---|---|---|
| codex | `codex` | `codex` |
| codebuddy | `codebuddy` | `codebuddy` |

`default_args` / `default_env` 先空。

- [ ] **Step 1: 写失败测试**（至少覆盖）

```rust
#[test]
fn enabled_false_when_disabled() { /* disabled_agents contains "codebuddy" */ }

#[test]
fn resolve_default_falls_back_when_disabled() {
    // default=codebuddy disabled → "codex"；两者都 disabled → "blank"
}

#[test]
fn override_cmd_and_args_merge() {
    // override cmd/args/env 覆盖 catalog；缺省字段回落默认
}

#[test]
fn build_shell_line_quotes_spaces_and_exports_env() {
    // env A=1 → 前缀 export；args 含空格需 quote
}

#[test]
fn detect_installed_absolute_missing_is_false() {
    assert!(!detect_installed("/no/such/agent-bin-octopus-test"));
}
```

- [ ] **Step 2: 跑测试 — 期望 FAIL**

```bash
cd src-tauri && cargo test agent_catalog -- --nocapture
```

- [ ] **Step 3: 实现 `agent_catalog.rs` 使测试通过**

- [ ] **Step 4: 再跑 — PASS**

```bash
cd src-tauri && cargo test agent_catalog -- --nocapture
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/agent_catalog.rs src-tauri/src/lib.rs
git commit -m "feat(agents): catalog resolve, enabled set, and launch line helpers"
```

---

### Task 2: Persist settings + Tauri commands + detection refresh

**Files:**
- Create: `src-tauri/src/agent_settings.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`（`mod agent_settings;` + `generate_handler!`）
- Modify: `src-tauri/src/commands.rs` `AppState` — 增加 `agent_settings_path: PathBuf` 与 `agent_settings: Mutex<AgentUserSettings>`
- Modify: `src/lib/api.ts`
- Modify: `src/lib/agents/types.ts`（DTO 类型）

**Interfaces:**

```rust
// agent_settings.rs
pub fn load(path: &Path) -> AgentUserSettings; // 缺文件 → Default
pub fn save(path: &Path, settings: &AgentUserSettings) -> Result<(), String>;

// commands — 返回给 FE 的聚合态
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentsStateDto {
    pub settings: AgentUserSettings,           // 已 coalesce default
    pub catalog: Vec<CatalogEntryDto>,         // id/label/detectCmd/launchCmd/...
    pub installed: std::collections::BTreeMap<String, bool>,
    pub resolved_default: String,              // 实际生效的 default
}

#[tauri::command]
fn agents_get_state(state: State<AppState>) -> Result<AgentsStateDto, String>;

#[tauri::command]
fn agents_save_settings(state: State<AppState>, settings: AgentUserSettings) -> Result<AgentsStateDto, String>;
// 内部分：coalesce_default_on_disable → save → 返回新 state

#[tauri::command]
fn agents_refresh_detection(state: State<AppState>) -> Result<AgentsStateDto, String>;

#[tauri::command]
fn agents_resolve_launch(state: State<AppState>, agent_id: String) -> Result<ResolvedLaunchDto, String>;
// 禁用或未知 id → Err("该 Agent 未启用或不存在")
```

`init_state`：`agent_settings_path = app_data_dir.join("agent-settings.json")`，load 进 Mutex。

- [ ] **Step 1: 实现 `agent_settings` load/save + 单测（tmpdir roundtrip）**

```bash
cd src-tauri && cargo test agent_settings -- --nocapture
```

- [ ] **Step 2: 扩展 `AppState` + 实现 4 个 commands + 注册**

- [ ] **Step 3: FE `api.ts` + types**

```ts
agentsGetState: () => invoke<AgentsStateDto>("agents_get_state"),
agentsSaveSettings: (settings: AgentUserSettings) =>
  invoke<AgentsStateDto>("agents_save_settings", { settings }),
agentsRefreshDetection: () => invoke<AgentsStateDto>("agents_refresh_detection"),
agentsResolveLaunch: (agentId: string) =>
  invoke<ResolvedLaunchDto>("agents_resolve_launch", { agentId }),
```

- [ ] **Step 4: `bunx tsc --noEmit`**

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/agent_settings.rs src-tauri/src/agent_catalog.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src/lib/api.ts src/lib/agents/types.ts
git commit -m "feat(agents): persist agent-settings.json and Tauri agents_* commands"
```

---

### Task 3: Wire presence whitelist to enabled ids

**Files:**
- Modify: `src-tauri/src/agent_detect.rs` — `match_agent_names(names, enabled: &[CatalogAgentId])` 或 `enabled_process_matches: &[&str]`（保留 CodeBuddy > Codex 优先）
- Modify: `src-tauri/src/pty.rs` — daemon 仍可检测全部 catalog process；**host `DaemonClient` 在转发 `agent-presence` / `cached_presence` / `list_agent_presence` 时过滤**
- Modify: `src-tauri/src/commands.rs` — `list_agent_presence` 过滤；`agents_save_settings` 成功后触发一次「按新启用集重放/清理」presence（对已缓存但已禁用的 session emit `agentId: null`）
- Create: `src/lib/agents/settings-resolve.ts` + `.test.ts` — `filterPresenceByEnabled` / `resolveDefaultAgent`（FE 二次过滤，防缓存脏数据）
- Modify: `src/lib/agents/build-rows.ts` 或 `App.tsx` — 构建 rows 前按启用集过滤
- Modify: `src/lib/agents/presence-store.ts`（可选）— 订阅时若带 enabled 过滤器

**决策（锁定）：**
- Daemon 进程匹配集合 = **完整内置 catalog 的 processMatch**（避免改 wire / 共享文件）。
- 「禁用不认」= host + FE 过滤。保存禁用后必须立刻从右栏消失（emit null 或本地 map delete）。

- [ ] **Step 1: Rust 测试 — `match_agent_names` 在 enabled 仅 Codex 时忽略 codebuddy basename**

```bash
cd src-tauri && cargo test agent_detect -- --nocapture
```

（若选择「daemon 仍全量匹配、host 过滤」，本步可改为测试 host 过滤纯函数，放在 `agent_catalog`：`fn presence_visible(agent_id: &str, settings) -> bool`。）

- [ ] **Step 2: 实现 host 过滤 + save 后清理**

在 `PtyManager` / `DaemonClient` 增加 `enabled_agent_ids: Arc<Mutex<HashSet<String>>>`，`init_state` 与 `agents_save_settings` 更新它；emit 前：

```rust
if let Some(id) = &agent_id {
  if !enabled.contains(id) {
    agent_id = None; // 对 FE 表现为离开
    process_name = None;
  }
}
```

- [ ] **Step 3: FE Vitest — 禁用 id 不进 rows**

```bash
bun test src/lib/agents/settings-resolve.test.ts src/lib/agents/build-rows.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/agent_detect.rs src-tauri/src/pty.rs src-tauri/src/commands.rs src/lib/agents
git commit -m "feat(agents): filter right-rail presence by enabled catalog ids"
```

---

### Task 4: Settings → Agents UI

**Files:**
- Create: `src/components/settings/AgentsSettingsSection.tsx`
- Modify: `src/App.tsx` — `SettingsPage` 增加 nav「Agents」；`activeSection` 联合类型加入 `"agents"`；挂载 section；App 根持有 `agentsState`（mount 时 `agentsGetState`）

**UI 行为（对照 spec）：**
1. 顶部：默认 agent `Select`：Codex / CodeBuddy / 空白终端（禁用中的 id 不要出现在可选项，或选中时立即回落）。
2. 每行 catalog：名称、安装状态（已安装 / 未检测到）、Refresh、启用 `Checkbox`、设为默认按钮、展开编辑 command / args（空格分隔文本）/ env（`KEY=VAL` 每行一个）、Reset。
3. 保存：任一控件变更 → `agentsSaveSettings`；失败 toast。
4. 若 save 触发 default 回落 → `toast.message("默认 Agent 已改为 …")`。
5. 不做安装商店外链。

- [ ] **Step 1: 抽出 `AgentsSettingsSection`，props 吃 `AgentsStateDto` + `onChange/onRefresh`**

- [ ] **Step 2: Settings 侧栏加入「Agents」**（图标可用现有 `BotIcon` / `SparklesIcon` / `TerminalIcon`——与 Agents 右栏一致者优先）

- [ ] **Step 3: 手动点进设置确认布局；`bunx tsc --noEmit`**

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/AgentsSettingsSection.tsx src/App.tsx
git commit -m "feat(agents): Settings → Agents page for catalog and overrides"
```

---

### Task 5: New terminal dropdown + launch into PTY

**Files:**
- Modify: `src/App.tsx` — `newTerminalButton` 改为 `DropdownMenu`：空白终端 + 已启用 agents；`addTerminalTab(launch: "blank" | AgentId)`；快捷键仍调用 `addTerminalTab(resolvedDefault)`
- Modify: `src/components/TerminalPane.tsx` — 新增可选 prop `launchAgentId?: AgentId | null`；`ptyOpen` 成功且 `isNew`（或 `recovery === "fresh"`）时：
  1. `api.agentsResolveLaunch(launchAgentId)`
  2. `api.ptyWrite(sessionId, shellLine + "\n")`
  3. 失败 → `toast.error`（「无法启动 Agent：…」）
- Modify: App 传递 launch：用 `pendingLaunchBySessionRef` / state map：`sessionId → AgentId`，创建 tab 时写入该 tab 唯一 leaf 的 session id；TerminalPane mount 消费一次后清除。
- **不要**把 `launchAgentId` 写入 `localStorage` 的终端持久化（避免冷启动重复注入）。

**启动语义：**
- blank：与今日一致，只开登录壳。
- agent：登录壳 + 写入 `build_shell_line`（含 export env）。
- 未安装仍可选；resolve 成功但命令不存在时依赖 shell 报错 + 可选 toast（若 `detect_installed` 为 false，可在写入前提前 `toast.error("未检测到 …，仍尝试启动")` 或硬失败——**锁定：提前 toast.warn 仍写入**，与 spec「允许选；启动失败 toast」一致；若 `ptyWrite`/`resolve` 抛错则 error toast）。

**菜单「新建标签」**（`lib.rs` `terminal-new-tab`）：与快捷键相同，走默认 agent，不弹 UI。

- [ ] **Step 1: 实现 pending launch map + DropdownMenu UI**

- [ ] **Step 2: TerminalPane 注入逻辑；确认 warm retain 重挂载不会二次注入**（仅 `attached.isNew || recovery === "fresh"`）

- [ ] **Step 3: `bunx tsc --noEmit`**

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/components/TerminalPane.tsx src/lib/api.ts
git commit -m "feat(agents): new-terminal dropdown launches configured agent into PTY"
```

---

### Task 6: Polish — default fallback UX, toasts, acceptance

**Files:**
- Modify: `src/components/settings/AgentsSettingsSection.tsx` / `App.tsx` — 禁用当前默认时的 toast 文案
- Modify: 若 Reset 后 UI 未刷新 resolved cmd，确保以 `agents_get_state` 返回为准
- Create（可选）: `src/lib/agents/settings-resolve.test.ts` 补齐与 Rust 一致的回落用例
- 更新 spec success criteria 对照自检（本 plan 文末表格）

- [ ] **Step 1: 禁用当前默认 → UI 默认 Select 跳到回落值 + toast**

- [ ] **Step 2: Reset 某一 agent 覆盖 → 输入框恢复 catalog 默认**

- [ ] **Step 3: 跑全量测试**

```bash
cd src-tauri && cargo test agent_catalog agent_settings agent_detect -- --nocapture
bun test src/lib/agents
bunx tsc --noEmit
```

- [ ] **Step 4: 手动验收清单**

```bash
bun run tauri:dev
```

1. Settings → Agents：两者显示；Refresh 后安装状态正确。  
2. 改 command 为绝对路径 → 新建终端选该 agent → 终端内出现启动命令；Reset 恢复。  
3. 默认设为空白 / codex / codebuddy → 「+」下拉预选（或快捷键）行为正确。  
4. 禁用 codebuddy → 下拉无此项；正在跑的 codebuddy 行从右栏消失；再启用恢复识别。  
5. 未安装 agent 仍可选 → 有提示且不崩。  
6. 右栏点击聚焦行为相对 Phase 1 不变。

- [ ] **Step 5: Commit**

```bash
git add src/components/settings src/App.tsx src/lib/agents src-tauri/src
git commit -m "fix(agents): default fallback toasts and Agents settings polish"
```

---

## Spec coverage self-check

| Spec item | Task |
|---|---|
| 内置目录仅 codex / codebuddy | Task 1 |
| PATH 检测 + Refresh | Task 1–2, 4 |
| 启用/禁用 | Task 1–2, 4 |
| 全局默认含 blank | Task 1–2, 4–5 |
| command/args/env + Reset | Task 1–2, 4 |
| 新建终端下拉启动 | Task 5 |
| 快捷键用默认 | Task 5 |
| 右栏只认已启用 | Task 3 |
| 无 prompt 注入 | Task 5（只写 launch 行） |
| 禁用回落 default | Task 1, 6 |
| 持久化全局设置 | Task 2（`agent-settings.json`） |
| 手动 + 自动验证 | Task 1, 3, 6 |

## Placeholder scan

无 TBD。启动注入锁定为：**登录壳 + `pty_write(shell_line)`**，且仅 fresh/new session 一次。Presence 禁用过滤锁定在 **host 桥接 + FE rows**，不改 daemon wire 协议。
