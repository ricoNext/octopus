import type { PaneLayoutNode } from "@/lib/terminal/pane-layout";
import { listLeaves } from "@/lib/terminal/pane-layout";
import { LeafSession } from "./leaf-session";
import { flexDirectionFor } from "./utils";

export type PaneManagerCallbacks = {
  onActiveLeafChange: (leafId: string) => void;
  onRatioChange: (layout: PaneLayoutNode) => void;
};

type PaneManagerOptions = {
  cwdId: string;
  getLayout: () => PaneLayoutNode;
  getSessionId: (leafId: string) => string;
  getActiveLeafId: () => string;
  callbacks: PaneManagerCallbacks;
};

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

    // Remove sessions for leaves that no longer exist
    for (const leafId of existingLeaves) {
      if (!currentLeaves.includes(leafId)) {
        const session = this.sessions.get(leafId);
        if (session) {
          session.dispose();
          this.sessions.delete(leafId);
        }
        this.leafContainers.delete(leafId);
      }
    }

    // Rebuild DOM tree
    this.host.innerHTML = "";
    this.leafContainers.clear();
    this.buildNode(layout, this.host);

    // Create new sessions for new leaves
    for (const leafId of currentLeaves) {
      if (!this.sessions.has(leafId)) {
        const container = this.leafContainers.get(leafId);
        if (container) {
          const sessionId = this.opts.getSessionId(leafId);
          const session = new LeafSession(container, sessionId, this.opts.cwdId);
          this.sessions.set(leafId, session);
          if (this.active) {
            session.setActive(true);
          }
        }
      }
    }

    // Update active states
    const activeLeafId = this.opts.getActiveLeafId();
    for (const [leafId, session] of this.sessions) {
      const isActive = leafId === activeLeafId;
      session.setActive(this.active && isActive);
    }
  }

  private buildNode(node: PaneLayoutNode, parent: HTMLElement) {
    if (node.type === "leaf") {
      this.buildLeaf(node.id, parent);
    } else {
      this.buildSplit(node, parent);
    }
  }

  private buildLeaf(leafId: string, parent: HTMLElement) {
    const container = document.createElement("div");
    container.className = "pane-leaf";
    container.style.cssText = `
      position: relative;
      flex: 1;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    `;

    const inner = document.createElement("div");
    inner.style.cssText = `
      width: 100%;
      height: 100%;
      padding: 0.5rem;
      background: var(--background);
    `;
    container.appendChild(inner);
    parent.appendChild(container);

    this.leafContainers.set(leafId, inner);

    // Handle click to focus
    container.addEventListener("click", () => {
      this.opts.callbacks.onActiveLeafChange(leafId);
      const session = this.sessions.get(leafId);
      if (session) {
        session.focus();
      }
    });
  }

  private buildSplit(node: Extract<PaneLayoutNode, { type: "split" }>, parent: HTMLElement) {
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

    // Divider
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

      // Callback to update the layout tree
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

    this.buildNode(node.first, firstContainer);
    this.buildNode(node.second, secondContainer);
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
    const activeLeafId = this.opts.getActiveLeafId();
    for (const [leafId, session] of this.sessions) {
      const isActive = leafId === activeLeafId;
      session.setActive(active && isActive);
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
