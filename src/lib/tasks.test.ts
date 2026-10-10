import { describe, expect, it } from "vitest";
import { mergeTasks, type Task } from "./tasks";

describe("任务刷新", () => {
  it("旧的轮询结果不能覆盖刚提交的操作，也不能移除刚创建的任务", () => {
    const latest = {
      id: "a",
      phase: "running",
      updatedAt: 20,
      createdAt: 1,
    } as Task;
    const stale = { ...latest, phase: "pending", updatedAt: 10 } as Task;
    const added = {
      id: "b",
      phase: "pending",
      updatedAt: 30,
      createdAt: 30,
    } as Task;
    expect(mergeTasks([latest, added], [stale])).toEqual([added, latest]);
  });
});
