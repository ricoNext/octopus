import { BotIcon, ChevronDownIcon, ChevronRightIcon, RefreshCwIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isAgentEnabled } from "@/lib/agents/settings-resolve";
import type {
  AgentOverride,
  AgentsStateDto,
  AgentUserSettings,
  CatalogEntryDto,
} from "@/lib/agents/types";
import { cn } from "@/lib/utils";

export function defaultAgentLabel(id: string): string {
  if (id === "blank") return "空白终端";
  if (id === "codex") return "Codex";
  if (id === "codebuddy") return "CodeBuddy";
  return id;
}

function parseArgsText(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return trimmed.split(/\s+/);
}

function formatArgs(args: string[]): string {
  return args.join(" ");
}

function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return out;
}

function formatEnv(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function effectiveOverride(
  entry: CatalogEntryDto,
  override: AgentOverride | undefined,
): { cmd: string; args: string[]; env: Record<string, string> } {
  return {
    cmd: override?.cmd && override.cmd.length > 0 ? override.cmd : entry.launchCmd,
    args: override?.args ?? entry.defaultArgs,
    env: override?.env ?? entry.defaultEnv,
  };
}

type AgentsSettingsSectionProps = {
  state: AgentsStateDto | null;
  busy?: boolean;
  /** Persist settings; return the saved AgentsStateDto so Reset can refresh drafts from server. */
  onChange: (
    settings: AgentUserSettings,
  ) => void | Promise<void | AgentsStateDto | undefined>;
  onRefresh: () => void | Promise<void>;
};

export function AgentsSettingsSection({
  state,
  busy = false,
  onChange,
  onRefresh,
}: AgentsSettingsSectionProps) {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [draftById, setDraftById] = useState<
    Record<string, { cmd: string; argsText: string; envText: string }>
  >({});

  const settings = state?.settings;
  const catalog = state?.catalog ?? [];
  const installed = state?.installed ?? {};
  const resolvedDefault = state?.resolvedDefault ?? "codex";

  const enabledCatalog = useMemo(() => {
    if (!settings) return [];
    return catalog.filter((entry) => isAgentEnabled(settings, entry.id));
  }, [catalog, settings]);

  const toggleExpanded = (id: string, entry: CatalogEntryDto) => {
    const willExpand = !expandedIds.has(id);
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (willExpand) {
      const override = settings?.agentOverrides[id];
      const effective = effectiveOverride(entry, override);
      setDraftById((drafts) => ({
        ...drafts,
        [id]: {
          cmd: effective.cmd,
          argsText: formatArgs(effective.args),
          envText: formatEnv(effective.env),
        },
      }));
    }
  };

  if (!state || !settings) {
    return (
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold">Agents</h2>
          <p className="mt-1 text-sm text-muted-foreground">正在加载 Agent 配置…</p>
        </div>
      </section>
    );
  }

  const patchSettings = async (patch: Partial<AgentUserSettings>) => {
    return onChange({
      ...settings,
      ...patch,
      agentOverrides: patch.agentOverrides ?? settings.agentOverrides,
      disabledAgents: patch.disabledAgents ?? settings.disabledAgents,
    });
  };

  const applyDraftFromState = (id: string, next: AgentsStateDto, fallback: CatalogEntryDto) => {
    const entry = next.catalog.find((item) => item.id === id) ?? fallback;
    const effective = effectiveOverride(entry, next.settings.agentOverrides[id]);
    setDraftById((drafts) => ({
      ...drafts,
      [id]: {
        cmd: effective.cmd,
        argsText: formatArgs(effective.args),
        envText: formatEnv(effective.env),
      },
    }));
  };

  const setEnabled = (id: string, enabled: boolean) => {
    const disabled = new Set(settings.disabledAgents.map((item) => item.toLowerCase()));
    if (enabled) {
      disabled.delete(id.toLowerCase());
    } else {
      disabled.add(id.toLowerCase());
    }
    // Preserve original casing from catalog ids where possible.
    const disabledAgents = catalog
      .map((entry) => entry.id)
      .filter((catalogId) => disabled.has(catalogId.toLowerCase()));
    void patchSettings({ disabledAgents });
  };

  const setDefaultAgent = (value: string) => {
    void patchSettings({ defaultAgent: value });
  };

  const saveOverrideDraft = (id: string) => {
    const draft = draftById[id];
    if (!draft) return;
    const nextOverrides = { ...settings.agentOverrides };
    nextOverrides[id] = {
      cmd: draft.cmd.trim() || undefined,
      args: parseArgsText(draft.argsText),
      env: parseEnvText(draft.envText),
    };
    void patchSettings({ agentOverrides: nextOverrides });
  };

  const resetOverride = async (id: string, entry: CatalogEntryDto) => {
    const nextOverrides = { ...settings.agentOverrides };
    delete nextOverrides[id];
    const result = await patchSettings({ agentOverrides: nextOverrides });
    if (result && typeof result === "object" && "catalog" in result) {
      applyDraftFromState(id, result, entry);
      return;
    }
    // Fallback when parent does not return state: use local catalog defaults.
    setDraftById((drafts) => ({
      ...drafts,
      [id]: {
        cmd: entry.launchCmd,
        argsText: formatArgs(entry.defaultArgs),
        envText: formatEnv(entry.defaultEnv),
      },
    }));
  };

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Agents</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          管理内置 Agent CLI：检测安装、启用禁用、设置默认，并覆盖启动命令。
        </p>
      </div>

      <div className="rounded-lg border bg-card px-4 py-4">
        <Label htmlFor="default-agent">默认 Agent</Label>
        <div className="mt-2 max-w-sm">
          <Select
            value={resolvedDefault}
            onValueChange={(value) => setDefaultAgent(value)}
            disabled={busy}
          >
            <SelectTrigger id="default-agent" className="w-full" aria-label="默认 Agent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="blank">空白终端</SelectItem>
              {enabledCatalog.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          新建终端时预选此项。禁用当前默认时会自动回落到其它已启用 Agent 或空白终端。
        </p>
      </div>

      <div className="divide-y rounded-lg border bg-card">
        {catalog.map((entry) => {
          const enabled = isAgentEnabled(settings, entry.id);
          const isInstalled = Boolean(installed[entry.id]);
          const isDefault = resolvedDefault === entry.id;
          const expanded = expandedIds.has(entry.id);
          const draft =
            draftById[entry.id] ??
            (() => {
              const effective = effectiveOverride(entry, settings.agentOverrides[entry.id]);
              return {
                cmd: effective.cmd,
                argsText: formatArgs(effective.args),
                envText: formatEnv(effective.env),
              };
            })();

          return (
            <div key={entry.id} className="px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <BotIcon className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{entry.label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {isInstalled ? (
                        <span className="text-emerald-600 dark:text-emerald-400">已安装</span>
                      ) : (
                        <span>未检测到</span>
                      )}
                      <span className="text-muted-foreground/80"> · {entry.detectCmd}</span>
                    </p>
                    {!isInstalled ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        请自行安装对应 CLI，或把命令改成绝对路径后再刷新。
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void onRefresh()}
                    aria-label={`刷新 ${entry.label} 安装状态`}
                  >
                    <RefreshCwIcon className={cn(busy && "animate-spin")} />
                    刷新
                  </Button>
                  <label className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
                    <Checkbox
                      checked={enabled}
                      disabled={busy}
                      onCheckedChange={(value) => setEnabled(entry.id, value === true)}
                      aria-label={`启用 ${entry.label}`}
                    />
                    <span>启用</span>
                  </label>
                  <Button
                    type="button"
                    variant={isDefault ? "secondary" : "outline"}
                    size="sm"
                    disabled={busy || !enabled || isDefault}
                    onClick={() => setDefaultAgent(entry.id)}
                  >
                    {isDefault ? "当前默认" : "设为默认"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => toggleExpanded(entry.id, entry)}
                    aria-expanded={expanded}
                  >
                    {expanded ? (
                      <ChevronDownIcon className="size-4" />
                    ) : (
                      <ChevronRightIcon className="size-4" />
                    )}
                    启动配置
                  </Button>
                </div>
              </div>

              {expanded ? (
                <div className="mt-4 space-y-3 rounded-md border bg-muted/20 p-3">
                  <div className="space-y-1.5">
                    <Label htmlFor={`agent-cmd-${entry.id}`}>命令</Label>
                    <Input
                      id={`agent-cmd-${entry.id}`}
                      value={draft.cmd}
                      disabled={busy}
                      onChange={(event) =>
                        setDraftById((prev) => ({
                          ...prev,
                          [entry.id]: { ...draft, cmd: event.target.value },
                        }))
                      }
                      onBlur={() => saveOverrideDraft(entry.id)}
                      placeholder={entry.launchCmd}
                      spellCheck={false}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`agent-args-${entry.id}`}>参数</Label>
                    <Input
                      id={`agent-args-${entry.id}`}
                      value={draft.argsText}
                      disabled={busy}
                      onChange={(event) =>
                        setDraftById((prev) => ({
                          ...prev,
                          [entry.id]: { ...draft, argsText: event.target.value },
                        }))
                      }
                      onBlur={() => saveOverrideDraft(entry.id)}
                      placeholder="空格分隔，例如 --flag value"
                      spellCheck={false}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`agent-env-${entry.id}`}>环境变量</Label>
                    <textarea
                      id={`agent-env-${entry.id}`}
                      value={draft.envText}
                      disabled={busy}
                      onChange={(event) =>
                        setDraftById((prev) => ({
                          ...prev,
                          [entry.id]: { ...draft, envText: event.target.value },
                        }))
                      }
                      onBlur={() => saveOverrideDraft(entry.id)}
                      placeholder={"KEY=VAL\n每行一个"}
                      spellCheck={false}
                      rows={3}
                      className={cn(
                        "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors outline-none",
                        "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                        "disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
                      )}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      onClick={() => saveOverrideDraft(entry.id)}
                    >
                      保存覆盖
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void resetOverride(entry.id, entry)}
                    >
                      重置
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
