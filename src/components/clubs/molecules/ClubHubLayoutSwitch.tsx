// Molekuła: przełącznik układu katalogu klubów na hubie.
//
// Ten sam słownik, co układ strony klubu (`CLUB_LAYOUTS`), ale decyzja należy
// tu do CZYTELNIKA, nie do administratora - więc nie idzie do bazy, tylko do
// localStorage. Wybór ma przetrwać przeładowanie, bo inaczej osoba, która woli
// gęstą listę, przy każdym wejściu dostaje siatkę kafli.
//
// Zapis jest opakowany w try/catch: w trybie prywatnym Safari `setItem` rzuca,
// a przełącznik układu nie jest funkcją, dla której wolno wywrócić stronę.
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LayoutGrid, LayoutList, Newspaper } from "lucide-react";
import { cn } from "@/lib/utils";
import { CLUB_LAYOUTS, toClubLayout, type ClubLayout } from "@/lib/clubs/types";

const STORAGE_KEY = "nes.club.hub.layout";

const ICON: Record<ClubLayout, typeof LayoutList> = {
  list: LayoutList,
  cards: LayoutGrid,
  magazine: Newspaper,
};

/**
 * Odczyt idzie w `useEffect`, nie w inicjalizatorze stanu: `localStorage` nie
 * istnieje podczas SSR, a odczyt w inicjalizatorze rozjeżdża hydratację nawet
 * wtedy, gdy jest osłonięty `typeof window`.
 */
export function useClubHubLayout(): [ClubLayout, (layout: ClubLayout) => void] {
  const [layout, setLayout] = useState<ClubLayout>("cards");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored !== null) setLayout(toClubLayout(stored));
    } catch {
      /* brak dostępu do storage nie zmienia działania strony */
    }
  }, []);

  const update = useCallback((next: ClubLayout) => {
    setLayout(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* jw. */
    }
  }, []);

  return [layout, update];
}

export function ClubHubLayoutSwitch({
  value,
  onChange,
}: {
  value: ClubLayout;
  onChange: (layout: ClubLayout) => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      role="radiogroup"
      aria-label={t("club.hub.layoutLabel")}
      className="inline-flex items-center gap-1 rounded-md border border-border/60 p-0.5"
    >
      {CLUB_LAYOUTS.map((layout) => {
        const Icon = ICON[layout];
        const selected = value === layout;
        return (
          <button
            key={layout}
            type="button"
            role="radio"
            aria-checked={selected}
            title={t(`adminClubs.layout.${layout}`)}
            onClick={() => onChange(layout)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{t(`adminClubs.layout.${layout}`)}</span>
          </button>
        );
      })}
    </div>
  );
}
