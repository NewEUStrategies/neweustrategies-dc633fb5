// Stan doku: które narzędzie jest otwarte. Czysta logika (reducer + zapis
// lokalny), żeby testować bez DOM i bez sieci.
import { DOCK_TOOLS, type DockToolId } from "./types";

export const DOCK_LAST_TOOL_KEY = "nes.dock.lastTool.v1";

export interface DockState {
  /** null = wszystkie panele zamknięte. */
  open: DockToolId | null;
}

export type DockAction =
  { type: "toggle"; tool: DockToolId } | { type: "open"; tool: DockToolId } | { type: "close" };

export const initialDockState: DockState = { open: null };

export function dockReducer(state: DockState, action: DockAction): DockState {
  switch (action.type) {
    case "toggle":
      return { open: state.open === action.tool ? null : action.tool };
    case "open":
      return state.open === action.tool ? state : { open: action.tool };
    case "close":
      return state.open === null ? state : { open: null };
    default:
      return state;
  }
}

export function isDockTool(value: unknown): value is DockToolId {
  return DOCK_TOOLS.includes(value as DockToolId);
}

export function readLastTool(storage: Pick<Storage, "getItem"> | null): DockToolId | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(DOCK_LAST_TOOL_KEY);
    return isDockTool(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function writeLastTool(
  storage: Pick<Storage, "setItem" | "removeItem"> | null,
  tool: DockToolId | null,
): void {
  if (!storage) return;
  try {
    if (tool === null) storage.removeItem(DOCK_LAST_TOOL_KEY);
    else storage.setItem(DOCK_LAST_TOOL_KEY, tool);
  } catch {
    /* prywatny tryb przeglądarki - stan doku to nie dane, można pominąć */
  }
}
