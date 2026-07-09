// Shared sidebar style presets + mini-preview used by:
//  - Global Colors → Sidebar tab (picker UI)
//  - AdminShell (renders [data-sidebar-style] on <aside>)
//  - Global Layout 6 (Left Global Sidebar)
// Internal admin sidebar and global sidebar always share the same style.
import type React from "react";

export type SidebarStyle = "style-1" | "style-2" | "style-3" | "style-4" | "style-5" | "style-6";

export const SIDEBAR_STYLES: { id: SidebarStyle; label: string; hint: string }[] = [
  {
    id: "style-1",
    label: "Style 1 - Solid Classic",
    hint: "Pełne tło karty, ostre rogi pozycji menu.",
  },
  {
    id: "style-2",
    label: "Style 2 - Minimal Borderless",
    hint: "Bez tła, hairline dashed border, tekstowe aktywne z lewą kreską.",
  },
  {
    id: "style-3",
    label: "Style 3 - Floating Card",
    hint: "Odsunięty od krawędzi, mocno zaokrąglony, miękki cień.",
  },
  {
    id: "style-4",
    label: "Style 4 - Compact Icon Rail",
    hint: "Wąski 56px pasek z samymi ikonami.",
  },
  {
    id: "style-5",
    label: "Style 5 - Glass / Frosted",
    hint: "Półprzezroczyste tło, backdrop blur, gradientowe items.",
  },
  {
    id: "style-6",
    label: "Style 6 - Bold Dark",
    hint: "Wymuszony ciemny kontrast w obu trybach + akcent brand.",
  },
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
      wrap: { background: "color-mix(in oklab, var(--muted) 40%, transparent)" },
      aside: { background: "var(--card)", borderRight: "1px solid var(--border)" },
      brand: { color: "var(--foreground)" },
      item: { color: "var(--foreground)" },
      itemActive: { background: "var(--primary)", color: "var(--primary-foreground)" },
      width: 96,
      showLabels: true,
      itemRadius: 0,
    },
    "style-2": {
      wrap: { background: "var(--background)" },
      aside: { background: "transparent", borderRight: "1px dashed var(--border)" },
      brand: { color: "var(--foreground)" },
      item: {
        color: "var(--muted-foreground)",
        borderLeft: "2px solid transparent",
        paddingLeft: 8,
      },
      itemActive: {
        color: "var(--primary)",
        fontWeight: 700,
        borderLeft: "2px solid var(--primary)",
        paddingLeft: 8,
      },
      width: 96,
      showLabels: true,
      itemRadius: 0,
    },
    "style-3": {
      wrap: { background: "color-mix(in oklab, var(--muted) 50%, transparent)", padding: 8 },
      aside: {
        background: "var(--card)",
        borderRadius: 4,
        boxShadow: "0 10px 28px -10px rgba(0,0,0,0.3)",
        border: "1px solid var(--border)",
      },
      brand: { color: "var(--foreground)" },
      item: { color: "var(--foreground)", margin: "0 4px" },
      itemActive: {
        background: "var(--primary)",
        color: "var(--primary-foreground)",
        margin: "0 4px",
      },
      width: 92,
      showLabels: true,
      itemRadius: 4,
    },
    "style-4": {
      wrap: { background: "color-mix(in oklab, var(--muted) 40%, transparent)" },
      aside: { background: "var(--card)", borderRight: "1px solid var(--border)" },
      brand: { color: "var(--foreground)", justifyContent: "center" },
      item: {
        color: "var(--muted-foreground)",
        justifyContent: "center",
        width: 26,
        height: 26,
        margin: "1px auto",
      },
      itemActive: {
        background: "var(--primary)",
        color: "var(--primary-foreground)",
        justifyContent: "center",
        width: 26,
        height: 26,
        margin: "1px auto",
      },
      width: 38,
      showLabels: false,
      itemRadius: 6,
    },
    "style-5": {
      wrap: {
        background:
          "linear-gradient(135deg, color-mix(in oklab, var(--primary) 25%, transparent), var(--muted))",
      },
      aside: {
        background: "color-mix(in oklab, var(--card) 55%, transparent)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        border: "1px solid color-mix(in oklab, var(--border) 50%, transparent)",
      },
      brand: { color: "var(--foreground)" },
      item: { color: "var(--foreground)" },
      itemActive: {
        background: "color-mix(in oklab, var(--primary) 85%, transparent)",
        color: "var(--primary-foreground)",
      },
      width: 96,
      showLabels: true,
      itemRadius: 6,
    },
    "style-6": {
      wrap: { background: "color-mix(in oklab, var(--muted) 40%, transparent)" },
      aside: { background: "#0f0f0f", borderRight: "1px solid #1f1f1f" },
      brand: { color: "#ffffff" },
      item: { color: "#c7c9d1", margin: "0 6px" },
      itemActive: {
        background: "var(--primary)",
        color: "var(--primary-foreground)",
        margin: "0 6px",
        boxShadow: "0 4px 12px -4px color-mix(in oklab, var(--primary) 60%, transparent)",
      },
      width: 96,
      showLabels: true,
      itemRadius: 6,
    },
  };
  const p = presets[style];
  const items = ["Kokpit", "Wpisy", "Media", "Ustawienia"];
  return (
    <div
      style={{ ...p.wrap, height: 132, borderRadius: 8 }}
      className="flex overflow-hidden border border-border/60"
    >
      <div style={{ width: p.width, padding: 6, ...p.aside }} className="flex flex-col gap-1">
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: "4px 6px",
            display: "flex",
            alignItems: "center",
            minHeight: 22,
            ...p.brand,
          }}
        >
          {p.showLabels ? "NES" : "N"}
        </div>
        {p.showLabels && (
          <div
            style={{
              fontSize: 8,
              letterSpacing: 0.8,
              opacity: 0.7,
              padding: "2px 6px",
              textTransform: "uppercase",
            }}
          >
            Nawigacja
          </div>
        )}
        {items.map((label, i) => (
          <div
            key={label}
            style={{
              fontSize: 10,
              padding: p.showLabels ? "4px 6px" : "0",
              display: "flex",
              alignItems: "center",
              gap: 4,
              borderRadius: p.itemRadius,
              ...(i === 0 ? p.itemActive : p.item),
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: "currentColor",
                opacity: 0.7,
                flexShrink: 0,
              }}
            />
            {p.showLabels && <span>{label}</span>}
          </div>
        ))}
      </div>
      <div
        className="flex-1"
        style={{
          background: "color-mix(in oklab, var(--background) 40%, transparent)",
          padding: 8,
        }}
      >
        <div
          style={{
            height: 18,
            borderRadius: 4,
            background: "color-mix(in oklab, var(--muted) 85%, transparent)",
            marginBottom: 6,
          }}
        />
        <div
          style={{
            height: 34,
            borderRadius: 6,
            background: "var(--card)",
            border: "1px solid color-mix(in oklab, var(--border) 70%, transparent)",
            marginBottom: 6,
          }}
        />
        <div
          style={{
            height: 22,
            borderRadius: 6,
            background: "color-mix(in oklab, var(--muted) 65%, transparent)",
            width: "78%",
            marginBottom: 4,
          }}
        />
        <div
          style={{
            height: 22,
            borderRadius: 6,
            background: "color-mix(in oklab, var(--muted) 45%, transparent)",
            width: "62%",
          }}
        />
      </div>
    </div>
  );
}
