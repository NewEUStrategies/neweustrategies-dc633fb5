// Molecule: shared tab-bar for Section acting as tab container.
// Used by BuilderRenderer (canvas + public) to display and switch section tabs.
import type { CSSProperties, KeyboardEvent } from "react";
import type { SectionTabsConfig, SectionTabItem } from "@/lib/builder/types";

interface Props {
  sectionId: string;
  tabs: SectionTabsConfig;
  lang: "pl" | "en";
  activeId: string;
  onSelect: (id: string) => void;
  /** When true, keyboard nav (ArrowLeft/Right/Home/End) is wired. */
  keyboard?: boolean;
}

function labelOf(item: SectionTabItem, lang: "pl" | "en"): string {
  if (lang === "en" && item.label_en && item.label_en.trim()) return item.label_en;
  return item.label_pl || item.label_en || "Tab";
}

export function SectionTabsBar({
  sectionId,
  tabs,
  lang,
  activeId,
  onSelect,
  keyboard = true,
}: Props) {
  const orientation = tabs.orientation ?? "horizontal";
  const variant = tabs.variant ?? "underline";
  const align = tabs.align ?? "start";
  const items = tabs.items ?? [];
  if (items.length === 0) return null;

  const wrapMode = tabs.mobileMode ?? "scroll"; // "scroll" | "wrap"
  const listStyle: CSSProperties =
    orientation === "vertical"
      ? { display: "flex", flexDirection: "column", gap: 4, minWidth: 160 }
      : {
          display: "flex",
          flexWrap: wrapMode === "wrap" ? "wrap" : "nowrap",
          gap: variant === "pills" || variant === "ghost" ? 6 : 0,
          justifyContent:
            align === "center" ? "center" : align === "end" ? "flex-end" : "flex-start",
          borderBottom: variant === "underline" ? "1px solid var(--border, hsl(var(--border)))" : undefined,
          overflowX: wrapMode === "scroll" ? "auto" : undefined,
          overflowY: "hidden",
          WebkitOverflowScrolling: "touch",
          scrollbarWidth: "thin",
          maxWidth: "100%",
        };

  const idxOf = (id: string) => items.findIndex((t) => t.id === id);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!keyboard) return;
    const cur = idxOf(activeId);
    if (cur < 0) return;
    let next = cur;
    if (e.key === "ArrowRight" || (orientation === "vertical" && e.key === "ArrowDown")) {
      next = (cur + 1) % items.length;
    } else if (e.key === "ArrowLeft" || (orientation === "vertical" && e.key === "ArrowUp")) {
      next = (cur - 1 + items.length) % items.length;
    } else if (e.key === "Home") {
      next = 0;
    } else if (e.key === "End") {
      next = items.length - 1;
    } else {
      return;
    }
    e.preventDefault();
    onSelect(items[next].id);
  };

  return (
    <div
      role="tablist"
      aria-orientation={orientation}
      data-section-tabs-bar
      data-orientation={orientation}
      style={listStyle}
      className="cms-section-tabs"
    >
      {items.map((it) => {
        const active = it.id === activeId;
        const base: CSSProperties = {
          appearance: "none",
          background: "transparent",
          border: "none",
          padding: "8px 14px",
          fontSize: 14,
          fontWeight: active ? 600 : 500,
          cursor: "pointer",
          color: active ? "var(--foreground, inherit)" : "var(--muted-foreground, inherit)",
          transition: "all .15s ease",
          whiteSpace: "nowrap",
        };
        const variantStyle: CSSProperties =
          variant === "underline"
            ? {
                borderBottom: `2px solid ${active ? "var(--brand, currentColor)" : "transparent"}`,
                marginBottom: -1,
              }
            : variant === "pills"
              ? {
                  borderRadius: 999,
                  background: active
                    ? "color-mix(in oklab, var(--brand, currentColor) 12%, transparent)"
                    : "transparent",
                }
              : variant === "bordered"
                ? {
                    border: "1px solid var(--border, hsl(var(--border)))",
                    borderRadius: 6,
                    background: active ? "var(--card, transparent)" : "transparent",
                  }
                : {
                    borderRadius: 6,
                    background: active
                      ? "color-mix(in oklab, currentColor 8%, transparent)"
                      : "transparent",
                  };
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            id={`sec-${sectionId}-tab-${it.id}`}
            aria-selected={active}
            aria-controls={`sec-${sectionId}-panel-${it.id}`}
            tabIndex={active ? 0 : -1}
            data-builder-chrome
            data-section-tab-btn
            data-section-tab-id={it.id}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(it.id);
            }}
            // While dragging a widget / section / structure over the tab
            // header, switch to that tab so the user can drop content into it
            // without first clicking to activate the tab.
            onDragEnter={(e) => {
              if (!active && e.dataTransfer && e.dataTransfer.types.length > 0) {
                onSelect(it.id);
              }
            }}
            onDragOver={(e) => {
              // Allow the drop chain to continue - the panel underneath handles insertion.
              e.preventDefault();
            }}
            onKeyDown={onKey}
            style={{ ...base, ...variantStyle }}
          >
            {labelOf(it, lang)}
          </button>
        );
      })}
    </div>
  );
}
