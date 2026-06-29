import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Pencil, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  value: string | null | undefined;
  onSave: (next: string) => Promise<void> | void;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
  inputClassName?: string;
  maxLength?: number;
  emptyLabel?: string;
  /** Visual variant for the read state */
  variant?: "title" | "subtitle" | "muted" | "plain";
}

/**
 * Click-to-edit single line. Enter / blur = save, Esc = cancel.
 * Hover reveals a subtle pencil. No save button shown by default — autosave on blur.
 */
export function InlineText({
  value,
  onSave,
  placeholder,
  ariaLabel,
  className,
  inputClassName,
  maxLength = 200,
  emptyLabel,
  variant = "plain",
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
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

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  const variantCls =
    variant === "title"
      ? "text-xl sm:text-2xl font-semibold tracking-tight leading-tight"
      : variant === "subtitle"
        ? "text-sm sm:text-base text-foreground/85"
        : variant === "muted"
          ? "text-xs sm:text-sm text-muted-foreground"
          : "text-sm";

  if (editing) {
    return (
      <div className={cn("flex items-center gap-1.5", className)}>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={onKey}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-label={ariaLabel}
          disabled={busy}
          className={cn(
            "w-full min-w-0 rounded-[6px] border border-primary/50 bg-background px-2 py-1 outline-none ring-2 ring-primary/20 focus:ring-primary/40",
            variantCls,
            inputClassName,
          )}
        />
        <button
          type="button"
          aria-label="Save"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void commit()}
          className="shrink-0 rounded-[6px] p-1 text-primary hover:bg-primary/10"
        >
          <Check className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Cancel"
          onMouseDown={(e) => e.preventDefault()}
          onClick={cancel}
          className="shrink-0 rounded-[6px] p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
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
        "group inline-flex max-w-full items-center gap-1.5 rounded-[6px] px-1 -mx-1 py-0.5 text-left transition-colors hover:bg-foreground/5 focus:outline-none focus:ring-2 focus:ring-primary/40",
        className,
      )}
    >
      <span
        className={cn(
          "min-w-0",
          variant === "title" ? "break-words" : "truncate",
          variantCls,
          isEmpty && "italic text-muted-foreground/70",
        )}
      >
        {isEmpty ? emptyLabel ?? placeholder ?? "" : display}
      </span>
      <Pencil className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" aria-hidden />
    </button>
  );
}
