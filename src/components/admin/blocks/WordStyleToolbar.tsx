// Word-style floating toolbar dla edytora akapitu (TipTap).
// Wszystkie napisy są lokalizowane (PL/EN) przez useBlocksI18n().
// Layout: dwie linie - wiersz formatowania znaków + wiersz akapitu/koloru/listy.
import { useState, useRef, useEffect } from "react";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code2,
  Link as LinkIcon,
  Link2Off,
  Heading1,
  Heading2,
  Heading3,
  Pilcrow,
  List,
  ListOrdered,
  Quote,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Highlighter,
  Palette,
  Eraser,
  Undo2,
  Redo2,
} from "lucide-react";
import { useBlocksI18n } from "@/lib/blocks/i18n";

interface Props { editor: Editor }

// Word-like swatch palette (CMYK-ish print safe primaries + neutrals).
const TEXT_COLORS = [
  "#111111", "#5b5b5b", "#9b9b9b", "#ffffff",
  "#c0392b", "#e67e22", "#f1c40f", "#27ae60",
  "#16a085", "#2980b9", "#8e44ad", "#d63384",
];
const HL_COLORS = [
  "#fff59d", "#ffe082", "#ffab91", "#f48fb1",
  "#ce93d8", "#90caf9", "#80cbc4", "#a5d6a7",
  "transparent",
];

function ToolbarBtn({
  onClick, active, title, children, disabled,
}: { onClick: () => void; active?: boolean; title: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      className={[
        "inline-flex h-7 w-7 items-center justify-center rounded-sm border border-transparent",
        "text-foreground/80 hover:bg-accent hover:text-foreground",
        "disabled:opacity-40 disabled:pointer-events-none transition-colors",
        active ? "bg-accent text-accent-foreground border-border" : "",
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

function ColorPopover({
  open, onClose, swatches, onPick, label,
}: {
  open: boolean; onClose: () => void; swatches: readonly string[];
  onPick: (c: string | null) => void; label: string;
}) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-label={label}
      className="absolute z-30 mt-1 grid w-[164px] grid-cols-6 gap-1 rounded-md border border-border bg-popover p-2 shadow-md"
      onMouseDown={(e) => e.preventDefault()}
    >
      {swatches.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => { onPick(c === "transparent" ? null : c); onClose(); }}
          className="h-5 w-5 rounded-sm border border-border/60 hover:scale-110 transition-transform"
          style={{
            background: c === "transparent"
              ? "linear-gradient(45deg, transparent 45%, hsl(var(--destructive)) 45%, hsl(var(--destructive)) 55%, transparent 55%)"
              : c,
          }}
          title={c}
          aria-label={c}
        />
      ))}
      <button
        type="button"
        onClick={() => { onPick(null); onClose(); }}
        className="col-span-6 mt-1 rounded-sm border border-border px-2 py-1 text-[11px] hover:bg-accent"
      >
        ⌫
      </button>
    </div>
  );
}

export function WordStyleToolbar({ editor }: Props) {
  const i18n = useBlocksI18n();
  const [colorOpen, setColorOpen] = useState(false);
  const [hlOpen, setHlOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close popovers on outside click.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
        setColorOpen(false); setHlOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const can = editor.can();
  const isHeading = (lvl: 1 | 2 | 3) => editor.isActive("heading", { level: lvl });
  const align = (a: "left" | "center" | "right" | "justify") =>
    editor.isActive({ textAlign: a });

  const promptLink = () => {
    const current = (editor.getAttributes("link").href as string | undefined) ?? "https://";
    const url = window.prompt("URL:", current);
    if (url === null) return;
    if (url === "") editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div
      ref={rootRef}
      className="absolute -top-[78px] left-0 z-20 flex flex-col gap-1 rounded-md border border-border bg-popover px-1.5 py-1.5 shadow-md"
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* Wiersz 1: znak + style */}
      <div className="flex items-center gap-0.5">
        <ToolbarBtn title={i18n.t("blocks.toolbar.undo", { defaultValue: "Cofnij" })}
          onClick={() => editor.chain().focus().undo().run()} disabled={!can.undo()}>
          <Undo2 className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title={i18n.t("blocks.toolbar.redo", { defaultValue: "Ponów" })}
          onClick={() => editor.chain().focus().redo().run()} disabled={!can.redo()}>
          <Redo2 className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <Divider />

        <ToolbarBtn title="Bold (⌘B)" active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title="Italic (⌘I)" active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title="Underline (⌘U)" active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title="Strikethrough" active={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}>
          <Strikethrough className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title="Subscript" active={editor.isActive("subscript")}
          onClick={() => editor.chain().focus().toggleSubscript().run()}>
          <SubscriptIcon className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title="Superscript" active={editor.isActive("superscript")}
          onClick={() => editor.chain().focus().toggleSuperscript().run()}>
          <SuperscriptIcon className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title="Code" active={editor.isActive("code")}
          onClick={() => editor.chain().focus().toggleCode().run()}>
          <Code2 className="h-3.5 w-3.5" />
        </ToolbarBtn>

        <Divider />

        {/* Text color */}
        <div className="relative flex items-center">
          <ToolbarBtn title={i18n.t("blocks.toolbar.textColor", { defaultValue: "Kolor tekstu" })}
            active={colorOpen}
            onClick={() => { setColorOpen((v) => !v); setHlOpen(false); }}>
            <Palette className="h-3.5 w-3.5" />
          </ToolbarBtn>
          <ColorPopover
            open={colorOpen}
            onClose={() => setColorOpen(false)}
            swatches={TEXT_COLORS}
            label={i18n.t("blocks.toolbar.textColor", { defaultValue: "Kolor tekstu" })}
            onPick={(c) => {
              if (c) editor.chain().focus().setColor(c).run();
              else editor.chain().focus().unsetColor().run();
            }}
          />
        </div>

        {/* Highlight */}
        <div className="relative flex items-center">
          <ToolbarBtn title={i18n.t("blocks.toolbar.highlight", { defaultValue: "Zakreślacz" })}
            active={editor.isActive("highlight") || hlOpen}
            onClick={() => { setHlOpen((v) => !v); setColorOpen(false); }}>
            <Highlighter className="h-3.5 w-3.5" />
          </ToolbarBtn>
          <ColorPopover
            open={hlOpen}
            onClose={() => setHlOpen(false)}
            swatches={HL_COLORS}
            label={i18n.t("blocks.toolbar.highlight", { defaultValue: "Zakreślacz" })}
            onPick={(c) => {
              if (c) editor.chain().focus().toggleHighlight({ color: c }).run();
              else editor.chain().focus().unsetHighlight().run();
            }}
          />
        </div>

        <Divider />

        <ToolbarBtn title={i18n.t("blocks.toolbar.clearFormatting", { defaultValue: "Wyczyść formatowanie" })}
          onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>
          <Eraser className="h-3.5 w-3.5" />
        </ToolbarBtn>

        <Divider />

        <ToolbarBtn title="Link (⌘K)" active={editor.isActive("link")} onClick={promptLink}>
          <LinkIcon className="h-3.5 w-3.5" />
        </ToolbarBtn>
        {editor.isActive("link") && (
          <ToolbarBtn title={i18n.t("blocks.toolbar.unlink", { defaultValue: "Usuń link" })}
            onClick={() => editor.chain().focus().extendMarkRange("link").unsetLink().run()}>
            <Link2Off className="h-3.5 w-3.5" />
          </ToolbarBtn>
        )}
      </div>

      {/* Wiersz 2: akapit + wyrównanie + listy */}
      <div className="flex items-center gap-0.5">
        <ToolbarBtn title={i18n.t("blocks.toolbar.paragraph", { defaultValue: "Akapit" })}
          active={editor.isActive("paragraph") && !isHeading(1) && !isHeading(2) && !isHeading(3)}
          onClick={() => editor.chain().focus().setParagraph().run()}>
          <Pilcrow className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title="H1" active={isHeading(1)}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
          <Heading1 className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title="H2" active={isHeading(2)}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title="H3" active={isHeading(3)}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          <Heading3 className="h-3.5 w-3.5" />
        </ToolbarBtn>

        <Divider />

        <ToolbarBtn title={i18n.t("blocks.toolbar.alignLeft", { defaultValue: "Do lewej" })} active={align("left")}
          onClick={() => editor.chain().focus().setTextAlign("left").run()}>
          <AlignLeft className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title={i18n.t("blocks.toolbar.alignCenter", { defaultValue: "Środek" })} active={align("center")}
          onClick={() => editor.chain().focus().setTextAlign("center").run()}>
          <AlignCenter className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title={i18n.t("blocks.toolbar.alignRight", { defaultValue: "Do prawej" })} active={align("right")}
          onClick={() => editor.chain().focus().setTextAlign("right").run()}>
          <AlignRight className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title={i18n.t("blocks.toolbar.alignJustify", { defaultValue: "Wyjustuj" })} active={align("justify")}
          onClick={() => editor.chain().focus().setTextAlign("justify").run()}>
          <AlignJustify className="h-3.5 w-3.5" />
        </ToolbarBtn>

        <Divider />

        <ToolbarBtn title={i18n.t("blocks.toolbar.bulletList", { defaultValue: "Lista punktowa" })} active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title={i18n.t("blocks.toolbar.orderedList", { defaultValue: "Lista numerowana" })} active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title={i18n.t("blocks.toolbar.blockquote", { defaultValue: "Cytat" })} active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <Quote className="h-3.5 w-3.5" />
        </ToolbarBtn>
      </div>
    </div>
  );
}
