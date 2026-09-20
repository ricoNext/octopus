# 终端会话持久化与恢复设计

状态：阶段一实现中；阶段二、阶段三尚未实现。

本文记录 Orca 风格终端会话持久化机制在 Octopus 中的落地方案。它是实现设计，不代表当前版本已经支持会话恢复。当前 MVP 规格仍以 [产品规格](product-spec.md) 为准；其中“应用退出时杀掉全部 PTY、下次不恢复终端历史”的约定，需要在本设计确认后再修改。

## 1. 目标

实现应用重启后仍能继续使用原终端会话，优先保证真实 shell/命令进程不被应用生命周期影响：

- 应用退出时只断开前端客户端，不主动结束 PTY、shell 或用户在终端中启动的程序。
- 应用再次启动时，连接已有的终端 daemon，并重新 attach 原会话。
- daemon 仍存活时，恢复真实进程和终端屏幕（warm reattach）。
- daemon 也丢失时，尽可能恢复终端历史、工作目录和尺寸（cold restore）。
- cold restore 不能伪造已经死亡的进程；Codex、Claude 等 agent 的对话续接由各自 CLI 的 resume 能力负责。

## 2. 当前实现与问题

当前项目是 Tauri + Rust + React + xterm.js + `portable-pty`：

```text
Tauri 主进程
  └── PtyManager
        └── portable-pty
              └── shell / 用户启动的程序
```

这会产生两个限制：

1. PTY 由 Tauri 进程直接持有，应用退出时进程生命周期无法独立。
2. `TerminalPane` 保存到 `localStorage` 的输出只属于渲染器缓冲，不能恢复真实 shell 或正在运行的程序。

因此，单纯扩大 `localStorage`、保存 xterm 内容或在启动时重放文本，都不能实现真正的会话持久化。

## 3. 目标架构

将 PTY 所有权从 Tauri 主进程中移出，放入独立的 `terminal-daemon`：

```text
Tauri 主进程
  └── Unix domain socket 客户端
        └── terminal-daemon（独立进程）
              └── portable-pty
                    └── shell / codex / claude / 其他程序
```

平台策略：

- 第一阶段只实现 macOS，使用 Unix domain socket。
- 后续如扩展 Windows，协议保持不变，将传输层替换为 named pipe。
- daemon 使用独立稳定路径和进程启动方式，不能依赖 Tauri 主进程退出时的子进程清理。
- daemon 需要一个随机 token 或权限受限的 token 文件，防止本机其他进程随意控制终端。

Tauri 主进程只负责：

- 确保 daemon 已启动并连接。
- 向 daemon 转发创建、attach、输入、resize、detach 等操作。
- 将 daemon 的输出事件传给对应的 xterm 实例。
- 持久化工作区与终端 session 的关联关系。

daemon 负责：

- 持有 PTY、shell 和子进程。
- 管理 session 生命周期和客户端连接。
- 维护滚动输出、当前屏幕快照和终端状态。
- 定期写 checkpoint，并在异常退出后提供 cold restore 数据。

## 4. 进程生命周期

### 4.1 启动 daemon

Tauri 启动时执行 `ensure_daemon_running`：

1. 读取当前用户专属的 socket 和 token 路径。
2. 尝试连接已有 daemon。
3. 连接成功且身份校验通过：复用该 daemon。
4. 连接失败：启动 detached `terminal-daemon`，等待健康检查成功后再继续加载终端。
5. daemon 启动失败时，允许退回当前进程内 PTY（仅作为明确的降级模式），并在日志中记录原因。

### 4.2 daemon 是否退出

daemon 不能因为 Tauri 客户端断开就退出。建议使用以下 idle 条件：

- 仍有任何活跃 PTY session 时，不退出。
- 没有 session 且没有客户端连接时，经过短暂宽限期后退出。
- 收到显式 shutdown 请求时，只有在 session 数为零时才允许退出；否则拒绝或延迟处理。

应用退出流程只做 `detach`/断开 socket，不调用 `kill_all`。用户删除工作树或明确关闭某个终端时，才调用 `kill_session`。

### 4.3 应用启动恢复

1. Tauri 连接 daemon。
2. 读取后端保存的 session 元数据和前端的 tab/worktree 状态。
3. 对每个需要展示的 session 调用 `attach_session`。
4. daemon 返回 warm snapshot、cold restore 或全新会话结果。
5. xterm 先恢复快照，再订阅实时输出。

## 5. Session 数据模型

session ID 必须稳定，不能用前端 tab 的数组下标或 React key。

```rust
struct TerminalSession {
    id: String,
    context_id: String,       // 当前为 worktree id
    cwd: String,
    cols: u16,
    rows: u16,
    status: SessionStatus,
    created_at: String,
    last_attached_at: String,
    last_checkpoint_at: Option<String>,
    agent: Option<AgentSession>,
}

enum SessionStatus {
    Running,
    Detached,
    Exited,
    Failed,
}

struct AgentSession {
    provider: String,
    provider_session_id: String,
    transcript_path: Option<String>,
    launch_argv: Vec<String>,
}
```

`context_id` 先关联 Worktree；未来支持多个终端时，可以改为独立的 workspace/pane ID。后端 session 元数据是事实来源，前端 `localStorage` 只保存 tab 顺序、选中项等 UI 状态。

## 6. daemon 协议

第一版采用 request/response 加 session 输出事件的简单协议。消息建议使用带版本号的 JSON 行协议，二进制 PTY 数据使用 base64 或后续改为专用 channel，避免 JSON 数字数组的体积放大。

最小命令集合：

```text
hello
list_sessions
create_session
attach_session
detach_session
write
resize
kill_session
capture_snapshot
```

`attach_session` 返回结构化结果，而不是单个布尔值：

```ts
type AttachResult = {
  sessionId: string;
  isNew: boolean;
  recovery: "warm" | "cold" | "fresh";
  snapshot?: {
    scrollbackAnsi: string;
    screenAnsi: string;
    cols: number;
    rows: number;
    cwd: string;
    title?: string;
    altScreen?: string;
  };
  coldRestore?: {
    cwd: string;
    cols: number;
    rows: number;
    scrollbackAnsi: string;
  };
};
```

协议需要明确：请求幂等性、未知 session 的错误码、客户端断线后的输出保留策略、session ID 冲突处理，以及 daemon 重启期间的重连退避。

## 7. Warm reattach

这是主路径：

```text
daemon 中 session 仍存在
  -> attach_session
  -> 返回 scrollback + 当前屏幕快照
  -> xterm 回放快照
  -> 订阅实时输出
  -> 原 shell/agent 继续运行
```

快照至少应覆盖：

- scrollback 缓冲区和当前屏幕。
- 列数、行数、当前工作目录。
- 当前窗口标题。
- alternate screen 状态。
- 必要的终端模式和未完成的 escape sequence。

快照回放只能发生在订阅实时输出之前或由 daemon 提供序列号保证，否则可能出现输出丢失或重复。建议每个 session 的输出带单调递增序列号，attach 时返回快照对应的序列号，客户端从该序列号继续接收。

## 8. Cold restore

当 daemon 崩溃、被系统杀死或升级后无法复用时，使用磁盘 checkpoint：

```text
<app-data>/terminal-history/<session-id>/
  meta.json
  output.log
  snapshot.json
```

至少持久化：

- `cwd`、`cols`、`rows`。
- 创建时间、最后 checkpoint 时间。
- 最近滚动输出和屏幕快照。
- `ended_at` 或异常退出标记。
- 标题及恢复所需的终端状态。

恢复分支：

```text
session 仍在 daemon
  -> warm reattach

session 不在 daemon，且 checkpoint 表明异常退出
  -> 创建新 shell
  -> 注入 cwd 和尺寸
  -> 回放历史
  -> 可选：启动 agent resume

没有可用历史
  -> 全新会话
```

冷恢复只能恢复终端内容和环境信息，不能恢复已经死亡的 shell、编译任务或 agent 进程。checkpoint 写入需要限频、限大小，并采用临时文件加 rename，避免应用或 daemon 崩溃时留下半写文件。

## 9. Agent resume

PTY 恢复和 agent 对话恢复是两个独立问题：

```text
PTY 仍存活
  -> 原 agent 进程自然继续

PTY 已死，但 agent session ID 可用
  -> 执行 codex resume <id>
  -> 或 claude --resume <id>

两者都不存在
  -> 普通新终端
```

实现要求：

1. 从 agent hook、启动输出或明确的识别接口捕获 provider session ID 和 transcript path。
2. 在后端保存 provider、session ID、启动参数和来源（退出、后台运行、工作树休眠）。
3. cold restore 时根据 provider 生成 resume argv。
4. 保存一次性消费标记或启动锁，避免 React 重挂载导致重复 resume。
5. agent resume 失败时保留恢复后的 shell，并向用户展示可手动执行的命令。

MVP 当前不包含 agent 预设或 agent 管理功能，因此这一层应在 warm persistence 和 cold restore 稳定后再实现。

## 10. 文件布局与归属

建议将职责拆开：

```text
src-tauri/src/
  daemon_client.rs       # Tauri 到 daemon 的连接、认证、请求转发
  daemon_protocol.rs     # 协议消息和错误类型
  daemon_launcher.rs     # ensure_running、detached 启动、健康检查
  terminal_session.rs    # session 元数据和恢复状态
  daemon/                # 独立 terminal-daemon 二进制的服务端实现
    main.rs
    server.rs
    session.rs
    checkpoint.rs
```

若 Cargo workspace 过重，第一阶段也可以先在同一 crate 中通过 feature 或独立 bin 实现；但 daemon 的进程入口和 Tauri 命令边界必须保持独立，避免回到进程内 PTY 架构。

建议持久化：

- 工作区、项目、worktree 的登记继续使用现有本地 JSON store。
- 终端 session 元数据可先并入同一 store，但输出历史必须放在独立目录，不能塞进主状态 JSON。
- 前端 `localStorage` 只保留 UI 恢复状态，不保存大段终端输出。

## 11. 分阶段实施

### 阶段一：Warm persistence

- 新增独立 `terminal-daemon`。
- macOS 使用 Unix socket 和 token 认证。
- daemon 持有 `portable-pty`。
- Tauri `pty_*` 命令改为 daemon 客户端代理。
- 实现 `create / attach / write / resize / detach / kill`。
- 应用退出时移除 `kill_all`，只断开连接。
- 应用启动时复用已有 daemon，找不到再启动新的。
- 使用稳定 session ID，并完成 warm attach 测试。

### 阶段二：快照与 Cold restore

- daemon 维护滚动输出和当前屏幕快照。
- attach 返回快照和输出序列号。
- 周期性写 checkpoint，限制磁盘空间。
- daemon 异常退出后恢复 scrollback、cwd 和尺寸。
- 增加异常退出、坏 checkpoint 和版本不兼容处理。

### 阶段三：Agent resume

- 捕获 Codex/Claude 等 provider session ID。
- 持久化 sleeping agent session。
- cold restore 后自动执行对应 resume 命令。
- 增加防重复 resume、失败提示和手动恢复入口。

## 12. 需要修改的现有模块

- `src-tauri/src/pty.rs`：从进程内 PTY 管理器拆分 daemon 服务端和客户端。
- `src-tauri/src/commands.rs`：`pty_*` 命令改为向 daemon 转发，并返回结构化 attach 结果。
- `src-tauri/src/lib.rs`：启动/连接 daemon；移除正常退出时的 `kill_all()`。
- `src/lib/api.ts`：更新 PTY API 类型和恢复结果。
- `src/components/TerminalPane.tsx`：支持 snapshot 回放、detach、cold restore 和恢复状态展示。
- `src/App.tsx`：继续保存 tab/UI 状态，但从后端读取 session 列表和状态。
- `src-tauri/src/models.rs`、`store.rs`：增加 session 元数据及版本迁移。
- `docs/product-spec.md`：设计确认后，更新“退出时杀 PTY、下次不恢复历史”的旧约定。

## 13. 验收标准

阶段一至少通过以下场景：

1. 启动一个长时间运行的 shell 命令，退出应用，再启动应用，原进程仍在运行。
2. 在终端中启动交互式 TUI，退出并重启应用，画面和输入状态可恢复。
3. 同时打开多个 worktree，重启后每个 session 都能按稳定 ID attach 到正确的 worktree。
4. 应用异常退出时，daemon 和 PTY 不因 Tauri 退出而被主动杀死。
5. 用户明确关闭某个终端或删除 worktree 时，PTY 才会被结束。

阶段二还需验证：

1. 手动终止 daemon 后，重启应用能恢复最近 checkpoint 的历史和 cwd。
2. 冷恢复不会声称原进程仍然存活。
3. checkpoint 损坏、版本不匹配和磁盘写入失败都有可理解的降级行为。

## 14. 未决决策

在开始写代码前需要确认：

- 第一阶段是否只支持 macOS Unix socket，还是现在就抽象 Windows named pipe。
- session 元数据并入现有 store，还是单独使用 `terminal-sessions.json`。
- daemon 是独立 Cargo binary，还是 Tauri 包内的 detached helper。
- 是否允许 daemon 在没有活跃 session 时自动退出。
- checkpoint 的最大磁盘配额和单 session 输出上限。
- agent resume 是否属于 MVP，还是明确延期。
