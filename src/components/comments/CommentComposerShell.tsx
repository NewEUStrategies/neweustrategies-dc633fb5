// Molekuła: powłoka kompozytora komentarza - karta z paskiem formatowania
// (markdown), polem treści (slot) i dolnym paskiem akcji z licznikiem znaków.
//
// Formatowanie działa na tej samej textarei, którą renderuje MentionTextarea
// (dostęp przez `textareaRef`), więc podpowiedzi @wzmianek pozostają aktywne.
// Wszystkie napisy pochodzą z i18n (PL/EN), zaokrąglenia = 6px.
import { useTranslation } from "react-i18next";
import type { MutableRefObject, ReactNode } from "react";
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

type MarkdownAction =
  | { kind: "wrap"; before: string; after: string }
  | { kind: "prefix"; prefix: string | ((index: number) => string) };

interface ToolbarItem {
  id: string;
  icon: LucideIcon;
  labelKey: string;
  action: MarkdownAction;
}

const TOOLBAR: readonly ToolbarItem[] = [
  { id: "bold", icon: Bold, labelKey: "comments.toolbar.bold", action: { kind: "wrap", before: "**", after: "**" } },
  { id: "italic", icon: Italic, labelKey: "comments.toolbar.italic", action: { kind: "wrap", before: "_", after: "_" } },
  { id: "bulletList", icon: List, labelKey: "comments.toolbar.bulletList", action: { kind: "prefix", prefix: "- " } },
  {
    id: "numberedList",
    icon: ListOrdered,
    labelKey: "comments.toolbar.numberedList",
    action: { kind: "prefix", prefix: (i: number) => `${i + 1}. ` },
  },
  { id: "quote", icon: Quote, labelKey: "comments.toolbar.quote", action: { kind: "prefix", prefix: "> " } },
  { id: "code", icon: Code, labelKey: "comments.toolbar.code", action: { kind: "wrap", before: "`", after: "`" } },
  { id: "link", icon: LinkIcon, labelKey: "comments.toolbar.link", action: { kind: "wrap", before: "[", after: "](https://)" } },
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
    .map((line, i) => `${typeof action.prefix === "function" ? action.prefix(i) : action.prefix}${line}`)
    .join("\n");
  const next = `${value.slice(0, start)}${prefixed}${value.slice(end)}`;
  return { value: next, caret: start + prefixed.length };
}

export interface CommentComposerShellProps {
  value: string;
  onValueChange: (next: string) => void;
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>;
  maxLength: number;
  /** Pole treści (MentionTextarea) i ewentualne dodatkowe pola. */
  children: ReactNode;
  /** Akcje po prawej stronie dolnego paska (submit / anuluj). */
  actions: ReactNode;
  className?: string;
}

export function CommentComposerShell({
  value,
  onValueChange,
  textareaRef,
  maxLength,
  children,
  actions,
  className,
}: CommentComposerShellProps) {
  const { t } = useTranslation();

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
        "overflow-hidden rounded-[6px] border border-border bg-card transition-colors focus-within:border-ring/60",
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

      <div className="space-y-3 p-3">{children}</div>

      <div className="flex items-center justify-between gap-2 border-t border-border/70 px-3 py-2">
        <span className="text-xs tabular-nums text-muted-foreground">
          {value.length}/{maxLength}
        </span>
        <div className="flex items-center gap-2">{actions}</div>
      </div>
    </div>
  );
}


