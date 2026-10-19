// Molecule: inline-editable text node. Plain text by default; pass `html` for rich content.
// Used by the canvas editor for click-to-edit content.
//
// Rich mode (`html`) exposes a lightweight floating toolbar with Bold / Italic /
// Underline / Link commands and reacts to native keyboard shortcuts
// (Cmd/Ctrl+B, +I, +U, +K). Enter inserts a real newline in multiline mode;
// Shift+Enter always inserts a soft break. HTML is sanitized on BOTH sides:
// the stored value before it is written into the canvas DOM (it comes from the
// database, e.g. a WordPress import) and the final HTML on commit, so unsafe
// markup produced by execCommand can never persist.
//
// A commit happens only for a real edit: the baseline is the field content as
// it was written into the DOM (same normalisation + sanitizer), so focus/blur
// over a non-canonical stored value is not a change, and Escape cancels the
// edit without any commit. The field is announced as `role="textbox"` with an
// accessible name (the `title` hint disappears on focus, so it cannot be one).
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { sanitizeHtml } from "@/lib/sanitize";
import { normalizeBuilderRichHtmlDom } from "@/lib/builder/normalizeRichHtmlDom";
// i18n-overlay-imports: pomijamy @/lib/i18n-builder (waga chunka - powód niżej)
// BEZ side-effectowego `import "@/lib/i18n-builder"` - ta sama zasada, co w
// `widget-view/resizeWrappers.tsx`. Moduł leży w EAGER-owej ścieżce publicznego
// chrome (WidgetView <- BuilderRenderer <- Header/Footer), a słownik buildera
// waży ~101 KB źródła. Dopóki ten import tu był, każdy anonimowy czytelnik
// pobierał w chunku wejściowym komplet ciągów edytora, których nigdy nie
// zobaczy: `Editable` renderuje się WYŁĄCZNIE przy `canEdit = editable &&
// onContentChange` (WidgetView.tsx), czyli w kanwie buildera - a chunk kanwy
// (Toolbar, WidgetProperties, Navigator, WidgetLibrary) rejestruje ten słownik
// przy inicjalizacji modułu, zanim cokolwiek się wyrenderuje.

interface Props {
  as?: ElementType;
  value: string;
  onCommit: (next: string) => void;
  className?: string;
  style?: CSSProperties;
  html?: boolean;
  multiline?: boolean;
  placeholder?: string;
}

type ExecCommand =
  | "bold"
  | "italic"
  | "underline"
  | "createLink"
  | "unlink"
  | "removeFormat"
  | "insertUnorderedList"
  | "insertOrderedList";

function exec(cmd: ExecCommand, value?: string) {
  try {
    // execCommand is deprecated but remains the only cross-browser way to run
    // contenteditable formatting; every modern browser still supports the
    // subset we use.
    document.execCommand(cmd, false, value);
  } catch {
    /* noop */
  }
}

/** Treść pola w postaci, którą oddaje `onCommit` (tryb bogaty: normalizacja list + sanitizer). */
function readField(el: HTMLElement, html: boolean): string {
  return html ? sanitizeHtml(normalizeBuilderRichHtmlDom(el.innerHTML)) : (el.textContent ?? "");
}

/**
 * Wpisuje wartość z bazy do pola i zwraca jego treść w postaci zapisu (bazę
 * porównania dla `commit`). W trybie bogatym DOM kanwy dostaje wartość PO
 * sanitizerze - treść z `builder_data` (import WordPressa, ręczna edycja wiersza)
 * nie może wykonać się w sesji redaktora. Ta sama postać nie jest przypisywana
 * ponownie: przypisanie `innerHTML` niszczy węzły, a z nimi karetkę.
 */
function writeField(el: HTMLElement, value: string, html: boolean): string {
  if (html) {
    const safe = sanitizeHtml(normalizeBuilderRichHtmlDom(value));
    if (el.innerHTML !== safe) el.innerHTML = safe;
  } else if (el.textContent !== value) {
    el.textContent = value;
  }
  return readField(el, html);
}

export function Editable({
  as: As = "span",
  value,
  onCommit,
  className,
  style,
  html = false,
  multiline = false,
  placeholder,
}: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  const [focused, setFocused] = useState(false);
  /** Treść pola w postaci zapisu (ta sama droga co `commit`) od ostatniej synchronizacji albo zapisu. */
  const baselineRef = useRef<string | null>(null);
  /** Escape: najbliższy blur kończy edycję BEZ zapisu. */
  const cancelledRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el) return;
    baselineRef.current = writeField(el, value, html);
  }, [value, html]);

  const commit = () => {
    const el = ref.current;
    if (!el) return;
    const next = readField(el, html);
    if (next === baselineRef.current || next === value) return;
    baselineRef.current = next;
    onCommit(next);
  };

  const runCommand = (cmd: ExecCommand, value?: string) => {
    ref.current?.focus();
    exec(cmd, value);
    // Reflect the change immediately in the stored value so parents can
    // observe the update without waiting for blur.
    queueMicrotask(commit);
  };

  const promptLink = () => {
    const url = window.prompt(t("builder.editable.urlPrompt"), "https://");
    if (!url) return;
    // Basic protocol allow-list; sanitizeHtml on commit will strip anything unsafe.
    if (!/^(https?:|mailto:|tel:|#|\/)/i.test(url)) return;
    runCommand("createLink", url);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" && !multiline && !e.shiftKey) {
      e.preventDefault();
      (e.target as HTMLElement).blur();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      const el = ref.current;
      if (el) baselineRef.current = writeField(el, value, html);
      cancelledRef.current = true;
      (e.target as HTMLElement).blur();
      return;
    }
    if (html && (e.metaKey || e.ctrlKey)) {
      const k = e.key.toLowerCase();
      if (k === "b") {
        e.preventDefault();
        runCommand("bold");
      } else if (k === "i") {
        e.preventDefault();
        runCommand("italic");
      } else if (k === "u") {
        e.preventDefault();
        runCommand("underline");
      } else if (k === "k") {
        e.preventDefault();
        promptLink();
      } else if (k === "\\" || (k === "m" && e.shiftKey)) {
        e.preventDefault();
        runCommand("removeFormat");
      }
    }
    if (multiline && e.key === "Enter") {
      // Force a soft <br> instead of a new paragraph/div block on every Enter
      // (Shift+Enter also works, but plain Enter should not spawn a new column).
      e.preventDefault();
      document.execCommand("insertLineBreak");
      queueMicrotask(commit);
    }
  };

  const stop = (e: ReactMouseEvent | MouseEvent) => e.stopPropagation();

  // Pasek należy do trybu bogatego jako takiego - skróty klawiszowe też
  // zależą wyłącznie od `html`.
  const showToolbar = html;
  const editableEl = (
    <As
      ref={ref as never}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      role="textbox"
      aria-multiline={multiline}
      aria-label={t("builder.editable.fieldLabel")}
      data-placeholder={placeholder}
      onBlur={() => {
        setFocused(false);
        if (cancelledRef.current) {
          cancelledRef.current = false;
          return;
        }
        commit();
      }}
      onFocus={() => {
        cancelledRef.current = false;
        setFocused(true);
      }}
      onKeyDown={onKeyDown}
      onClick={stop}
      onMouseDown={stop}
      // Affordance odkrywalności (Elementor/Webflow): kursor tekstowy +
      // delikatny ring na hoverze sygnalizują edytowalność ZANIM ktoś
      // kliknie - bez tego inline editing jest niewidoczny dla redaktora.
      title={focused ? undefined : t("builder.editable.clickToEdit")}
      className={`${className ?? ""} outline-none cursor-text hover:ring-1 hover:ring-brand/30 hover:rounded focus:ring-2 focus:ring-brand/40 focus:rounded empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/50`}
      style={style}
    />
  );

  if (!showToolbar) return editableEl;

  return (
    <span className="relative block w-full max-w-full">
      {editableEl}
      {focused && (
        <span
          role="toolbar"
          aria-label={t("builder.editable.toolbar")}
          contentEditable={false}
          onMouseDown={(e) => {
            // Prevent blur of the editable when clicking a button.
            e.preventDefault();
            e.stopPropagation();
          }}
          className="absolute -top-9 left-0 z-40 flex items-center gap-0.5 rounded-md border border-border bg-background/95 px-1 py-0.5 text-xs shadow-md backdrop-blur"
        >
          <FmtBtn
            label="B"
            title={t("builder.editable.bold")}
            onClick={() => runCommand("bold")}
            bold
          />
          <FmtBtn
            label="I"
            title={t("builder.editable.italic")}
            onClick={() => runCommand("italic")}
            italic
          />
          <FmtBtn
            label="U"
            title={t("builder.editable.underline")}
            onClick={() => runCommand("underline")}
            underline
          />
          <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
          <FmtBtn
            label="•"
            title={t("builder.editable.bulletList")}
            onClick={() => runCommand("insertUnorderedList")}
          />
          <FmtBtn
            label="1."
            title={t("builder.editable.orderedList")}
            onClick={() => runCommand("insertOrderedList")}
          />
          <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
          <FmtBtn label="🔗" title={t("builder.editable.insertLink")} onClick={promptLink} />
          <FmtBtn
            label="⌫"
            title={t("builder.editable.unlink")}
            onClick={() => runCommand("unlink")}
          />
          <FmtBtn
            label="Tx"
            title={t("builder.editable.clearFormat")}
            onClick={() => runCommand("removeFormat")}
          />
        </span>
      )}
    </span>
  );
}

function FmtBtn({
  label,
  title,
  onClick,
  bold,
  italic,
  underline,
}: {
  label: string;
  title: string;
  onClick: () => void;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`inline-flex h-6 min-w-6 items-center justify-center rounded px-1.5 text-[11px] leading-none text-foreground/80 hover:bg-accent hover:text-foreground ${bold ? "font-bold" : ""} ${italic ? "italic" : ""} ${underline ? "underline underline-offset-2" : ""}`}
    >
      {label}
    </button>
  );
}
