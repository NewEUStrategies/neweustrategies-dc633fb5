// Molecule: inline-editable text node. Plain text by default; pass `html` for rich content.
// Used by the canvas editor for click-to-edit content.
import { useEffect, useRef, type CSSProperties, type ElementType, type KeyboardEvent } from "react";
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
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" && !multiline && !e.shiftKey) {
      e.preventDefault();
      (e.target as HTMLElement).blur();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      const el = ref.current;
      if (el) {
        if (html) el.innerHTML = value;
        else el.textContent = value;
      }
      (e.target as HTMLElement).blur();
    }
  };
  return (
    <As
      ref={ref as never}
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onBlur={commit}
      onKeyDown={onKeyDown}
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
      onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
      className={`${className ?? ""} outline-none focus:ring-2 focus:ring-brand/40 focus:rounded empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/50`}
      style={style}
    />
  );
}
