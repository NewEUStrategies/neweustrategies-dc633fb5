// Molecule: inline-editable text node. Plain text by default; pass `html` for rich content.
// Used by the canvas editor for click-to-edit content.
//
// Rich mode (`html`) exposes a lightweight floating toolbar with Bold / Italic /
// Underline / Link commands and reacts to native keyboard shortcuts
// (Cmd/Ctrl+B, +I, +U, +K). Enter inserts a real newline in multiline mode;
// Shift+Enter always inserts a soft break. The final HTML is sanitized on
// commit, so unsafe markup produced by execCommand can never persist.
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { sanitizeHtml } from "@/lib/sanitize";

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
  const ref = useRef<HTMLElement>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el) return;
    if (html) {
      if (el.innerHTML !== value) el.innerHTML = value;
    } else if (el.textContent !== value) {
      el.textContent = value;
    }
  }, [value, html]);

  const commit = () => {
    const el = ref.current;
    if (!el) return;
    const next = html ? sanitizeHtml(el.innerHTML) : (el.textContent ?? "");
    if (next !== value) onCommit(next);
  };

  const runCommand = (cmd: ExecCommand, value?: string) => {
    ref.current?.focus();
    exec(cmd, value);
    // Reflect the change immediately in the stored value so parents can
    // observe the update without waiting for blur.
    queueMicrotask(commit);
  };

  const promptLink = () => {
    const url = window.prompt("Adres URL (https://...)", "https://");
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
      if (el) {
        if (html) el.innerHTML = value;
        else el.textContent = value;
      }
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
    if (html && multiline && e.key === "Enter" && e.shiftKey) {
      // Force a soft <br> instead of a new paragraph block.
      e.preventDefault();
      document.execCommand("insertLineBreak");
      queueMicrotask(commit);
    }
  };

  const stop = (e: ReactMouseEvent | MouseEvent) => e.stopPropagation();

  const showToolbar = html && multiline;
  const editableEl = (
    <As
      ref={ref as never}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      data-placeholder={placeholder}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onFocus={() => setFocused(true)}
      onKeyDown={onKeyDown}
      onClick={stop}
      onMouseDown={stop}
      className={`${className ?? ""} outline-none focus:ring-2 focus:ring-brand/40 focus:rounded empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/50`}
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
          aria-label="Formatowanie tekstu"
          contentEditable={false}
          onMouseDown={(e) => {
            // Prevent blur of the editable when clicking a button.
            e.preventDefault();
            e.stopPropagation();
          }}
          className="absolute -top-9 left-0 z-40 flex items-center gap-0.5 rounded-md border border-border bg-background/95 px-1 py-0.5 text-xs shadow-md backdrop-blur"
        >
          <FmtBtn label="B" title="Pogrubienie (⌘/Ctrl+B)" onClick={() => runCommand("bold")} bold />
          <FmtBtn
            label="I"
            title="Kursywa (⌘/Ctrl+I)"
            onClick={() => runCommand("italic")}
            italic
          />
          <FmtBtn
            label="U"
            title="Podkreślenie (⌘/Ctrl+U)"
            onClick={() => runCommand("underline")}
            underline
          />
          <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
          <FmtBtn label="•" title="Lista punktowana" onClick={() => runCommand("insertUnorderedList")} />
          <FmtBtn label="1." title="Lista numerowana" onClick={() => runCommand("insertOrderedList")} />
          <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
          <FmtBtn label="🔗" title="Wstaw link (⌘/Ctrl+K)" onClick={promptLink} />
          <FmtBtn label="⌫" title="Usuń link" onClick={() => runCommand("unlink")} />
          <FmtBtn
            label="Tx"
            title="Wyczyść formatowanie (⌘/Ctrl+\\)"
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
