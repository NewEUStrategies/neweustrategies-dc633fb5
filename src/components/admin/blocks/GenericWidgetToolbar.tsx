// Uniwersalny toolbar dla dowolnego widgetu/bloku w CMS builderze wpisów.
// Zawsze widoczny nad blokiem gdy jest aktywny. Wyświetla wspólne akcje
// zapisywane w `block.data`: wyrównanie, tryb szerokości, padding pionowy,
// kolor tła, anchor/ID. Renderers publiczne konsumują te same pola co inne
// bloki, więc zmiany są w pełni portowane do frontu.
import { useState, type ReactNode } from "react";
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  Anchor,
  Palette,
  Maximize2,
  Minimize2,
  StretchHorizontal,
} from "lucide-react";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import { promptDialog } from "@/lib/appDialogs";
import { BLOCK_PALETTE_KEYS, BLOCK_PALETTE_VAR, hasBlockPalette } from "@/lib/blocks/variants";
import type { Block, Json } from "@/lib/blocks/types";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

function TBtn({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={[
        "inline-flex h-7 min-w-7 px-1.5 items-center justify-center rounded-sm border border-transparent",
        "text-foreground hover:bg-foreground/5 transition-colors",
        active ? "bg-foreground/10 border-foreground/20" : "",
      ].join(" ")}
      title={title}
      aria-label={title}
      aria-pressed={active ? true : undefined}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />;
}

export function GenericWidgetToolbar({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const d = (block.data ?? {}) as Record<string, Json>;
  const align = String(d.align ?? "left");
  const width = String(d.width ?? "default");
  const padY = String(d.padY ?? "md");
  const bg = typeof d.bg === "string" ? (d.bg as string) : "";
  const [bgOpen, setBgOpen] = useState(false);
  const showPalette = hasBlockPalette(block.type);
  const palette = String(d.colorPalette ?? "neutral");
  const [paletteOpen, setPaletteOpen] = useState(false);

  const set = (patch: Record<string, Json>) =>
    onChange({ ...block, data: { ...block.data, ...patch } });

  return (
    <div
      data-widget-toolbar="generic"
      className="absolute bottom-full left-0 z-30 mb-1 flex max-w-[min(100%,calc(100vw-1.5rem))] flex-wrap items-center gap-0.5 overflow-visible rounded-md border border-border bg-popover px-1.5 py-1 shadow-md"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Wyrównanie */}
      <TBtn
        title={i18n.t("blocks.toolbar.alignLeft")}
        active={align === "left"}
        onClick={() => set({ align: "left" })}
      >
        <AlignLeft className="h-3.5 w-3.5" />
      </TBtn>
      <TBtn
        title={i18n.t("blocks.toolbar.alignCenter")}
        active={align === "center"}
        onClick={() => set({ align: "center" })}
      >
        <AlignCenter className="h-3.5 w-3.5" />
      </TBtn>
      <TBtn
        title={i18n.t("blocks.toolbar.alignRight")}
        active={align === "right"}
        onClick={() => set({ align: "right" })}
      >
        <AlignRight className="h-3.5 w-3.5" />
      </TBtn>

      <Divider />

      {/* Szerokość */}
      <TBtn
        title={i18n.t("blocks.toolbar.widthNarrow")}
        active={width === "narrow"}
        onClick={() => set({ width: "narrow" })}
      >
        <Minimize2 className="h-3.5 w-3.5" />
      </TBtn>
      <TBtn
        title={i18n.t("blocks.toolbar.widthWide")}
        active={width === "wide"}
        onClick={() => set({ width: "wide" })}
      >
        <StretchHorizontal className="h-3.5 w-3.5" />
      </TBtn>
      <TBtn
        title={i18n.t("blocks.toolbar.widthFull")}
        active={width === "full"}
        onClick={() => set({ width: "full" })}
      >
        <Maximize2 className="h-3.5 w-3.5" />
      </TBtn>

      <Divider />

      {/* Padding pionowy */}
      {(["sm", "md", "lg"] as const).map((s) => (
        <TBtn
          key={s}
          title={i18n.t(`blocks.toolbar.padY_${s}`)}
          active={padY === s}
          onClick={() => set({ padY: s })}
        >
          <span className="text-[10px] font-semibold leading-none uppercase">{s}</span>
        </TBtn>
      ))}

      <Divider />

      {/* Kolor tła */}
      <div className="relative">
        <TBtn
          title={i18n.t("blocks.toolbar.bg")}
          active={Boolean(bg)}
          onClick={() => setBgOpen((v) => !v)}
        >
          <Palette className="h-3.5 w-3.5" />
        </TBtn>
        {bgOpen && (
          <div className="absolute left-0 top-8 z-40 flex items-center gap-1 rounded-md border border-border bg-popover p-1 shadow-md">
            <input
              type="color"
              value={bg || "#ffffff"}
              onChange={(e) => set({ bg: e.target.value })}
              className="h-7 w-8 cursor-pointer rounded border border-border bg-transparent"
              aria-label={i18n.t("blocks.toolbar.bg")}
            />
            <button
              type="button"
              onClick={() => {
                set({ bg: "" });
                setBgOpen(false);
              }}
              className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {i18n.t("blocks.toolbar.clear")}
            </button>
          </div>
        )}
      </div>

      {/* Kolorystyka widgetu (np. cytat) - dostępna dopiero po kliknięciu bloku */}
      {showPalette && (
        <>
          <Divider />
          <div className="relative">
            <TBtn
              title={i18n.t("blocks.settings.colorPalette", { defaultValue: "Kolorystyka" })}
              active={palette !== "neutral"}
              onClick={() => setPaletteOpen((v) => !v)}
            >
              <span
                aria-hidden
                className="inline-block h-3.5 w-3.5 rounded-[3px] border border-border"
                style={{ background: BLOCK_PALETTE_VAR[palette] ?? BLOCK_PALETTE_VAR.neutral }}
              />
            </TBtn>
            {paletteOpen && (
              <div className="absolute left-0 top-8 z-40 flex items-center gap-1 rounded-md border border-border bg-popover p-1 shadow-md">
                {BLOCK_PALETTE_KEYS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      set({ colorPalette: p });
                      setPaletteOpen(false);
                    }}
                    title={i18n.t(`blocks.settings.palette.${p}`, { defaultValue: p })}
                    aria-label={i18n.t(`blocks.settings.palette.${p}`, { defaultValue: p })}
                    aria-pressed={palette === p}
                    className={`h-6 w-6 rounded-[4px] border ${
                      palette === p ? "border-foreground" : "border-border"
                    }`}
                    style={{ background: BLOCK_PALETTE_VAR[p] }}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <Divider />

      {/* Anchor / ID */}
      <TBtn
        title={i18n.t("blocks.toolbar.anchor")}
        active={Boolean(d.anchor)}
        onClick={async () => {
          const v = await promptDialog({
            title: i18n.t("blocks.toolbar.anchor"),
            label: "id-bloku",
            defaultValue: String(d.anchor ?? ""),
            confirmLabel: i18n.t("blocks.toolbar.apply"),
          });
          if (v === null) return;
          set({ anchor: v.trim().replace(/\s+/g, "-").toLowerCase() });
        }}
      >
        <Anchor className="h-3.5 w-3.5" />
      </TBtn>
    </div>
  );
}
