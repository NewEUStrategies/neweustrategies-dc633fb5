import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Pencil, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  value: string | null | undefined;
  onSave: (next: string) => Promise<void> | void;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
  maxLength?: number;
  rows?: number;
  emptyLabel?: string;
}

/**
 * Click-to-edit multi-line. Ctrl/Cmd+Enter or blur = save, Esc = cancel.
 */
export function InlineTextarea({
  value,
  onSave,
  placeholder,
  ariaLabel,
  className,
  maxLength = 1000,
  rows = 4,
  emptyLabel,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);

  useEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.setSelectionRange(ref.current.value.length, ref.current.value.length);
    }
  }, [editing]);

  const commit = async () => {
    const next = draft.trim();
    if (next === (value ?? "").trim()) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await onSave(next);
    } finally {
      setBusy(false);
      setEditing(false);
    }
  };

  const cancel = () => {
    setDraft(value ?? "");
    setEditing(false);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void commit();
    }
  };

  if (editing) {
    return (
      <div className={cn("grid gap-2", className)}>
        <textarea
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          maxLength={maxLength}
          rows={rows}
          placeholder={placeholder}
          aria-label={ariaLabel}
          disabled={busy}
          className="w-full resize-y rounded-[6px] border border-primary/50 bg-background px-3 py-2 text-sm leading-relaxed outline-none ring-2 ring-primary/20 focus:ring-primary/40"
        />
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={cancel}
            className="inline-flex items-center gap-1 rounded-[6px] border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            <X className="h-3.5 w-3.5" /> Esc
          </button>
          <button
            type="button"
            onClick={() => void commit()}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-[6px] bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            <Check className="h-3.5 w-3.5" /> ⌘⏎
          </button>
        </div>
      </div>
    );
  }

  const display = (value ?? "").trim();
  const isEmpty = display.length === 0;
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label={ariaLabel}
      className={cn(
        "group block w-full rounded-[6px] px-2 -mx-2 py-1 text-left transition-colors hover:bg-foreground/5 focus:outline-none focus:ring-2 focus:ring-primary/40",
        className,
      )}
    >
      <div
        className={cn(
          "relative whitespace-pre-wrap text-sm leading-relaxed text-foreground/90",
          isEmpty && "italic text-muted-foreground/70",
        )}
      >
        {isEmpty ? (emptyLabel ?? placeholder ?? "") : display}
        <Pencil
          className="absolute right-0 top-0 h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-60"
          aria-hidden
        />
      </div>
    </button>
  );
}
