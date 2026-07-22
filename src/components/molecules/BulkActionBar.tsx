// Wspólny sticky pasek akcji zbiorczych dla dashboardów CRM (osoby, firmy).
// Wyświetla licznik zaznaczonych rekordów, listę akcji i przycisk czyszczenia
// selekcji. Akcje przekazywane są jako children - komponent nie decyduje
// o konkretnym menu (Popover ze zmianą stage'a, dropdown Delete, itp.), tylko
// zapewnia jednolity layout, i18n i dostępność wg atomic design.
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type BulkActionBarProps = {
  count: number;
  onClear: () => void;
  lang: "pl" | "en";
  children?: ReactNode;
  /** Etykieta obiektu w liczbie mnogiej (np. "leadów", "firm"). */
  itemLabel?: { pl: string; en: string };
};

export function BulkActionBar({ count, onClear, lang, children, itemLabel }: BulkActionBarProps) {
  if (count <= 0) return null;
  const label = itemLabel
    ? lang === "pl"
      ? `${count} ${itemLabel.pl}`
      : `${count} ${itemLabel.en}`
    : lang === "pl"
      ? `${count} zaznaczono`
      : `${count} selected`;
  return (
    <div
      role="region"
      aria-label={lang === "pl" ? "Akcje zbiorcze" : "Bulk actions"}
      className="sticky bottom-3 z-30 mx-auto flex w-fit max-w-full flex-wrap items-center gap-2 rounded-md border border-border/70 bg-background/95 px-3 py-2 shadow-lg backdrop-blur"
    >
      <span className="inline-flex items-center rounded bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onClear}
        className="ml-1 h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <X className="h-3 w-3" aria-hidden />
        {lang === "pl" ? "Wyczyść" : "Clear"}
      </Button>
    </div>
  );
}
