import { invoke } from "@tauri-apps/api/core";

export const TASK_PHASES = [
  "pending",
  "running",
  "attention",
  "review",
  "done",
] as const;
export type TaskPhase = (typeof TASK_PHASES)[number];
export const DEFAULT_TASK_LABELS = [
  "待运行",
  "执行中",
  "待处理",
  "待验收",
  "已完成",
];
export const TASK_REASONS: Record<string, string> = {
  waiting: "等待回复",
  stopped: "已停止",
  failed: "执行失败",
};
export type TaskInput = {
  title: string;
  description: string;
  acceptance: string;
  constraints: string;
  agentId: string;
  directories: string[];
  primaryDirectory: string;
};
export type TaskMessage = {
  id: string;
  role: string;
  text: string;
  at: number;
  runId: string | null;
};
export type TaskChange = {
  path: string;
  kind: "added" | "deleted" | "modified";
  before: string | null;
  after: string | null;
  note: string | null;
};
export type Task = TaskInput & {
  id: string;
  phase: TaskPhase;
  reason: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  sessionId: string | null;
  runId: string | null;
  stopRequested: boolean;
  messages: TaskMessage[];
  executions: {
    id: string;
    startedAt: number;
    endedAt: number | null;
    outcome: string | null;
  }[];
  pendingMessages: string[];
  summary: string | null;
  changes: TaskChange[];
  changeNotices: string[];
};
export const taskApi = {
  list: () => invoke<Task[]>("tasks_list"),
  save: (input: TaskInput, id: string | null = null) =>
    invoke<Task>("tasks_save", { id, input }),
  run: (id: string, message: string | null = null) =>
    invoke<Task>("tasks_run", { id, message }),
  message: (id: string, message: string) =>
    invoke<Task>("tasks_message", { id, message }),
  stop: (id: string) => invoke<Task>("tasks_stop", { id }),
  complete: (id: string) => invoke<Task>("tasks_complete", { id }),
  labels: (labels: string[] | null = null) =>
    invoke<string[]>("tasks_labels", { labels }),
  exit: (stop: boolean) => invoke<void>("tasks_exit", { stop }),
};

export function mergeTasks(current: Task[], incoming: Task[]): Task[] {
  const byId = new Map(current.map((task) => [task.id, task]));
  for (const task of incoming) {
    const old = byId.get(task.id);
    if (!old || task.updatedAt >= old.updatedAt) byId.set(task.id, task);
  }
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
}
