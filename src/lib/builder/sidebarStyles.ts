// Shared sidebar style presets used by:
//  - Global Colors → Sidebar (picker UI)
//  - AdminShell (renders [data-sidebar-style] on <aside>)
//  - Global Layout 6 (Left Global Sidebar)
// Internal admin sidebar and global sidebar always share the same style.

export type SidebarStyle =
  | "style-1"
  | "style-2"
  | "style-3"
  | "style-4"
  | "style-5"
  | "style-6";

export const SIDEBAR_STYLES: { id: SidebarStyle; label: string; hint: string }[] = [
  { id: "style-1", label: "Style 1 — Solid Classic", hint: "Pełne tło karty, ostre rogi, klasyczny układ." },
  { id: "style-2", label: "Style 2 — Minimal Borderless", hint: "Bez tła, hairline border, tekstowe aktywne." },
  { id: "style-3", label: "Style 3 — Floating Card", hint: "Odsunięty od krawędzi, mocno zaokrąglony, miękki cień." },
  { id: "style-4", label: "Style 4 — Compact Icon Rail", hint: "Wąski 56px pasek z samymi ikonami." },
  { id: "style-5", label: "Style 5 — Glass / Frosted", hint: "Półprzezroczyste tło z mocnym backdrop blur." },
  { id: "style-6", label: "Style 6 — Bold Dark", hint: "Wymuszony ciemny kontrast w obu trybach + akcent brand." },
];
