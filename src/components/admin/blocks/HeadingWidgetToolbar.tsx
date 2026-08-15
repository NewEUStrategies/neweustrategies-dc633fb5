// Floating toolbar dla nagłówków (H1-H5) w CMS Builderze wpisów.
// Zawsze widoczny nad blokiem - pozwala szybko zmienić poziom, wyrównanie,
// formatowanie (pogrubienie / kursywa / tekst normalny), kolor tekstu oraz
// dodać anchor/ID. PL/EN i18n przez useBlocksI18n().
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  Hash,
  Bold,
  Italic,
  Trash2,
  Anchor,
  Palette,
  RemoveFormatting,
} from "lucide-react";
import type { Editor } from "@tiptap/react";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import { promptDialog } from "@/lib/appDialogs";
import { safeCssColor } from "@/lib/blocks/inlineHtml";
import type { Block, Json } from "@/lib/blocks/types";

/** Paleta kolorów nagłówka - tokeny motywu + bezpieczne kolory druku. */
const HEADING_COLORS: readonly { value: string; label: string }[] = [
  { value: "var(--foreground)", label: "Domyślny" },
  { value: "var(--primary)", label: "Primary" },
  { value: "var(--muted-foreground)", label: "Muted" },
  { value: "#c0392b", label: "Czerwony" },
  { value: "#e67e22", label: "Pomarańczowy" },
  { value: "#f1c40f", label: "Żółty" },
  { value: "#27ae60", label: "Zielony" },
  { value: "#2980b9", label: "Niebieski" },
  { value: "#8e44ad", label: "Fioletowy" },
  { value: "#111111", label: "Czarny" },
  { value: "#ffffff", label: "Biały" },
];

interface Props {
  block: Block;
  onChange: (next: Block) => void;
  editor?: Editor | null;
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

export function HeadingWidgetToolbar({ block, onChange, editor }: Props) {
  const i18n = useBlocksI18n();
  const [, force] = useState(0);
  useEffect(() => force((n) => n + 1), [block.data]);

  const d = block.data as Record<string, Json>;
  const level = Number(d.level ?? 2);
  const align = String(d.align ?? "left");
  const set = (patch: Record<string, Json>) =>
    onChange({ ...block, data: { ...block.data, ...patch } });

  const [colorOpen, setColorOpen] = useState(false);

  /**
   * Kolor: przy niepustym zaznaczeniu koloruje INLINE (mark textStyle), inaczej
   * ustawia kolor całego bloku (`data.color`) - tak samo czyta to renderer
   * publiczny, więc podgląd i strona są identyczne.
   */
  const applyColor = (value: string | null) => {
    const sel = editor?.state.selection;
    const hasSelection = Boolean(sel && sel.from !== sel.to);
    if (editor && hasSelection) {
      if (value) editor.chain().focus().setColor(value).run();
      else editor.chain().focus().unsetColor().run();
      return;
    }
    set({ color: value ?? "" });
  };

  const rootRef = useRef<HTMLDivElement | null>(null);

  return (
    <div
      ref={rootRef}
      className="absolute -top-[38px] left-0 z-30 flex items-center gap-0.5 rounded-md border border-border bg-popover px-1.5 py-1 shadow-md"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Poziom nagłówka */}
      {[1, 2, 3, 4, 5].map((lvl) => (
        <TBtn
          key={lvl}
          title={`H${lvl}`}
          active={level === lvl}
          onClick={() => set({ level: lvl })}
        >
          <span className="text-[11px] font-bold leading-none">H{lvl}</span>
        </TBtn>
      ))}

      <Divider />

      {/* Formatowanie inline (jeśli edytor dostępny) */}
      {editor && (
        <>
          <TBtn
            title={i18n.t("blocks.toolbar.bold")}
            active={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold className="h-3.5 w-3.5" />
          </TBtn>
          <TBtn
            title={i18n.t("blocks.toolbar.italic")}
            active={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic className="h-3.5 w-3.5" />
          </TBtn>
          <TBtn
            title={i18n.t("blocks.toolbar.normalText")}
            onClick={() => editor.chain().focus().unsetAllMarks().unsetMark("textStyle").run()}
          >
            <RemoveFormatting className="h-3.5 w-3.5" />
          </TBtn>
          <Divider />
        </>
      )}

      {/* Kolor nagłówka - zaznaczenie koloruje inline, brak zaznaczenia = cały blok */}
      <div className="relative">
        <TBtn
          title={i18n.t("blocks.toolbar.color")}
          active={colorOpen || Boolean(safeCssColor(d.color))}
          onClick={() => setColorOpen((v) => !v)}
        >
          <Palette className="h-3.5 w-3.5" style={{ color: safeCssColor(d.color) }} />
        </TBtn>
        {colorOpen && (
          <div
            role="dialog"
            aria-label={i18n.t("blocks.toolbar.color")}
            className="absolute left-0 top-[30px] z-40 w-[188px] rounded-md border border-border bg-popover p-2 shadow-lg"
          >
            <div className="grid grid-cols-6 gap-1">
              {HEADING_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  title={c.label}
                  aria-label={c.label}
                  onClick={() => {
                    applyColor(c.value);
                    setColorOpen(false);
                  }}
                  className="h-5 w-5 rounded-sm border border-border"
                  style={{ background: c.value }}
                />
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="color"
                aria-label={i18n.t("blocks.toolbar.colorCustom")}
                value={
                  /^#[0-9a-fA-F]{6}$/.test(String(d.color ?? "")) ? String(d.color) : "#111111"
                }
                onChange={(e) => applyColor(e.target.value)}
                className="h-6 w-10 cursor-pointer rounded border border-border bg-transparent p-0"
              />
              <button
                type="button"
                className="text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => {
                  applyColor(null);
                  setColorOpen(false);
                }}
              >
                {i18n.t("blocks.toolbar.colorReset")}
              </button>
            </div>
          </div>
        )}
      </div>

      <Divider />

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

      {/* Anchor / ID */}
      <TBtn
        title={i18n.t("blocks.toolbar.anchor")}
        active={Boolean(d.anchor)}
        onClick={async () => {
          const v = await promptDialog({
            title: i18n.t("blocks.toolbar.anchor"),
            label: "slug-nagłówka",
            defaultValue: String(d.anchor ?? ""),
            confirmLabel: i18n.t("blocks.toolbar.apply"),
          });
          if (v === null) return;
          set({ anchor: v.trim().replace(/\s+/g, "-").toLowerCase() });
        }}
      >
        <Anchor className="h-3.5 w-3.5" />
      </TBtn>
      <TBtn
        title={i18n.t("blocks.toolbar.toc")}
        active={d.inToc !== false}
        onClick={() => set({ inToc: d.inToc === false })}
      >
        <Hash className="h-3.5 w-3.5" />
      </TBtn>

      <Divider />

      <TBtn title={i18n.t("blocks.toolbar.clear")} onClick={() => set({ text: "" })}>
        <Trash2 className="h-3.5 w-3.5" />
      </TBtn>
    </div>
  );
}
