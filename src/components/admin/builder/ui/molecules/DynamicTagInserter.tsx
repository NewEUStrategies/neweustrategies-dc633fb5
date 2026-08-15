// Dynamic-tag picker. A tiny popover trigger the author can drop next to any
// text field so tokens like `{post.title}` are inserted without having to
// remember the syntax. Delivers on the atomic-design layer as a molecule -
// wraps shadcn `Popover` primitives + shared `DYNAMIC_TAG_GROUPS` catalog.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Wand2 } from "@/lib/lucide-shim";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DYNAMIC_TAG_GROUPS } from "@/lib/builder/dynamicText";
import { useBuilderLabel } from "@/lib/builder/labelsEn";
import "@/lib/i18n-builder";

interface Props {
  /** Called with the token (already wrapped in `{...}`) when a user picks one. */
  onInsert: (token: string) => void;
  /** Optional aria-label override; defaults to the i18n-provided value. */
  label?: string;
  /** Compact = h-8 square trigger, matches other builder inline buttons. */
  compact?: boolean;
}

export function DynamicTagInserter({ onInsert, label, compact = true }: Props) {
  const { t, i18n } = useTranslation();
  const bl = useBuilderLabel();
  const [open, setOpen] = useState(false);
  const lang = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";
  const triggerLabel = label ?? t("builder.dynamicTag.trigger");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={triggerLabel}
          title={triggerLabel}
          className={`${
            compact ? "h-8 w-8" : "h-9 w-9"
          } shrink-0 inline-flex items-center justify-center rounded border border-border bg-background text-muted-foreground hover:text-foreground hover:border-brand/60 transition-colors`}
        >
          <Wand2 className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0 max-h-[320px] overflow-auto">
        <div className="px-3 py-2 border-b border-border">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("builder.dynamicTag.title")}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {t("builder.dynamicTag.hint")}
          </div>
        </div>
        <div className="py-1">
          {DYNAMIC_TAG_GROUPS.map((group) => (
            <div key={group.id} className="px-1 py-1">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                {lang === "en" ? group.labelEn : group.labelPl}
              </div>
              <ul className="space-y-0.5">
                {group.tags.map((tag) => (
                  <li key={tag.token}>
                    <button
                      type="button"
                      onClick={() => {
                        onInsert(tag.token);
                        setOpen(false);
                      }}
                      className="w-full flex items-center justify-between gap-2 px-2 py-1 text-left rounded hover:bg-accent/60 focus:bg-accent/60 outline-none"
                    >
                      <span className="text-xs text-foreground truncate">{bl(tag.label)}</span>
                      <code className="text-[10px] font-mono text-muted-foreground shrink-0">
                        {tag.token}
                      </code>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
