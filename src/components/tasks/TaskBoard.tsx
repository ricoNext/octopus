import { useEffect, useState, type FormEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { DiffEditor } from "@monaco-editor/react";
import {
  ArrowLeftIcon,
  CheckIcon,
  FolderPlusIcon,
  ListTodoIcon,
  PlayIcon,
  PlusIcon,
  Settings2Icon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { invokeError } from "@/lib/api";
import type { AgentsStateDto } from "@/lib/agents/types";
import { isAgentEnabled } from "@/lib/agents/settings-resolve";
import {
  DEFAULT_TASK_LABELS,
  mergeTasks,
  TASK_PHASES,
  TASK_REASONS,
  taskApi,
  type Task,
  type TaskInput,
  type TaskChange,
} from "@/lib/tasks";
import { languageFromRelPath } from "@/lib/files/language-from-path";
import "@/lib/files/monaco-setup";
import "./tasks.css";

const phaseColors = ["#9097a5", "#5b82f6", "#d99a25", "#9873d9", "#47a681"];
const time = (at: number) =>
  new Date(at).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const basename = (path: string) =>
  path.split("/").filter(Boolean).pop() ?? path;

export function TaskBoard({
  agents,
  theme,
  onSettings,
}: {
  agents: AgentsStateDto | null;
  theme: "light" | "dark";
  onSettings: () => void;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [labels, setLabels] = useState(DEFAULT_TASK_LABELS);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Task | "new" | null>(null);
  const [labelDraft, setLabelDraft] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const upsert = (task: Task) =>
    setTasks((current) => mergeTasks(current, [task]));

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await taskApi.list();
        if (!disposed) {
          setTasks((current) => mergeTasks(current, next));
          setLoadError(null);
        }
      } catch (e) {
        if (!disposed) setLoadError(invokeError(e));
      } finally {
        if (!disposed) {
          setLoading(false);
          timer = setTimeout(poll, 1200);
        }
      }
    };
    void poll();
    void taskApi
      .labels()
      .then((value) => {
        if (!disposed) setLabels(value);
      })
      .catch((e) => toast.error(invokeError(e)));
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, []);

  async function act(action: () => Promise<Task>) {
    setBusy(true);
    try {
      upsert(await action());
      return true;
    } catch (e) {
      toast.error(invokeError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const task = tasks.find((task) => task.id === selected);
  const directories = [
    ...new Set(tasks.flatMap((task) => task.directories)),
  ].sort();
  const visible = tasks.filter(
    (task) =>
      (!filter || task.directories.includes(filter)) &&
      (!query ||
        `${task.title} ${task.description}`
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  const running = tasks.filter((task) => task.phase === "running").length;
  const attention = tasks.filter((task) => task.phase === "attention").length;

  return (
    <section className="task-page" aria-label="任务看板">
      <header className="task-titlebar" data-tauri-drag-region>
        <span className="task-eyebrow">
          <ListTodoIcon size={15} /> 任务中心
        </span>
        <span className="task-titlebar-note">个人开发工作流</span>
      </header>
      {task ? (
        <TaskDetail
          task={task}
          label={labels[TASK_PHASES.indexOf(task.phase)]}
          theme={theme}
          busy={busy}
          act={act}
          onBack={() => setSelected(null)}
          onEdit={() => setEditing(task)}
        />
      ) : (
        <>
          <div className="task-board-heading">
            <div>
              <h1>全局任务</h1>
              <p>从明确目标，到确认完成。</p>
            </div>
            <div className="task-toolbar-actions">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLabelDraft([...labels])}
              >
                <Settings2Icon /> 阶段名称
              </Button>
              <Button size="sm" onClick={() => setEditing("new")}>
                <PlusIcon /> 新建任务
              </Button>
            </div>
          </div>
          <div className="task-board-filters">
            <div className="task-stats">
              <span>
                <strong>{tasks.length}</strong> 全部任务
              </span>
              <span>
                <i style={{ background: phaseColors[1] }} />
                <strong>{running}</strong> 执行中
              </span>
              <span>
                <i style={{ background: phaseColors[2] }} />
                <strong>{attention}</strong> 需要处理
              </span>
            </div>
            <div className="task-filter-inputs">
              <input
                className="task-input"
                aria-label="搜索任务"
                placeholder="搜索任务…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <select
                className="task-input"
                aria-label="按关联目录筛选"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="">所有关联目录</option>
                {directories.map((dir) => (
                  <option key={dir} value={dir}>
                    {dir}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {loadError && (
            <p className="task-error" role="alert">
              任务读取失败：{loadError}
            </p>
          )}
          {loading ? (
            <div className="task-loading" role="status">
              正在读取任务…
            </div>
          ) : (
            <div className="task-columns">
              {TASK_PHASES.map((phase, index) => {
                const items = visible.filter((task) => task.phase === phase);
                return (
                  <section
                    key={phase}
                    className="task-column"
                    aria-label={labels[index]}
                  >
                    <div className="task-column-heading">
                      <span
                        className="task-phase-dot"
                        style={{ background: phaseColors[index] }}
                      />
                      <h2>{labels[index]}</h2>
                      <span className="task-count">{items.length}</span>
                    </div>
                    <div className="task-column-cards">
                      {items.map((task) => (
                        <button
                          className="task-card"
                          key={task.id}
                          onClick={() => setSelected(task.id)}
                        >
                          <div className="task-card-meta">
                            <span>
                              {agents?.catalog.find(
                                (a) => a.id === task.agentId,
                              )?.label ?? task.agentId}
                            </span>
                            {task.executions.length > 0 && (
                              <span>第 {task.executions.length} 次执行</span>
                            )}
                          </div>
                          <h3>{task.title}</h3>
                          <p className="task-card-description">
                            {task.description}
                          </p>
                          {task.reason && (
                            <span
                              className={`task-reason task-reason-${task.reason}`}
                            >
                              {TASK_REASONS[task.reason] ?? task.reason}
                            </span>
                          )}
                          {task.stopRequested && task.phase === "running" && (
                            <span className="task-reason">正在停止…</span>
                          )}
                          <div
                            className="task-card-directory"
                            title={task.directories.join("\n")}
                          >
                            <span>⌁</span> {basename(task.primaryDirectory)}
                            {task.directories.length > 1 && (
                              <span>+{task.directories.length - 1}</span>
                            )}
                          </div>
                          <div className="task-card-footer">
                            <span>{time(task.updatedAt)}</span>
                            {task.phase === "review" && (
                              <span>{task.changes.length} 个文件</span>
                            )}
                          </div>
                        </button>
                      ))}
                      {items.length === 0 && (
                        <div className="task-column-empty">
                          {phase === "pending" && !query && !filter ? (
                            <button onClick={() => setEditing("new")}>
                              <PlusIcon size={15} /> 创建第一个任务
                            </button>
                          ) : (
                            "暂无任务"
                          )}
                        </div>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
      {editing && (
        <TaskForm
          existing={editing === "new" ? null : editing}
          agents={agents}
          onClose={() => setEditing(null)}
          onSettings={onSettings}
          onSaved={(value) => {
            upsert(value);
            setEditing(null);
            setSelected(value.id);
          }}
        />
      )}
      <Dialog
        open={labelDraft !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setLabelDraft(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>阶段名称</DialogTitle>
            <DialogDescription>
              修改显示名称，阶段含义与顺序保持固定。
            </DialogDescription>
          </DialogHeader>
          <div className="task-form-fields">
            {labelDraft?.map((label, i) => (
              <label key={TASK_PHASES[i]}>
                {DEFAULT_TASK_LABELS[i]}
                <input
                  className="task-input"
                  value={label}
                  maxLength={20}
                  onChange={(e) =>
                    setLabelDraft(
                      (current) =>
                        current?.map((s, index) =>
                          i === index ? e.target.value : s,
                        ) ?? null,
                    )
                  }
                />
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setLabelDraft(null)}
            >
              取消
            </Button>
            <Button
              disabled={busy || labelDraft?.some((s) => !s.trim())}
              onClick={async () => {
                if (!labelDraft) return;
                setBusy(true);
                try {
                  setLabels(await taskApi.labels(labelDraft));
                  setLabelDraft(null);
                } catch (e) {
                  toast.error(invokeError(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              保存名称
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function TaskForm({
  existing,
  agents,
  onClose,
  onSaved,
  onSettings,
}: {
  existing: Task | null;
  agents: AgentsStateDto | null;
  onClose: () => void;
  onSaved: (task: Task) => void;
  onSettings: () => void;
}) {
  const enabled =
    agents?.catalog.filter((a) => isAgentEnabled(agents.settings, a.id)) ?? [];
  const defaultId = enabled.some((a) => a.id === agents?.resolvedDefault)
    ? agents!.resolvedDefault
    : (enabled[0]?.id ?? "");
  const [draft, setDraft] = useState<TaskInput>(
    existing ?? {
      title: "",
      description: "",
      acceptance: "",
      constraints: "无",
      agentId: defaultId,
      directories: [],
      primaryDirectory: "",
    },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = (key: keyof TaskInput, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  async function pick() {
    try {
      const paths = await open({
        directory: true,
        multiple: true,
        title: "选择任务可读写的本地目录",
      });
      if (!paths) return;
      const list = Array.isArray(paths) ? paths : [paths];
      setDraft((current) => ({
        ...current,
        directories: [...new Set([...current.directories, ...list])],
        primaryDirectory: current.primaryDirectory || list[0],
      }));
    } catch (e) {
      setError(invokeError(e));
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(await taskApi.save(draft, existing?.id ?? null));
    } catch (e) {
      setError(invokeError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="task-form-dialog">
        <DialogHeader>
          <DialogTitle>{existing ? "编辑任务" : "新建任务"}</DialogTitle>
          <DialogDescription>
            明确目标与验收标准，再交给 Agent 执行。创建后可在任务详情中启动。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="task-form">
          <div className="task-form-fields">
            <label>
              任务标题
              <input
                autoFocus
                required
                maxLength={200}
                className="task-input"
                placeholder="例如：为登录接口增加重试机制"
                value={draft.title}
                onChange={(e) => field("title", e.target.value)}
              />
            </label>
            <label>
              目标描述
              <textarea
                required
                className="task-input"
                rows={3}
                placeholder="希望解决什么问题，最终交付什么？"
                value={draft.description}
                onChange={(e) => field("description", e.target.value)}
              />
            </label>
            <div className="task-form-grid">
              <label>
                验收标准
                <textarea
                  required
                  className="task-input"
                  rows={3}
                  placeholder="什么结果才算完成？"
                  value={draft.acceptance}
                  onChange={(e) => field("acceptance", e.target.value)}
                />
              </label>
              <label>
                约束条件
                <textarea
                  required
                  className="task-input"
                  rows={3}
                  placeholder="兼容性、实现范围或其他限制"
                  value={draft.constraints}
                  onChange={(e) => field("constraints", e.target.value)}
                />
              </label>
            </div>
            <label>
              执行 Agent
              <select
                className="task-input"
                required
                disabled={!!existing}
                value={draft.agentId}
                onChange={(e) => field("agentId", e.target.value)}
              >
                <option value="" disabled>
                  选择已配置的 Agent
                </option>
                {enabled.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.label}
                    {!agents?.installed[agent.id] ? " · 未检测到安装" : ""}
                  </option>
                ))}
                {existing &&
                  !enabled.some((a) => a.id === existing.agentId) && (
                    <option value={existing.agentId}>
                      {existing.agentId} · 已禁用
                    </option>
                  )}
              </select>
            </label>
            <p className="task-hint">
              创建后固定使用此 Agent。
              <button type="button" className="task-link" onClick={onSettings}>
                管理 Agent 配置
              </button>
            </p>
            <div className="task-directory-heading">
              <span>关联目录 · 可读写</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void pick()}
              >
                <FolderPlusIcon /> 添加目录
              </Button>
            </div>
            {draft.directories.length === 0 && (
              <p className="task-directory-empty">
                选择一个或多个本地目录，无需登记为项目或工作树。
              </p>
            )}
            {draft.directories.map((path) => (
              <div className="task-directory-row" key={path}>
                <label title="设置为主工作目录">
                  <input
                    type="radio"
                    name="primaryDirectory"
                    checked={draft.primaryDirectory === path}
                    onChange={() => field("primaryDirectory", path)}
                  />
                  <span title={path}>{path}</span>
                  {draft.primaryDirectory === path && <small>主目录</small>}
                </label>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`移除目录 ${path}`}
                  onClick={() =>
                    setDraft((current) => {
                      const directories = current.directories.filter(
                        (p) => p !== path,
                      );
                      return {
                        ...current,
                        directories,
                        primaryDirectory:
                          current.primaryDirectory === path
                            ? (directories[0] ?? "")
                            : current.primaryDirectory,
                      };
                    })
                  }
                >
                  <XIcon />
                </Button>
              </div>
            ))}
            <p className="task-hint">
              Agent 从主目录启动，其他目录作为附加目录。首次运行后目录锁定。
            </p>
            {error && (
              <p className="task-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              取消
            </Button>
            <Button
              type="submit"
              disabled={busy || !draft.agentId || !draft.directories.length}
            >
              {busy ? "正在保存…" : existing ? "保存任务" : "创建任务"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TaskDetail({
  task,
  label,
  theme,
  busy,
  act,
  onBack,
  onEdit,
}: {
  task: Task;
  label: string;
  theme: "light" | "dark";
  busy: boolean;
  act: (action: () => Promise<Task>) => Promise<boolean>;
  onBack: () => void;
  onEdit: () => void;
}) {
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<"conversation" | "changes" | "info">(
    "conversation",
  );
  const [file, setFile] = useState<string | null>(null);
  const change =
    task.changes.find((change) => change.path === file) ?? task.changes[0];
  const canContinue = task.phase === "attention" && task.reason !== "waiting";
  const canCompose = ["running", "attention", "review"].includes(task.phase);
  const submitLabel =
    task.phase === "running"
      ? "补充要求"
      : task.phase === "review"
        ? "提交意见并继续"
        : "回复并继续";
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    const ok = await act(() =>
      task.phase === "running"
        ? taskApi.message(task.id, message)
        : taskApi.run(task.id, message),
    );
    if (ok) setMessage("");
  }
  return (
    <div className="task-detail">
      <div className="task-detail-heading">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeftIcon /> 全部任务
        </Button>
        <div className="task-detail-actions">
          {!task.startedAt && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onEdit}
            >
              编辑任务
            </Button>
          )}
          {task.phase === "pending" && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void act(() => taskApi.run(task.id))}
            >
              <PlayIcon /> 运行任务
            </Button>
          )}
          {task.phase === "running" && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || task.stopRequested}
              onClick={() => void act(() => taskApi.stop(task.id))}
            >
              <SquareIcon /> {task.stopRequested ? "正在停止…" : "停止执行"}
            </Button>
          )}
          {canContinue && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void act(() => taskApi.run(task.id))}
            >
              <PlayIcon /> {task.reason === "failed" ? "重试执行" : "继续执行"}
            </Button>
          )}
          {task.phase === "review" && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void act(() => taskApi.complete(task.id))}
            >
              <CheckIcon /> 确认完成
            </Button>
          )}
        </div>
      </div>
      <div className="task-detail-title">
        <div className="task-eyebrow">
          <span
            className="task-phase-dot"
            style={{ background: phaseColors[TASK_PHASES.indexOf(task.phase)] }}
          />
          {label}
          {task.reason && (
            <span className="task-reason">{TASK_REASONS[task.reason]}</span>
          )}
        </div>
        <h1>{task.title}</h1>
        <p>
          {task.agentId} · {task.directories.length} 个工作目录 · 创建于{" "}
          {time(task.createdAt)}
        </p>
      </div>
      {task.error && (
        <div className="task-error" role="alert">
          {task.error}
        </div>
      )}
      <nav className="task-detail-tabs" aria-label="任务详情视图">
        {(
          [
            ["conversation", "对话与结果"],
            ["changes", `文件变更 ${task.changes.length}`],
            ["info", "任务信息"],
          ] as const
        ).map(([value, title]) => (
          <button
            key={value}
            aria-current={tab === value ? "page" : undefined}
            onClick={() => setTab(value)}
          >
            {title}
          </button>
        ))}
      </nav>
      {tab === "conversation" && (
        <div className="task-conversation">
          <div className="task-messages" aria-label="任务对话记录">
            {task.phase === "pending" && (
              <div className="task-ready">
                <ListTodoIcon size={32} />
                <h2>准备就绪</h2>
                <p>点击“运行任务”，Agent 将根据目标和验收标准开始工作。</p>
              </div>
            )}
            {task.messages.map((message) => (
              <article
                key={message.id}
                className={`task-message task-message-${message.role}`}
              >
                <div>
                  <strong>
                    {message.role === "user"
                      ? "你"
                      : message.role === "system"
                        ? "任务动态"
                        : task.agentId}
                  </strong>
                  <time>{time(message.at)}</time>
                </div>
                <p>{message.text}</p>
              </article>
            ))}
            {task.summary && ["review", "done"].includes(task.phase) && (
              <div className="task-result">
                <h2>结果摘要</h2>
                <p>{task.summary}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTab("changes")}
                >
                  查看 {task.changes.length} 个文件变更
                </Button>
              </div>
            )}
            {task.phase === "running" && (
              <p className="task-hint" role="status">
                {task.stopRequested
                  ? "正在停止执行…"
                  : "Agent 正在执行，进展会自动更新。"}
              </p>
            )}
          </div>
          {canCompose && (
            <form className="task-composer" onSubmit={send}>
              <textarea
                className="task-input"
                aria-label="发送给 Agent 的消息"
                rows={3}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={
                  task.phase === "review"
                    ? "说明需要调整的地方，提交后立即继续执行…"
                    : task.reason === "waiting"
                      ? "回复 Agent 的问题…"
                      : "补充任务要求…"
                }
                disabled={busy || task.stopRequested}
              />
              <div>
                <span className="task-hint">
                  {task.phase === "running"
                    ? "本轮结束后自动接续处理补充要求"
                    : "沿用当前任务及 Agent 会话"}
                </span>
                <Button
                  type="submit"
                  size="sm"
                  disabled={busy || task.stopRequested || !message.trim()}
                >
                  {busy ? "处理中…" : submitLabel}
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
      {tab === "changes" && (
        <div className="task-changes">
          <div className="task-change-notices">
            {task.changeNotices.map((notice, i) => (
              <p key={i}>{notice}</p>
            ))}
            {task.phase === "running" && (
              <p>本轮执行结束后更新差异，当前显示上一轮记录。</p>
            )}
          </div>
          {task.changes.length === 0 ? (
            <div className="task-ready">
              <h2>暂无文件变更记录</h2>
              <p>执行结束后会比较关联目录与首次运行前的内容。</p>
            </div>
          ) : (
            <div className="task-diff-layout">
              <aside aria-label="变更文件">
                {task.changes.map((change) => (
                  <button
                    key={change.path}
                    className={
                      change.path === (file ?? task.changes[0]?.path)
                        ? "selected"
                        : ""
                    }
                    onClick={() => setFile(change.path)}
                    title={change.path}
                  >
                    <span>
                      {change.kind === "added"
                        ? "+"
                        : change.kind === "deleted"
                          ? "−"
                          : "M"}
                    </span>
                    {basename(change.path)}
                  </button>
                ))}
              </aside>
              {change && <ChangeView change={change} theme={theme} />}
            </div>
          )}
        </div>
      )}
      {tab === "info" && (
        <div className="task-info">
          {[
            ["目标描述", task.description],
            ["验收标准", task.acceptance],
            ["约束条件", task.constraints],
          ].map(([title, text]) => (
            <section key={title}>
              <h2>{title}</h2>
              <p>{text}</p>
            </section>
          ))}
          <section>
            <h2>工作目录 · 可读写{task.startedAt ? " · 已锁定" : ""}</h2>
            {task.directories.map((dir) => (
              <p key={dir}>
                {dir}
                {dir === task.primaryDirectory ? "（主目录）" : ""}
              </p>
            ))}
          </section>
          <section>
            <h2>执行历史</h2>
            {task.executions.length ? (
              task.executions.map((run, i) => (
                <p key={run.id}>
                  第 {i + 1} 次 · {time(run.startedAt)} ·{" "}
                  {run.endedAt
                    ? (TASK_REASONS[run.outcome ?? ""] ??
                      (run.outcome === "review" ? "已提交验收" : "已结束"))
                    : "执行中"}
                </p>
              ))
            ) : (
              <p>尚未执行</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function ChangeView({
  change,
  theme,
}: {
  change: TaskChange;
  theme: "light" | "dark";
}) {
  return (
    <div className="task-diff">
      <header title={change.path}>{change.path}</header>
      {change.note ? (
        <p className="task-hint">{change.note}</p>
      ) : (
        <DiffEditor
          original={change.before ?? ""}
          modified={change.after ?? ""}
          language={languageFromRelPath(change.path)}
          theme={theme === "dark" ? "vs-dark" : "vs"}
          options={{
            readOnly: true,
            originalEditable: false,
            renderSideBySide: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 12,
            automaticLayout: true,
          }}
        />
      )}
    </div>
  );
}
