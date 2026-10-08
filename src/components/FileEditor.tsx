import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { Button } from "@/components/ui/button";
import { languageFromRelPath } from "@/lib/files/language-from-path";
import "@/lib/files/monaco-setup";

export type FileEditorProps = {
  rootPath: string;
  relPath: string;
  value: string;
  theme: "light" | "dark";
  onChange: (next: string) => void;
  /** Always receives the current Monaco model value (not stale React state). */
  onSave: (text: string) => void | Promise<void>;
  dirty: boolean;
  saving?: boolean;
  /** True until App has established a baseline for this tab (cold-start hydrate). */
  loading?: boolean;
};

export function FileEditor({
  relPath,
  value,
  theme,
  onChange,
  onSave,
  dirty,
  saving = false,
  loading = false,
}: FileEditorProps) {
  const language = useMemo(() => languageFromRelPath(relPath), [relPath]);
  const monacoTheme = theme === "dark" ? "vs-dark" : "vs";
  const canSave = dirty && !saving && !loading;
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const blockedRef = useRef(saving || loading);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    blockedRef.current = saving || loading;
  }, [saving, loading]);

  const flushAndSave = useCallback(async () => {
    // Gate on loading/saving only: dirty is re-checked by App against the live
    // Monaco text (no-op when equal), so a Ctrl+S right after a keystroke is not
    // dropped by a not-yet-updated dirty flag.
    if (blockedRef.current) {
      return;
    }
    const text = editorRef.current?.getValue() ?? valueRef.current;
    onChangeRef.current(text);
    await onSaveRef.current(text);
  }, []);

  const handleMount = useCallback<OnMount>(
    (ed, monaco) => {
      editorRef.current = ed;
      ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        void flushAndSave();
      });
    },
    [flushAndSave],
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center justify-end gap-2 border-b bg-muted/30 px-2">
        {loading ? (
          <span className="px-2 text-xs text-muted-foreground" aria-live="polite">
            加载中…
          </span>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="default"
          disabled={!canSave}
          onClick={() => void flushAndSave()}
          aria-label="保存"
          title="保存"
        >
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          language={language}
          theme={monacoTheme}
          value={value}
          onChange={(next) => onChange(next ?? "")}
          onMount={handleMount}
          options={{
            minimap: { enabled: false },
            wordWrap: "on",
            fontSize: 12,
            automaticLayout: true,
            scrollBeyondLastLine: false,
            renderLineHighlight: "line",
            tabSize: 2,
            readOnly: loading,
          }}
        />
      </div>
    </div>
  );
}
