import type { PaneLayoutNode } from "@/lib/terminal/pane-layout";
import { listLeaves } from "@/lib/terminal/pane-layout";
import { LeafSession } from "./leaf-session";
import { flexDirectionFor } from "./utils";

export type PaneManagerCallbacks = {
  onActiveLeafChange: (leafId: string) => void;
  onRatioChange: (layout: PaneLayoutNode) => void;
  onSplitLeaf: (leafId: string, direction: "horizontal" | "vertical") => void;
  onCloseLeaf: (leafId: string) => void;
};

type PaneManagerOptions = {
  cwdId: string;
  getLayout: () => PaneLayoutNode;
  getSessionId: (leafId: string) => string;
  getActiveLeafId: () => string;
  callbacks: PaneManagerCallbacks;
};

const ICON_SPLIT_RIGHT = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/></svg>`;
const ICON_SPLIT_DOWN = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 12h18"/></svg>`;
const ICON_CLOSE = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;

function createHeaderButton(opts: {
  title: string;
  ariaLabel: string;
  iconHtml: string;
  onClick: (event: MouseEvent) => void;
}): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.title = opts.title;
  button.setAttribute("aria-label", opts.ariaLabel);
  button.innerHTML = opts.iconHtml;
  button.style.cssText = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--muted-foreground);
    cursor: pointer;
  `;
  button.addEventListener("mouseenter", () => {
    button.style.background = "var(--muted)";
    button.style.color = "var(--foreground)";
  });
  button.addEventListener("mouseleave", () => {
    button.style.background = "transparent";
    button.style.color = "var(--muted-foreground)";
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    opts.onClick(event);
  });
  button.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  return button;
}

export class PaneManager {
  private host: HTMLElement;
  private opts: PaneManagerOptions;
  private sessions = new Map<string, LeafSession>();
  private leafContainers = new Map<string, HTMLElement>();
  private active = false;
  private dragState: {
    splitId: string;
    initialRatio: number;
    initialPos: number;
    isVertical: boolean;
  } | null = null;

  constructor(host: HTMLElement, opts: PaneManagerOptions) {
    this.host = host;
    this.opts = opts;
  }

  syncLayout() {
    const layout = this.opts.getLayout();
    const currentLeaves = listLeaves(layout);
    const existingLeaves = new Set(this.sessions.keys());

    for (const leafId of existingLeaves) {
      if (!currentLeaves.includes(leafId)) {
        const session = this.sessions.get(leafId);
        if (session) {
          session.dispose();
          this.sessions.delete(leafId);
        }
      }
    }

    const preservedInners = new Map(this.leafContainers);

    this.host.innerHTML = "";
    this.leafContainers.clear();
    this.buildNode(layout, this.host, preservedInners, currentLeaves.length);

    for (const leafId of currentLeaves) {
      const container = this.leafContainers.get(leafId);
      if (!container) {
        continue;
      }

      if (this.sessions.has(leafId)) {
        this.sessions.get(leafId)!.refit();
      } else {
        const sessionId = this.opts.getSessionId(leafId);
        const session = new LeafSession(container, sessionId, this.opts.cwdId);
        this.sessions.set(leafId, session);
        if (this.active) {
          session.setActive(true);
        }
      }
    }

    this.focusLeaf(this.opts.getActiveLeafId());
  }

  private buildNode(
    node: PaneLayoutNode,
    parent: HTMLElement,
    preservedInners: Map<string, HTMLElement>,
    leafCount: number,
  ) {
    if (node.type === "leaf") {
      this.buildLeaf(node.id, parent, preservedInners, leafCount);
    } else {
      this.buildSplit(node, parent, preservedInners, leafCount);
    }
  }

  private buildLeaf(
    leafId: string,
    parent: HTMLElement,
    preservedInners: Map<string, HTMLElement>,
    leafCount: number,
  ) {
    const container = document.createElement("div");
    container.className = "pane-leaf";
    container.dataset.leafId = leafId;
    container.style.cssText = `
      position: relative;
      flex: 1;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    `;

    const header = document.createElement("div");
    header.className = "pane-leaf-header";
    header.style.cssText = `
      position: absolute;
      top: 4px;
      right: 4px;
      z-index: 20;
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 2px;
      border-radius: 6px;
      background: color-mix(in oklab, var(--background) 85%, transparent);
      backdrop-filter: blur(6px);
      opacity: 0.55;
      transition: opacity 0.15s ease;
    `;
    header.addEventListener("mouseenter", () => {
      header.style.opacity = "1";
    });
    header.addEventListener("mouseleave", () => {
      header.style.opacity = "0.55";
    });

    header.appendChild(
      createHeaderButton({
        title: "向右分屏",
        ariaLabel: "向右分屏",
        iconHtml: ICON_SPLIT_RIGHT,
        onClick: () => {
          this.opts.callbacks.onActiveLeafChange(leafId);
          this.opts.callbacks.onSplitLeaf(leafId, "vertical");
        },
      }),
    );
    header.appendChild(
      createHeaderButton({
        title: "向下分屏",
        ariaLabel: "向下分屏",
        iconHtml: ICON_SPLIT_DOWN,
        onClick: () => {
          this.opts.callbacks.onActiveLeafChange(leafId);
          this.opts.callbacks.onSplitLeaf(leafId, "horizontal");
        },
      }),
    );
    if (leafCount > 1) {
      header.appendChild(
        createHeaderButton({
          title: "关闭此终端",
          ariaLabel: "关闭此终端",
          iconHtml: ICON_CLOSE,
          onClick: () => {
            this.opts.callbacks.onCloseLeaf(leafId);
          },
        }),
      );
    }

    container.appendChild(header);

    let inner = preservedInners.get(leafId);
    if (!inner) {
      inner = document.createElement("div");
      inner.style.cssText = `
      width: 100%;
      height: 100%;
      padding: 0.5rem;
      background: var(--background);
    `;
    }
    container.appendChild(inner);
    parent.appendChild(container);

    this.leafContainers.set(leafId, inner);

    container.addEventListener("click", () => {
      this.opts.callbacks.onActiveLeafChange(leafId);
      const session = this.sessions.get(leafId);
      if (session) {
        session.focus();
      }
    });
  }

  private buildSplit(
    node: Extract<PaneLayoutNode, { type: "split" }>,
    parent: HTMLElement,
    preservedInners: Map<string, HTMLElement>,
    leafCount: number,
  ) {
    const container = document.createElement("div");
    container.className = "pane-split";
    container.style.cssText = `
      display: flex;
      flex-direction: ${flexDirectionFor(node.direction)};
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
    `;

    const firstContainer = document.createElement("div");
    firstContainer.style.cssText = `
      flex: ${node.ratio};
      min-width: 0;
      min-height: 0;
      position: relative;
    `;
    container.appendChild(firstContainer);

    const divider = document.createElement("div");
    divider.className = "pane-divider";
    const isVertical = node.direction === "vertical";
    divider.style.cssText = `
      flex: none;
      width: ${isVertical ? "4px" : "100%"};
      height: ${isVertical ? "100%" : "4px"};
      background: transparent;
      cursor: ${isVertical ? "col-resize" : "row-resize"};
      position: relative;
      z-index: 10;
    `;

    const dividerHandle = document.createElement("div");
    dividerHandle.style.cssText = `
      position: absolute;
      ${isVertical ? "left: 1px; right: 1px; top: 0; bottom: 0;" : "top: 1px; bottom: 1px; left: 0; right: 0;"}
      background: var(--border);
      transition: background-color 0.15s;
    `;
    divider.appendChild(dividerHandle);

    divider.addEventListener("mouseenter", () => {
      dividerHandle.style.background = "var(--primary)";
    });
    divider.addEventListener("mouseleave", () => {
      if (!this.dragState) {
        dividerHandle.style.background = "var(--border)";
      }
    });

    divider.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      divider.setPointerCapture(event.pointerId);
      this.dragState = {
        splitId: node.id,
        initialRatio: node.ratio,
        initialPos: isVertical ? event.clientX : event.clientY,
        isVertical,
      };
      dividerHandle.style.background = "var(--primary)";
    });

    divider.addEventListener("pointermove", (event) => {
      if (!this.dragState || this.dragState.splitId !== node.id) {
        return;
      }
      const currentPos = this.dragState.isVertical ? event.clientX : event.clientY;
      const delta = currentPos - this.dragState.initialPos;
      const containerSize = this.dragState.isVertical
        ? container.offsetWidth
        : container.offsetHeight;
      const deltaRatio = delta / containerSize;
      const newRatio = Math.max(0.1, Math.min(0.9, this.dragState.initialRatio + deltaRatio));

      firstContainer.style.flex = String(newRatio);
      secondContainer.style.flex = String(1 - newRatio);
    });

    divider.addEventListener("pointerup", (event) => {
      if (!this.dragState || this.dragState.splitId !== node.id) {
        return;
      }
      divider.releasePointerCapture(event.pointerId);

      const currentPos = this.dragState.isVertical ? event.clientX : event.clientY;
      const delta = currentPos - this.dragState.initialPos;
      const containerSize = this.dragState.isVertical
        ? container.offsetWidth
        : container.offsetHeight;
      const deltaRatio = delta / containerSize;
      const newRatio = Math.max(0.1, Math.min(0.9, this.dragState.initialRatio + deltaRatio));

      this.dragState = null;
      dividerHandle.style.background = "var(--border)";

      this.updateRatioInTree(node.id, newRatio);
    });

    divider.addEventListener("pointercancel", () => {
      this.dragState = null;
      dividerHandle.style.background = "var(--border)";
    });

    container.appendChild(divider);

    const secondContainer = document.createElement("div");
    secondContainer.style.cssText = `
      flex: ${1 - node.ratio};
      min-width: 0;
      min-height: 0;
      position: relative;
    `;
    container.appendChild(secondContainer);

    parent.appendChild(container);

    this.buildNode(node.first, firstContainer, preservedInners, leafCount);
    this.buildNode(node.second, secondContainer, preservedInners, leafCount);
  }

  private updateRatioInTree(splitId: string, newRatio: number) {
    const layout = this.opts.getLayout();
    const updated = this.updateRatioInNode(layout, splitId, newRatio);
    if (updated) {
      this.opts.callbacks.onRatioChange(updated);
    }
  }

  private updateRatioInNode(
    node: PaneLayoutNode,
    splitId: string,
    newRatio: number,
  ): PaneLayoutNode | null {
    if (node.type === "leaf") {
      return null;
    }
    if (node.id === splitId) {
      return { ...node, ratio: newRatio };
    }
    const updatedFirst = this.updateRatioInNode(node.first, splitId, newRatio);
    const updatedSecond = this.updateRatioInNode(node.second, splitId, newRatio);
    if (updatedFirst || updatedSecond) {
      return {
        ...node,
        first: updatedFirst ?? node.first,
        second: updatedSecond ?? node.second,
      };
    }
    return null;
  }

  setActive(active: boolean) {
    this.active = active;
    for (const session of this.sessions.values()) {
      session.setActive(active);
    }
    if (active) {
      this.focusLeaf(this.opts.getActiveLeafId());
    }
  }

  focusLeaf(leafId: string) {
    const session = this.sessions.get(leafId);
    if (session) {
      session.focus();
    }
  }

  dispose() {
    for (const session of this.sessions.values()) {
      session.dispose();
    }
    this.sessions.clear();
    this.leafContainers.clear();
    this.host.innerHTML = "";
  }
}
