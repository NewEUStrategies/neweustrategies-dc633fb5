// Molecule: shared tab-bar for Section acting as tab container.
// Used by BuilderRenderer (canvas + public) to display and switch section tabs.
// Supports multiple visual variants (underline / underline-dot / thick /
// gradient / pills / pills-solid / bordered / ghost / segmented / boxed-top /
// minimal), Lucide icons per tab (icon left or on top), per-tab color and a
// global accent color that overrides the design-system --brand token.
import type { CSSProperties, KeyboardEvent } from "react";
import type { SectionTabsConfig, SectionTabItem } from "@/lib/builder/types";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";

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

  const iconPos = tabs.iconPosition ?? "left";
  const iconSize = Math.max(10, Math.min(32, tabs.iconSize ?? 16));
  const globalAccent = tabs.accentColor && tabs.accentColor.trim()
    ? tabs.accentColor
    : "var(--brand, currentColor)";

  const wrapMode = tabs.mobileMode ?? "scroll";
  const isPillish = variant === "pills" || variant === "pills-solid" || variant === "ghost";
  const gap =
    variant === "segmented"
      ? 0
      : isPillish
        ? 6
        : variant === "boxed-top" || variant === "bordered"
          ? 4
          : 2;

  const listStyle: CSSProperties =
    orientation === "vertical"
      ? { display: "flex", flexDirection: "column", gap: 4, minWidth: 160 }
      : {
          display: "flex",
          flexWrap: wrapMode === "wrap" ? "wrap" : "nowrap",
          gap,
          justifyContent:
            align === "center" ? "center" : align === "end" ? "flex-end" : "flex-start",
          borderBottom:
            variant === "underline" || variant === "underline-dot" || variant === "underline-thick" || variant === "underline-gradient"
              ? "1px solid var(--border, hsl(var(--border)))"
              : undefined,
          padding: variant === "segmented" ? 3 : undefined,
          background:
            variant === "segmented"
              ? "color-mix(in oklab, currentColor 6%, transparent)"
              : undefined,
          borderRadius: variant === "segmented" ? 10 : undefined,
          overflowX: wrapMode === "scroll" ? "auto" : "visible",
          overflowY: "visible",
          WebkitOverflowScrolling: "touch",
          scrollbarWidth: "thin",
          maxWidth: "100%",
          paddingBottom:
            variant === "underline-dot"
              ? 10
              : variant === "underline-thick" || variant === "underline-gradient"
                ? 2
                : undefined,
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
      data-tabs-variant={variant}
      style={listStyle}
      className="cms-section-tabs"
    >
      {items.map((it) => {
        const active = it.id === activeId;
        const accent = it.color && it.color.trim() ? it.color : globalAccent;
        const activeColor = accent;

        const base: CSSProperties = {
          position: "relative",
          appearance: "none",
          background: "transparent",
          border: "none",
          padding:
            iconPos === "top"
              ? "10px 14px 8px"
              : variant === "segmented"
                ? "6px 12px"
                : "8px 14px",
          fontSize: 14,
          fontWeight: active ? 600 : 500,
          cursor: "pointer",
          color: active ? "var(--foreground, inherit)" : "var(--muted-foreground, inherit)",
          transition: "color .18s ease, background .18s ease, border-color .18s ease, box-shadow .18s ease",
          whiteSpace: "nowrap",
          display: "inline-flex",
          flexDirection: iconPos === "top" ? "column" : "row",
          alignItems: "center",
          justifyContent: "center",
          gap: iconPos === "top" ? 4 : 8,
          lineHeight: 1.2,
        };

        let variantStyle: CSSProperties = {};
        switch (variant) {
          case "underline":
          case "underline-thick":
          case "underline-gradient":
          case "underline-dot":
            variantStyle = { marginBottom: -1 };
            break;
          case "pills":
            variantStyle = {
              borderRadius: 5,
              color: active ? activeColor : "var(--muted-foreground, inherit)",
              background: active
                ? `color-mix(in oklab, ${activeColor} 14%, transparent)`
                : "transparent",
            };
            break;
          case "pills-solid":
            variantStyle = {
              borderRadius: 5,
              color: active ? "var(--primary-foreground, #fff)" : "var(--muted-foreground, inherit)",
              background: active ? activeColor : "transparent",
              boxShadow: active
                ? `0 4px 14px -6px color-mix(in oklab, ${activeColor} 60%, transparent)`
                : "none",
            };
            break;
          case "bordered":
            variantStyle = {
              border: `1px solid ${active ? activeColor : "var(--border, hsl(var(--border)))"}`,
              borderRadius: 8,
              background: active
                ? `color-mix(in oklab, ${activeColor} 6%, transparent)`
                : "transparent",
            };
            break;
          case "segmented":
            variantStyle = {
              borderRadius: 8,
              background: active ? "var(--background, #fff)" : "transparent",
              boxShadow: active
                ? "0 1px 2px rgba(0,0,0,.06), 0 1px 3px rgba(0,0,0,.04)"
                : "none",
              color: active ? activeColor : "var(--muted-foreground, inherit)",
            };
            break;
          case "boxed-top":
            variantStyle = {
              borderLeft: active ? "1px solid var(--border, hsl(var(--border)))" : "1px solid transparent",
              borderRight: active ? "1px solid var(--border, hsl(var(--border)))" : "1px solid transparent",
              borderBottom: "1px solid transparent",
              borderRadius: "8px 8px 0 0",
              background: active ? "var(--background, transparent)" : "transparent",
              marginBottom: -1,
            };
            break;
          case "minimal":
            variantStyle = {
              padding: iconPos === "top" ? "6px 8px" : "6px 4px",
              marginRight: 12,
              color: active ? activeColor : "var(--muted-foreground, inherit)",
              opacity: active ? 1 : 0.7,
            };
            break;
          case "ghost":
          default:
            variantStyle = {
              borderRadius: 8,
              background: active
                ? "color-mix(in oklab, currentColor 8%, transparent)"
                : "transparent",
            };
        }

        // Animated indicators (rendered for all variants, hidden via scale/opacity when inactive)
        const isUnderline = variant === "underline" || variant === "underline-thick" || variant === "underline-gradient";
        const barHeight = variant === "underline-thick" ? 4 : variant === "underline-gradient" ? 3 : 2;
        const barBg = variant === "underline-gradient"
          ? `linear-gradient(90deg, ${activeColor}, color-mix(in oklab, ${activeColor} 30%, transparent))`
          : activeColor;


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
            data-active={active ? "true" : "false"}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(it.id);
            }}
            onDragEnter={(e) => {
              if (!active && e.dataTransfer && e.dataTransfer.types.length > 0) {
                onSelect(it.id);
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
            }}
            onKeyDown={onKey}
            style={{ ...base, ...variantStyle }}
          >
            {it.icon ? (
              <DynamicIcon
                name={it.icon}
                width={iconSize}
                height={iconSize}
                aria-hidden="true"
                style={{
                  color: active ? activeColor : "currentColor",
                  flexShrink: 0,
                }}
              />
            ) : null}
            <span>{labelOf(it, lang)}</span>
            {variant === "underline-dot" && active ? (
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: "50%",
                  bottom: 2,
                  transform: "translateX(-50%)",
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: activeColor,
                  boxShadow: `0 0 0 3px color-mix(in oklab, ${activeColor} 20%, transparent)`,
                }}
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
