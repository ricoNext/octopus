import Editor, { type OnMount } from "@monaco-editor/react";
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
  onSave: () => void | Promise<void>;
  dirty: boolean;
  saving?: boolean;
};

export function FileEditor({
  relPath,
  value,
  theme,
  onChange,
  onSave,
  dirty,
  saving = false,
}: FileEditorProps) {
  const language = useMemo(() => languageFromRelPath(relPath), [relPath]);
  const monacoTheme = theme === "dark" ? "vs-dark" : "vs";
  const canSave = dirty && !saving;
  const onSaveRef = useRef(onSave);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  const handleMount = useCallback<OnMount>((editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void onSaveRef.current();
    });
  }, []);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center justify-end gap-2 border-b bg-muted/30 px-2">
        <Button
          type="button"
          size="sm"
          variant="default"
          disabled={!canSave}
          onClick={() => void onSave()}
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
          }}
        />
      </div>
    </div>
  );
}
