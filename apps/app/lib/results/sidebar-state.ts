/**
 * Sidebar auto-collapse (P9-7) as a pure state machine, so the rules are testable without a DOM:
 *  - working in the graph (pan, zoom or node drag begins) collapses the sidebar to its rail, unless pinned;
 *  - the pointer resting on the rail (~150 ms, timed by the caller), keyboard focus on the rail, "/" and a
 *    selection made from search expand it;
 *  - the header toggle collapses or expands explicitly; the pin keeps it open (remembered per browser).
 * `animate` is false under prefers-reduced-motion: the state still changes, instantly.
 */
export type SidebarMode = "expanded" | "rail";

export interface SidebarState {
  mode: SidebarMode;
  pinned: boolean;
  /** how the last change should be shown */
  animate: boolean;
  /** expanded by a hover on the rail: leaving the sidebar may collapse it again */
  peek: boolean;
}

export type SidebarEvent =
  | { t: "graphInteract" }
  | { t: "railHoverRest" }
  | { t: "railFocus" }
  | { t: "slash" }
  | { t: "searchSelect" }
  | { t: "pointerLeave" }
  | { t: "toggle" }
  | { t: "togglePin" }
  | { t: "reducedMotion"; on: boolean };

export function initialSidebar(pinned: boolean, reducedMotion = false): SidebarState {
  return { mode: "expanded", pinned, animate: !reducedMotion, peek: false };
}

export function sidebarReducer(s: SidebarState, e: SidebarEvent): SidebarState {
  const expand = (peek = false): SidebarState => ({ ...s, mode: "expanded", peek });
  switch (e.t) {
    case "graphInteract":
      return s.pinned || s.mode === "rail" ? s : { ...s, mode: "rail", peek: false };
    case "railHoverRest":
      return s.mode === "rail" ? expand(true) : s;
    case "railFocus":
    case "slash":
    case "searchSelect":
      return s.mode === "rail" ? expand(false) : { ...s, peek: false };
    case "pointerLeave":
      // a hover-peek closes again when the pointer goes back to the graph
      return s.peek && !s.pinned ? { ...s, mode: "rail", peek: false } : s;
    case "toggle":
      return s.mode === "rail" ? expand(false) : { ...s, mode: "rail", peek: false, pinned: false };
    case "togglePin":
      return { ...s, pinned: !s.pinned, mode: s.pinned ? s.mode : "expanded", peek: false };
    case "reducedMotion":
      return { ...s, animate: !e.on };
  }
}

const PIN_KEY = "va:results-sidebar-pinned:v1";
export function loadPinned(): boolean {
  try {
    return localStorage.getItem(PIN_KEY) === "1";
  } catch {
    return false;
  }
}
export function savePinned(pinned: boolean): void {
  try {
    localStorage.setItem(PIN_KEY, pinned ? "1" : "0");
  } catch {
    // storage unavailable: the choice lasts for this page only
  }
}
