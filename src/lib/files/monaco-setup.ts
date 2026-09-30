import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
// monaco-editor >=0.56 exports map "./*" -> "./esm/vs/*.js", so use package-root
// paths (not monaco-editor/esm/vs/...) with Vite's ?worker suffix.
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import cssWorker from "monaco-editor/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/language/json/json.worker?worker";
import tsWorker from "monaco-editor/language/typescript/ts.worker?worker";

/**
 * Vite 8 + Rolldown: implement MonacoEnvironment.getWorker (not getWorkerUrl)
 * via `?worker` imports. Point @monaco-editor/react loader at the local monaco
 * package so Tauri does not fetch the CDN.
 */
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    if (label === "json") {
      return new jsonWorker();
    }
    if (label === "css" || label === "scss" || label === "less") {
      return new cssWorker();
    }
    if (label === "html" || label === "handlebars" || label === "razor") {
      return new htmlWorker();
    }
    if (label === "typescript" || label === "javascript") {
      return new tsWorker();
    }
    return new editorWorker();
  },
};

loader.config({ monaco });
