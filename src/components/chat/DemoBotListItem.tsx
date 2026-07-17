// Wirtualny wiersz "Demo bot" przypięty nad realną listą konwersacji.
// Nie łączy się z bazą - służy wyłącznie do otwarcia lokalnego podglądu
// (DemoBotChat). Wizualnie odpowiada ConversationListItem, żeby użytkownik
// mógł oceniać UI listy bez wyodrębnionego "trybu demo".
import { useTranslation } from "react-i18next";
import { Bot, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatAvatar } from "./ChatAvatar";

export interface DemoBotListItemProps {
  active: boolean;
  onOpen: () => void;
}

export function DemoBotListItem({ active, onOpen }: DemoBotListItemProps) {
  const { t } = useTranslation();
  const name = t("chat.demoBot.name");
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-[6px] px-2 py-2 text-left transition-colors",
        active ? "bg-muted" : "hover:bg-muted/60",
      )}
      aria-label={t("chat.demoBot.openAria")}
    >
      <span className="relative inline-block shrink-0">
        <ChatAvatar name={name} online size="md" />
        <span
          className="absolute -right-1 -top-1 inline-flex h-4 w-4 items-center justify-center rounded-md bg-[var(--brand)] text-white shadow-sm ring-2 ring-background"
          aria-hidden
        >
          <Bot className="h-2.5 w-2.5" />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1 truncate text-[13px] font-semibold">
            <span className="truncate">{name}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <Pin
              className="h-3 w-3 text-muted-foreground"
              aria-label={t("chat.menu.pinnedBadge")}
            />
            <span
              className="inline-flex items-center rounded-md border border-border/60 bg-muted px-1 py-[1px] text-[9px] font-medium uppercase tracking-wide text-muted-foreground"
              aria-hidden
            >
              {t("chat.demoBot.badge")}
            </span>
          </span>
        </span>
        <span className="mt-0.5 flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1 truncate text-[11.5px] text-muted-foreground">
            <span className="truncate">{t("chat.demoBot.preview")}</span>
          </span>
        </span>
      </span>
    </button>
  );
}
