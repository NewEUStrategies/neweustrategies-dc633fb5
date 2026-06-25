// Shared sidebar style presets + mini-preview used by:
//  - Global Colors → Sidebar tab (picker UI)
//  - AdminShell (renders [data-sidebar-style] on <aside>)
//  - Global Layout 6 (Left Global Sidebar)
// Internal admin sidebar and global sidebar always share the same style.
import type React from "react";

export type SidebarStyle =
  | "style-1"
  | "style-2"
  | "style-3"
  | "style-4"
  | "style-5"
  | "style-6";

export const SIDEBAR_STYLES: { id: SidebarStyle; label: string; hint: string }[] = [
  { id: "style-1", label: "Style 1 - Solid Classic", hint: "Pełne tło karty, ostre rogi pozycji menu." },
  { id: "style-2", label: "Style 2 - Minimal Borderless", hint: "Bez tła, hairline dashed border, tekstowe aktywne z lewą kreską." },
  { id: "style-3", label: "Style 3 - Floating Card", hint: "Odsunięty od krawędzi, mocno zaokrąglony, miękki cień." },
  { id: "style-4", label: "Style 4 - Compact Icon Rail", hint: "Wąski 56px pasek z samymi ikonami." },
  { id: "style-5", label: "Style 5 - Glass / Frosted", hint: "Półprzezroczyste tło, backdrop blur, gradientowe items." },
  { id: "style-6", label: "Style 6 - Bold Dark", hint: "Wymuszony ciemny kontrast w obu trybach + akcent brand." },
];

export const SIDEBAR_ICON_FIELDS = [
  {
    key: "sidebar_icon",
    darkKey: "sidebar_icon_dark",
    label: "Ikona sidebaru - compact",
    hint: "Pokazywana w zwiniętym sidebarze i w stylu rail.",
  },
  {
    key: "sidebar_expanded",
    darkKey: "sidebar_expanded_dark",
    label: "Logo sidebaru - expanded",
    hint: "Pokazywane w szerokim sidebarze dla admina i globalnego układu.",
  },
] as const;

export function SidebarStylePreview({ style }: { style: SidebarStyle }) {
  type Preset = {
    wrap: React.CSSProperties;
    aside: React.CSSProperties;
    brand: React.CSSProperties;
    item: React.CSSProperties;
    itemActive: React.CSSProperties;
    itemHover?: React.CSSProperties;
    width: number;
    showLabels: boolean;
    itemRadius: number;
  };
  const presets: Record<SidebarStyle, Preset> = {
    "style-1": {
      wrap: { background: "hsl(var(--muted) / 0.4)" },
      aside: { background: "hsl(var(--card))", borderRight: "1px solid hsl(var(--border))" },
      brand: { color: "hsl(var(--foreground))" },
      item: { color: "hsl(var(--foreground))" },
      itemActive: { background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" },
      width: 96, showLabels: true, itemRadius: 0,
    },
    "style-2": {
      wrap: { background: "hsl(var(--background))" },
      aside: { background: "transparent", borderRight: "1px dashed hsl(var(--border))" },
      brand: { color: "hsl(var(--foreground))" },
      item: { color: "hsl(var(--muted-foreground))", borderLeft: "2px solid transparent", paddingLeft: 8 },
      itemActive: { color: "hsl(var(--primary))", fontWeight: 700, borderLeft: "2px solid hsl(var(--primary))", paddingLeft: 8 },
      width: 96, showLabels: true, itemRadius: 0,
    },
    "style-3": {
      wrap: { background: "hsl(var(--muted) / 0.5)", padding: 8 },
      aside: { background: "hsl(var(--card))", borderRadius: 4, boxShadow: "0 10px 28px -10px rgba(0,0,0,0.3)", border: "1px solid hsl(var(--border))" },
      brand: { color: "hsl(var(--foreground))" },
      item: { color: "hsl(var(--foreground))", margin: "0 4px" },
      itemActive: { background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))", margin: "0 4px" },
      width: 92, showLabels: true, itemRadius: 4,
    },
    "style-4": {
      wrap: { background: "hsl(var(--muted) / 0.4)" },
      aside: { background: "hsl(var(--card))", borderRight: "1px solid hsl(var(--border))" },
      brand: { color: "hsl(var(--foreground))", justifyContent: "center" },
      item: { color: "hsl(var(--muted-foreground))", justifyContent: "center", width: 26, height: 26, margin: "1px auto" },
      itemActive: { background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))", justifyContent: "center", width: 26, height: 26, margin: "1px auto" },
      width: 38, showLabels: false, itemRadius: 6,
    },
    "style-5": {
      wrap: { background: "linear-gradient(135deg, hsl(var(--primary) / 0.25), hsl(var(--muted)))" },
      aside: { background: "hsl(var(--card) / 0.55)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", border: "1px solid hsl(var(--border) / 0.5)" },
      brand: { color: "hsl(var(--foreground))" },
      item: { color: "hsl(var(--foreground))" },
      itemActive: { background: "hsl(var(--primary) / 0.85)", color: "hsl(var(--primary-foreground))" },
      width: 96, showLabels: true, itemRadius: 6,
    },
    "style-6": {
      wrap: { background: "hsl(var(--muted) / 0.4)" },
      aside: { background: "#0b0b12", borderRight: "1px solid #1f1f2b" },
      brand: { color: "#ffffff" },
      item: { color: "#c7c9d1", margin: "0 6px" },
      itemActive: { background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))", margin: "0 6px", boxShadow: "0 4px 12px -4px hsl(var(--primary) / 0.6)" },
      width: 96, showLabels: true, itemRadius: 6,
    },
  };
  const p = presets[style];
  const items = ["Kokpit", "Wpisy", "Media", "Ustawienia"];
  return (
    <div style={{ ...p.wrap, height: 132, borderRadius: 8 }} className="flex overflow-hidden border border-border/60">
      <div style={{ width: p.width, padding: 6, ...p.aside }} className="flex flex-col gap-1">
        <div style={{ fontSize: 10, fontWeight: 700, padding: "4px 6px", display: "flex", alignItems: "center", minHeight: 22, ...p.brand }}>
          {p.showLabels ? "NES" : "N"}
        </div>
        {p.showLabels && (
          <div style={{ fontSize: 8, letterSpacing: 0.8, opacity: 0.7, padding: "2px 6px", textTransform: "uppercase" }}>
            Nawigacja
          </div>
        )}
        {items.map((label, i) => (
          <div
            key={label}
            style={{
              fontSize: 10, padding: p.showLabels ? "4px 6px" : "0", display: "flex", alignItems: "center", gap: 4,
              borderRadius: p.itemRadius,
              ...(i === 0 ? p.itemActive : p.item),
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 2, background: "currentColor", opacity: 0.7, flexShrink: 0 }} />
            {p.showLabels && <span>{label}</span>}
          </div>
        ))}
      </div>
      <div className="flex-1" style={{ background: "hsl(var(--background) / 0.4)", padding: 8 }}>
        <div style={{ height: 18, borderRadius: 4, background: "hsl(var(--muted) / 0.85)", marginBottom: 6 }} />
        <div style={{ height: 34, borderRadius: 6, background: "hsl(var(--card))", border: "1px solid hsl(var(--border) / 0.7)", marginBottom: 6 }} />
        <div style={{ height: 22, borderRadius: 6, background: "hsl(var(--muted) / 0.65)", width: "78%", marginBottom: 4 }} />
        <div style={{ height: 22, borderRadius: 6, background: "hsl(var(--muted) / 0.45)", width: "62%" }} />
      </div>
    </div>
  );
}
