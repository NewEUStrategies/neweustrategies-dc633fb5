// Przełącznik segmentów odbiorców (Dla Ciebie / Dla firm / Edukacja i NGO /
// Dla zespołów). Semantyka tablist + pełna nawigacja klawiaturą (roving
// tabindex, strzałki, Home/End) - segment steruje panelem kart pod spodem.
import { useRef } from "react";
import { cn } from "@/lib/utils";
import type { PricingAudienceRow } from "@/lib/pricing/queries";
import { audienceName } from "@/lib/pricing/selectors";
import { audienceIcon, audiencePanelId, audienceTabId } from "./audienceMeta";

export function AudienceSwitcher({
  audiences,
  value,
  onChange,
  lang,
  label,
}: {
  audiences: PricingAudienceRow[];
  value: string;
  onChange: (key: string) => void;
  lang: string;
  label: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  const focusTab = (key: string) => {
    const el = listRef.current?.querySelector<HTMLButtonElement>(`#${audienceTabId(key)}`);
    el?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = audiences.map((a) => a.key);
    const current = keys.indexOf(value);
    if (current < 0 || keys.length === 0) return;
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = (current + 1) % keys.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = (current - 1 + keys.length) % keys.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = keys.length - 1;
    }
    if (next === null) return;
    event.preventDefault();
    onChange(keys[next]);
    focusTab(keys[next]);
  };

  return (
    <div className="flex justify-center">
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="grid w-full max-w-xl grid-cols-2 gap-1 rounded-2xl border border-border bg-muted/40 p-1 sm:flex sm:w-auto sm:max-w-none sm:rounded-full"
      >
        {audiences.map((audience) => {
          const Icon = audienceIcon(audience.icon);
          const active = audience.key === value;
          return (
            <button
              key={audience.key}
              type="button"
              role="tab"
              id={audienceTabId(audience.key)}
              aria-selected={active}
              aria-controls={audiencePanelId(audience.key)}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(audience.key)}
              className={cn(
                "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all sm:rounded-full",
                active
                  ? "bg-background text-foreground shadow"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{audienceName(audience, lang)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
