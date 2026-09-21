import { describe, expect, it } from "vitest";
import {
  DOCK_LAST_TOOL_KEY,
  dockReducer,
  initialDockState,
  isDockTool,
  readLastTool,
  writeLastTool,
} from "../dockState";

describe("dockState", () => {
  it("otwiera i zamyka to samo narzędzie przełącznikiem", () => {
    const opened = dockReducer(initialDockState, { type: "toggle", tool: "notes" });
    expect(opened.open).toBe("notes");
    expect(dockReducer(opened, { type: "toggle", tool: "notes" }).open).toBeNull();
  });

  it("trzyma dokładnie jeden panel otwarty", () => {
    const notes = dockReducer(initialDockState, { type: "open", tool: "notes" });
    expect(dockReducer(notes, { type: "toggle", tool: "todos" }).open).toBe("todos");
  });

  it("zamknięcie zamkniętego doku nie tworzy nowego stanu", () => {
    expect(dockReducer(initialDockState, { type: "close" })).toBe(initialDockState);
  });

  it("waliduje identyfikatory narzędzi", () => {
    expect(isDockTool("calendar")).toBe(true);
    expect(isDockTool("kalendarz")).toBe(false);
  });

  it("czyta i zapisuje ostatnie narzędzie, odrzucając śmieci", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    };
    writeLastTool(storage, "saved");
    expect(store.get(DOCK_LAST_TOOL_KEY)).toBe("saved");
    expect(readLastTool(storage)).toBe("saved");
    store.set(DOCK_LAST_TOOL_KEY, "nieznane");
    expect(readLastTool(storage)).toBeNull();
    writeLastTool(storage, null);
    expect(store.has(DOCK_LAST_TOOL_KEY)).toBe(false);
  });

  it("brak storage nie wywraca odczytu ani zapisu", () => {
    expect(readLastTool(null)).toBeNull();
    expect(() => writeLastTool(null, "chat")).not.toThrow();
  });
});
