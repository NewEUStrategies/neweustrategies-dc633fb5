// Molekuła: wybór ikony tematu klubowego.
//
// Popover z siatką pogrupowanych ikon - nie droplista. Ikona jest decyzją
// WZROKOWĄ: lista nazw ("landmark", "gavel") zmusza do tłumaczenia słowa na
// obrazek w głowie, czyli do dokładnie tej pracy, którą piktogram ma oszczędzić.
//
// Ikona jest OPCJONALNA i taka jest wartość domyślna: temat bez ikony rysuje
// piktogram swojego rodzaju, więc pusty wybór nigdy nie zostawia dziury
// w układzie. Dlatego pierwszy kafel to "bez ikony", a nie ukryty przycisk
// czyszczenia gdzieś obok.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Ban, Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
import { cn } from "@/lib/utils";
import { CLUB_THREAD_ICON_GROUPS, normalizeClubThreadIcon } from "@/lib/clubs/threadIcons";

export function ClubIconPicker({
  value,
  onChange,
  id,
  disabled = false,
}: {
  value: string | null;
  onChange: (icon: string | null) => void;
  id?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = normalizeClubThreadIcon(value);

  function pick(icon: string | null) {
    onChange(icon);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-label={t("club.iconPicker.label")}
          className={cn(
            "flex h-11 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 text-left text-sm transition-colors",
            "hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            disabled ? "cursor-not-allowed opacity-60" : null,
          )}
          data-testid="club-icon-trigger"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <span
              className={cn(
                "grid h-7 w-7 shrink-0 place-items-center rounded-md border",
                selected !== null
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border/60 bg-muted/60 text-muted-foreground",
              )}
            >
              {selected !== null ? (
                <DynamicIcon name={selected} size={16} aria-hidden="true" />
              ) : (
                <Ban className="h-4 w-4" aria-hidden="true" />
              )}
            </span>
            <span className="truncate">
              {selected !== null ? selected : t("club.iconPicker.none")}
            </span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" aria-hidden="true" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("club.iconPicker.label")}
        </p>

        <button
          type="button"
          onClick={() => pick(null)}
          className={cn(
            "mt-2 flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-sm transition-colors",
            selected === null
              ? "border-primary/40 bg-primary/5 text-foreground"
              : "border-border/60 text-muted-foreground hover:border-primary/30 hover:text-foreground",
          )}
          data-testid="club-icon-none"
        >
          <Ban className="h-4 w-4" aria-hidden="true" />
          {t("club.iconPicker.none")}
          {selected === null ? <Check className="ml-auto h-4 w-4 text-primary" /> : null}
        </button>

        <div className="mt-3 max-h-72 space-y-3 overflow-y-auto pr-1">
          {CLUB_THREAD_ICON_GROUPS.map((group) => (
            <section key={group.id}>
              <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t(group.labelKey)}
              </h4>
              <div className="mt-1.5 grid grid-cols-8 gap-1">
                {group.icons.map((icon) => {
                  const active = selected === icon;
                  return (
                    <button
                      key={icon}
                      type="button"
                      onClick={() => pick(icon)}
                      title={icon}
                      aria-label={icon}
                      aria-pressed={active}
                      className={cn(
                        "grid aspect-square place-items-center rounded-md border transition-colors",
                        active
                          ? "border-primary/50 bg-primary/10 text-primary"
                          : "border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground",
                      )}
                      data-testid={`club-icon-${icon}`}
                    >
                      <DynamicIcon name={icon} size={16} aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
