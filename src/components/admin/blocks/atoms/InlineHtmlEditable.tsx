// Jednopolowy edytor treści inline (contentEditable), który renderuje
// bezpieczny HTML zamiast pokazywać surowe znaczniki (<strong> itp.) i zawija
// tekst zamiast go ucinać - w przeciwieństwie do <input type="text">.
import { useEffect, useRef, type KeyboardEvent } from "react";
import { sanitizeHtml } from "@/lib/sanitize";

interface Props {
  value: string;
  placeholder?: string;
  className?: string;
  onChange: (nextHtml: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  editableRef?: (el: HTMLDivElement | null) => void;
  "data-field"?: string;
}

export function InlineHtmlEditable({
  value,
  placeholder,
  className,
  onChange,
  onKeyDown,
  editableRef,
  ...rest
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const lastEmitted = useRef<string>("");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Nie nadpisujemy DOM podczas pisania (utrata karetki) - tylko gdy wartość
    // zmieniła się z zewnątrz.
    if (value === lastEmitted.current) return;
    const safe = sanitizeHtml(value);
    if (el.innerHTML !== safe) el.innerHTML = safe;
  }, [value]);

  return (
    <div
      ref={(el) => {
        ref.current = el;
        editableRef?.(el);
      }}
      role="textbox"
      tabIndex={0}
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      className={`min-w-0 max-w-full break-words whitespace-pre-wrap outline-none focus:ring-0 empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground ${className ?? ""}`}
      onInput={(e) => {
        const html = (e.currentTarget as HTMLDivElement).innerHTML;
        lastEmitted.current = html;
        onChange(html);
      }}
      onPaste={(e) => {
        // Wklejamy oczyszczony HTML (pogrubienia z Worda zostają jako <strong>,
        // a nie jako widoczny tekst ze znacznikami).
        e.preventDefault();
        const html = e.clipboardData.getData("text/html");
        const text = e.clipboardData.getData("text/plain");
        const safe = html ? sanitizeHtml(html) : text.replace(/[<>&]/g, "");
        document.execCommand("insertHTML", false, safe);
      }}
      onKeyDown={onKeyDown}
      {...rest}
    />
  );
}
