// Molecule: lekki WYSIWYG dla pól `i18nHtml` w builderze.
// Odpowiada zachowaniu edytora tekstu w Elementorze - toolbar (B/I/U, H2/H3,
// listy punktowane i numerowane, cytat, link) operujący na contentEditable.
// Wartością pola pozostaje HTML string - żadnej zmiany w schemacie/renderze.
import { useEffect, useRef } from "react";
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Quote,
  Link as LinkIcon,
  Link2Off,
  Heading2,
  Heading3,
  Eraser,
  Undo2,
  Redo2,
} from "lucide-react";
import { normalizeBuilderRichHtml } from "@/lib/builder/normalizeRichHtml";

interface Props {
  value: string;
  onChange: (html: string) => void;
  rows?: number;
  ariaLabel?: string;
}

interface ToolbarBtn {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  run: () => void;
}

function exec(cmd: string, arg?: string) {
  // execCommand jest deprecated formalnie, ale to nadal jedyne API działające
  // spójnie w contentEditable we wszystkich silnikach - jak w Elementorze/TinyMCE.
  document.execCommand(cmd, false, arg);
}

export function RichHtmlField({ value, onChange, rows = 4, ariaLabel }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string>(value);

  // Zsynchronizuj DOM tylko wtedy, gdy wartość przyszła z zewnątrz (np. zmiana
  // języka / undo storu), inaczej gubimy pozycję karetki przy każdym wpisie.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el) return;
    const normalized = normalizeBuilderRichHtml(value ?? "");
    if (normalized !== el.innerHTML) {
      el.innerHTML = normalized;
      lastEmitted.current = normalized;
    }
  }, [value]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const html = normalizeBuilderRichHtml(el.innerHTML);
    if (html !== el.innerHTML) el.innerHTML = html;
    lastEmitted.current = html;
    onChange(html);
  };

  const wrap = (fn: () => void) => () => {
    ref.current?.focus();
    fn();
    // execCommand nie zawsze triggeruje input - domykamy synchronizację.
    setTimeout(emit, 0);
  };

  const insertLink = () => {
    const url = window.prompt("Adres URL", "https://");
    if (!url) return;
    exec("createLink", url);
  };

  const buttons: ReadonlyArray<ToolbarBtn | "sep"> = [
    { icon: Bold, title: "Pogrubienie (⌘/Ctrl+B)", run: () => exec("bold") },
    { icon: Italic, title: "Kursywa (⌘/Ctrl+I)", run: () => exec("italic") },
    { icon: Underline, title: "Podkreślenie (⌘/Ctrl+U)", run: () => exec("underline") },
    "sep",
    { icon: Heading2, title: "Nagłówek H2", run: () => exec("formatBlock", "H2") },
    { icon: Heading3, title: "Nagłówek H3", run: () => exec("formatBlock", "H3") },
    { icon: Quote, title: "Cytat", run: () => exec("formatBlock", "BLOCKQUOTE") },
    "sep",
    { icon: List, title: "Lista punktowana", run: () => exec("insertUnorderedList") },
    { icon: ListOrdered, title: "Lista numerowana", run: () => exec("insertOrderedList") },
    "sep",
    { icon: LinkIcon, title: "Wstaw link", run: insertLink },
    { icon: Link2Off, title: "Usuń link", run: () => exec("unlink") },
    "sep",
    { icon: Eraser, title: "Wyczyść formatowanie", run: () => exec("removeFormat") },
    "sep",
    { icon: Undo2, title: "Cofnij", run: () => exec("undo") },
    { icon: Redo2, title: "Ponów", run: () => exec("redo") },
  ];

  const minHeight = Math.max(rows, 3) * 20 + 16;

  return (
    <div className="rounded-md border border-border bg-background">
      <div
        className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/40 px-1 py-1"
        role="toolbar"
        aria-label="Formatowanie tekstu"
      >
        {buttons.map((b, i) =>
          b === "sep" ? (
            <span key={i} className="mx-0.5 h-4 w-px bg-border" aria-hidden />
          ) : (
            <button
              key={i}
              type="button"
              title={b.title}
              aria-label={b.title}
              onMouseDown={(e) => e.preventDefault()}
              onClick={wrap(b.run)}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <b.icon className="h-3.5 w-3.5" />
            </button>
          ),
        )}
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        onInput={emit}
        onBlur={emit}
        onPaste={(e) => {
          // Paste jako plain text - blokuje wklejenie stylów z Worda/Notion.
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain");
          exec("insertText", text);
        }}
        className="cms-richhtml-field cms-elementor-richtext prose prose-sm dark:prose-invert max-w-none px-2 py-2 text-xs leading-relaxed focus:outline-none [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2 [&_blockquote]:italic [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-xs [&_h3]:font-semibold [&_a]:text-brand [&_a]:underline"
        style={{ minHeight }}
      />
    </div>
  );
}
