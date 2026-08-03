// Molekuła: uniwersalna powłoka kompozytora tekstu - karta z paskiem
// formatowania (markdown), slotem pola treści i dolnym paskiem z licznikiem
// znaków oraz opcjonalnymi akcjami.
//
// Używana przez kompozytor komentarzy oraz pola "wiadomość" w widgetach
// formularzy (bez załączników). Wszystkie napisy pochodzą z i18n (PL/EN),
// zaokrąglenia = 6px, kolory wyłącznie z tokenów semantycznych.
import { useTranslation } from "react-i18next";
import { useEffect, useRef, type MutableRefObject, type ReactNode } from "react";
import {
  Bold,
  Code,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  composerStatusMessageKey,
  validateComposerValue,
  type ComposerValidation,
} from "@/lib/composer/validation";

export type MarkdownAction =
  | { kind: "wrap"; before: string; after: string }
  | { kind: "prefix"; prefix: string | ((index: number) => string) };

interface ToolbarItem {
  id: string;
  icon: LucideIcon;
  labelKey: string;
  action: MarkdownAction;
}

const TOOLBAR: readonly ToolbarItem[] = [
  {
    id: "bold",
    icon: Bold,
    labelKey: "comments.toolbar.bold",
    action: { kind: "wrap", before: "**", after: "**" },
  },
  {
    id: "italic",
    icon: Italic,
    labelKey: "comments.toolbar.italic",
    action: { kind: "wrap", before: "_", after: "_" },
  },
  {
    id: "bulletList",
    icon: List,
    labelKey: "comments.toolbar.bulletList",
    action: { kind: "prefix", prefix: "- " },
  },
  {
    id: "numberedList",
    icon: ListOrdered,
    labelKey: "comments.toolbar.numberedList",
    action: { kind: "prefix", prefix: (i: number) => `${i + 1}. ` },
  },
  {
    id: "quote",
    icon: Quote,
    labelKey: "comments.toolbar.quote",
    action: { kind: "prefix", prefix: "> " },
  },
  {
    id: "code",
    icon: Code,
    labelKey: "comments.toolbar.code",
    action: { kind: "wrap", before: "`", after: "`" },
  },
  {
    id: "link",
    icon: LinkIcon,
    labelKey: "comments.toolbar.link",
    action: { kind: "wrap", before: "[", after: "](https://)" },
  },
];

/** Czysta funkcja: aplikuje akcję markdown do zaznaczenia. */
export function applyMarkdown(
  value: string,
  start: number,
  end: number,
  action: MarkdownAction,
): { value: string; caret: number } {
  const selected = value.slice(start, end);
  if (action.kind === "wrap") {
    const next = `${value.slice(0, start)}${action.before}${selected}${action.after}${value.slice(end)}`;
    return { value: next, caret: start + action.before.length + selected.length };
  }
  const lines = (selected || "").split("\n");
  const prefixed = lines
    .map(
      (line, i) =>
        `${typeof action.prefix === "function" ? action.prefix(i) : action.prefix}${line}`,
    )
    .join("\n");
  const next = `${value.slice(0, start)}${prefixed}${value.slice(end)}`;
  return { value: next, caret: start + prefixed.length };
}

export interface ComposerShellProps {
  value: string;
  onValueChange: (next: string) => void;
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>;
  maxLength: number;
  /** Pole treści i ewentualne dodatkowe pola. */
  children: ReactNode;
  /**
   * Akcje po prawej stronie dolnego paska (submit / anuluj). Wariant funkcyjny
   * dostaje wynik walidacji - jedno źródło prawdy dla `disabled` przycisku.
   */
  actions?: ReactNode | ((validation: ComposerValidation) => ReactNode);
  /** Minimalna długość treści po trim (domyślnie 1). */
  minLength?: number;
  /** Trwa wysyłka - blokuje submit. */
  submitting?: boolean;
  /** Tryb edycji: brak zmian względem wartości początkowej blokuje submit. */
  initialValue?: string;
  /** Powiadomienie o zmianie walidacji (dla formularzy z własnym submitem). */
  onValidationChange?: (validation: ComposerValidation) => void;
  /** Id komunikatu walidacji (do aria-describedby pola treści). */
  statusId?: string;
  className?: string;
  /** Padding wokół slotu treści (domyślnie karta komentarza). */
  bodyClassName?: string;
}

export function ComposerShell({
  value,
  onValueChange,
  textareaRef,
  maxLength,
  children,
  actions,
  className,
  bodyClassName,
  minLength = 1,
  submitting = false,
  initialValue,
  onValidationChange,
  statusId,
}: ComposerShellProps) {
  const { t } = useTranslation();
  const validation = validateComposerValue({
    value,
    maxLength,
    minLength,
    submitting,
    initialValue,
  });
  const lastReported = useRef<string>("");
  useEffect(() => {
    if (!onValidationChange) return;
    const key = `${validation.status}:${validation.canSubmit}`;
    if (lastReported.current === key) return;
    lastReported.current = key;
    onValidationChange(validation);
  }, [onValidationChange, validation]);

  const messageKey = composerStatusMessageKey(validation.status);
  const message = messageKey
    ? t(messageKey, {
        count: validation.status === "tooLong" ? maxLength : minLength,
        defaultValue:
          validation.status === "tooLong"
            ? `Maksymalnie ${maxLength} znaków.`
            : `Minimum ${minLength} znaków.`,
      })
    : null;

  const run = (action: MarkdownAction) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = applyMarkdown(value, start, end, action);
    if (next.value.length > maxLength) return;
    onValueChange(next.value);
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(next.caret, next.caret);
    });
  };

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[6px] border border-border bg-transparent transition-colors focus-within:border-ring/60",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-1 border-b border-border/70 px-2 py-1.5">
        <div className="flex flex-wrap items-center gap-0.5">
          {TOOLBAR.map((item) => {
            const label = t(item.labelKey);
            return (
              <Tooltip key={item.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => run(item.action)}
                    aria-label={label}
                    className="flex h-8 w-8 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <item.icon className="h-4 w-4" aria-hidden />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onValueChange("")}
              disabled={value.length === 0}
              aria-label={t("comments.toolbar.clear")}
              className="flex h-8 w-8 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("comments.toolbar.clear")}</TooltipContent>
        </Tooltip>
      </div>

      <div className={cn("space-y-3 p-3", bodyClassName)}>{children}</div>

      <div className="flex items-center justify-between gap-2 border-t border-border/70 px-3 py-2">
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "text-xs tabular-nums",
              validation.isTooLong ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {value.length}/{maxLength}
          </span>
          <span
            id={statusId}
            role="status"
            aria-live="polite"
            className="truncate text-xs text-destructive"
          >
            {message}
          </span>
        </span>
        {actions ? (
          <div className="flex items-center gap-2">
            {typeof actions === "function" ? actions(validation) : actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
