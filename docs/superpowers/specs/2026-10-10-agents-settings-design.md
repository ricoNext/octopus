# Agents Settings MVP（配置应用支持的 agent 工具）

**Date:** 2026-10-10  
**Status:** Approved (design dialogue)  
**Approach:** A — 配置驱动目录（Orca-like，精简版）

**Builds on:** `docs/superpowers/specs/2026-09-23-agents-right-rail-design.md`（右栏 Agents：观察式进程存在列表；白名单 `codex` / `codebuddy`）。今日右栏仍是**只观察、不启动**；本稿把「支持哪些 agent」抽成可配置目录，并补 Settings + 新建终端一键启动。

## Goal

在 octopus 中配置应用支持的 agent CLI，做到：

1. 内置目录检测是否已安装  
2. 启用 / 禁用  
3. 设置全局默认 agent（含空白终端）  
4. 覆盖 command / args / env，并可 Reset  
5. 新建终端 / 新标签时用下拉选择并启动  
6. 右栏 Agents 列表只认**已启用**的目录 id  

第一期只覆盖现有右栏一致的两种：`codex`、`codebuddy`。

## Approach choice

| 方案 | 说明 | 结论 |
|------|------|------|
| **A. 配置驱动目录（采用）** | Rust 内置目录；用户覆盖进全局设置；Settings / 下拉启动 / 右栏共用同一套 id | 与 Orca 同构、可扩展；第一期目录仅两项 |
| B. 只做 Settings，启动下期再接 | 配置与检测先落、新建终端行为不变 | 过小，已要求一键启动 |
| C. 前端写死两套启动模板 | 几乎不抽公共模型 | 难扩展，Settings 与右栏易分叉 |

## Relation to existing Agents right-rail

| 现状（2026-09-23） | 本稿变更 |
|--------------------|----------|
| Daemon 硬编码白名单 `codex` / `codebuddy`，仅观察进程是否在跑 | 白名单改为「内置目录 ∩ 已启用」；检测名仍来自目录的 process match |
| 无启动器、无 Settings → Agents | 新增设置页 + 新建终端下拉启动 |
| `AgentId = "codex" \| "codebuddy"` | id 集合仍先固定这两项；启用与否由设置决定 |

右栏交互（live-only、点击聚焦、~300ms 轮询）不变；只换「认谁」的数据来源。

## Data model

### Built-in catalog（代码写死，Rust）

每项字段：

| 字段 | 作用 |
|------|------|
| `id` | `"codex"` \| `"codebuddy"` |
| `label` | 显示名（如 Codex、CodeBuddy） |
| `detectCmd` | PATH 检测用的二进制名 |
| `launchCmd` | 默认启动命令（可与 detect 同名） |
| `processMatch` | 右栏 / daemon 匹配用的进程 basename |
| `defaultArgs` | 默认 CLI 参数（可空） |
| `defaultEnv` | 默认环境变量（可空） |

第一期目录**仅**上述两项；不加第三种 agent 类型。

### User overrides（全局设置持久化）

| 字段 | 类型 / 取值 | 说明 |
|------|-------------|------|
| `defaultAgent` | `"codex"` \| `"codebuddy"` \| `"blank"` | 新建终端下拉预选项；未设置时见迁移默认 |
| `disabledAgents` | `string[]`（catalog id） | 在此列表中 = 禁用 |
| `agentOverrides` | `Record<id, { cmd?, args?, env? }>` | 按 id 覆盖；缺省字段回落目录默认 |

### 解析规则

- **启用** = id 不在 `disabledAgents`  
- **启动命令** = override `cmd`，否则 catalog `launchCmd`  
- **args / env** = override 有则用，否则 catalog 默认（可空）  
- **空白终端（blank）** 不是目录里的 agent：只作为启动选项 / 可选默认；无 detect、无右栏匹配  
- **右栏** 只识别**已启用**的 catalog id（禁用后进程即使在跑也不出现在 Agents 列表）

## Settings UI

新设置页：**Settings → Agents**。

### 布局

1. **顶部：默认 agent**  
   三选一：`codex` / `codebuddy` / 空白终端。  
   禁用中的 agent 不应仍可作为默认（若用户禁用当前默认：回落到第一个仍启用的 catalog id，或 `blank`——实现时在 plan 里定一种并 toast 提示）。

2. **内置 agent 行**（每行一项）  
   - 名称 / 图标  
   - 已安装与否（PATH 检测结果）  
   - **Refresh** 重新检测  
   - **启用开关**  
   - **设为默认**（快捷；与顶部 picker 同步）  
   - 展开编辑：**command**、**args**、**env**，以及 **Reset**（清该 id 的覆盖，恢复目录默认）

3. **未安装**  
   仍列出，标「未检测到」；用户可改 command 为绝对路径后再 Refresh。  
   第一期**不做**「Available to install」商店 / 外链引导（可在文案上提一句「请自行安装 CLI」即可）。

### UI 非目标（本阶段）

- 安装引导链接 / 商店  
- 全局 Yolo / Manual 权限开关  
- Agent status hooks  
- 按项目覆盖默认 agent  
- 用户新增完全自定义 agent 类型进入目录  

## New terminal launch

### 入口

新建终端 / 新标签时出现下拉：

- **空白终端**  
- 所有**已启用**的 catalog agent（含未检测到安装的）

预选项 = Settings 中的 `defaultAgent`（若默认指向已禁用 id，按上方回落规则）。

### 行为

| 选择 | 行为 |
|------|------|
| 空白终端 | 只开 shell，与今日新建终端一致 |
| 某 agent | 在对应 worktree / cwd 开 PTY，执行解析后的 `command + args`，并传入解析后的 `env` |
| 未安装仍选中 | 允许选；启动失败 → toast 提示（不静默失败） |

### 明确不做（启动侧）

- **第一期不做 prompt 注入**（无任务文本入口；不把说明塞进 argv / stdin）  
- 不在创建 worktree 时强制启动 agent  
- 不因拖看板列等其它 UI 自动启停 agent  

### 与右栏联动

- 启动成功后，若进程 basename 命中该 agent 的 `processMatch`，右栏按现有 presence 流程出现行  
- 禁用的 id：下拉不出现；daemon / 右栏匹配集合也不包含该 id  

## Persistence / migration

1. 用「已启用的 catalog id」替换 `agent_detect`（及同类）里的硬编码白名单。  
2. 默认迁移：  
   - `codex`、`codebuddy` **均启用**（`disabledAgents` 初始为空）  
   - `defaultAgent` 若未设置：回落为 `"codex"`；若 `codex` 被禁用，则第一个仍启用的 catalog id；若无一启用，则 `"blank"`  
3. 已有用户无相关字段时按上述默认写入 / 运行时解析即可，无需破坏性迁移。  

存储落在现有**全局设置**通道（与其它 Settings 一致）；具体 schema 字段名在 implementation plan 中与 `GlobalSettings`（或等价结构）对齐。

## Non-goals（整期 MVP）

- 用户自定义新 agent 类型（任意 id / 图标 / 检测命令入目录）  
- 按项目覆盖默认 agent  
- Prompt 注入（argv / flag / stdin）  
- Yolo / Manual 全局权限、status hooks、usage、账号热切换  
- 安装 marketplace / 未安装外链商店  
- 创建 worktree 时强制启 agent  
- 一次扩到 Orca 级 35+ 目录项  

## Success criteria

| # | 标准 |
|---|------|
| 1 | Settings → Agents 可检测安装、启用/禁用、设默认、覆盖 command/args/env 并 Reset |
| 2 | 新建终端下拉可选空白或已启用 agent，并成功启动（或失败 toast） |
| 3 | 禁用某 agent 后：下拉不出现，右栏也不再认该进程 |
| 4 | 右栏 live 列表与点击聚焦行为相对 2026-09-23 稿不变，仅白名单来源改为配置 |

## Verification（建议）

### Automated

- 解析：override vs catalog 默认、启用判定、defaultAgent 回落  
- processMatch / 启用集合过滤（纯函数）

### Manual

1. 仅装其一 / 两者都装 / 都不装 → Settings 安装状态正确；Refresh 有效  
2. 改 command 为绝对路径 → 能启动；Reset 恢复默认  
3. 设默认为 blank / codex / codebuddy → 新建终端预选正确  
4. 禁用 codebuddy → 下拉与右栏均不再出现；再启用恢复  
5. 未安装仍选 agent → toast，不崩  

## Implementation sketch (not a plan)

- Rust：内置 catalog 常量；检测；launch 字符串拼装；presence 白名单读「启用 id」  
- 全局设置：读写 `defaultAgent` / `disabledAgents` / `agentOverrides`  
- FE：Settings → Agents 页；新建终端下拉；toast  
- 详细任务拆解见后续 `docs/superpowers/plans/`（writing-plans 阶段）
