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
import { LayoutGrid, LayoutList, LayoutTemplate, Newspaper } from "lucide-react";
import { cn } from "@/lib/utils";
import { CLUB_LAYOUTS, toClubLayout, type ClubLayout } from "@/lib/clubs/types";

// Klucz jest wersjonowany: domyślny układ hubu to teraz „Edytorialny", a stary
// klucz (`nes.club.hub.layout`) trzymał wybory sprzed tej zmiany - bez bumpu
// każdy, kto kiedykolwiek kliknął inny układ, nigdy nie zobaczyłby nowego
// domyślnego widoku.
const STORAGE_KEY = "nes.club.hub.layout.v2";
const LEGACY_STORAGE_KEY = "nes.club.hub.layout";

const ICON: Record<ClubLayout, typeof LayoutList> = {
  list: LayoutList,
  cards: LayoutGrid,
  magazine: Newspaper,
  editorial: LayoutTemplate,
};

/**
 * Odczyt idzie w `useEffect`, nie w inicjalizatorze stanu: `localStorage` nie
 * istnieje podczas SSR, a odczyt w inicjalizatorze rozjeżdża hydratację nawet
 * wtedy, gdy jest osłonięty `typeof window`.
 */
export function useClubHubLayout(): [ClubLayout, (layout: ClubLayout) => void] {
  const [layout, setLayout] = useState<ClubLayout>("editorial");

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

/**
 * Kontrakt WAI-ARIA dla `radiogroup` jest twardy i wcześniej nie był tu
 * spełniony: dokładnie JEDEN przycisk może być w kolejności tabulacji, a
 * przełączanie odbywa się STRZAŁKAMI. Trzy tabbowalne przyciski bez obsługi
 * klawiatury to grupa, która dla czytnika ekranu wygląda jak radiogroup, a
 * zachowuje się jak trzy niezależne przyciski - czyli obietnica bez pokrycia.
 */
export function ClubHubLayoutSwitch({
  value,
  onChange,
}: {
  value: ClubLayout;
  onChange: (layout: ClubLayout) => void;
}) {
  const { t } = useTranslation();

  const move = (delta: number) => {
    const index = CLUB_LAYOUTS.indexOf(value);
    const next = CLUB_LAYOUTS[(index + delta + CLUB_LAYOUTS.length) % CLUB_LAYOUTS.length];
    onChange(next);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      onChange(CLUB_LAYOUTS[0]);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      onChange(CLUB_LAYOUTS[CLUB_LAYOUTS.length - 1]);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={t("club.hub.layoutLabel")}
      onKeyDown={onKeyDown}
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
            aria-label={t(`adminClubs.layout.${layout}`)}
            // Roving tabindex: Tab wchodzi do grupy i z niej wychodzi, a między
            // opcjami porusza się strzałkami.
            tabIndex={selected ? 0 : -1}
            title={t(`adminClubs.layout.${layout}`)}
            onClick={() => onChange(layout)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors",
              // Cel dotykowy 44 px jak w prymitywie `Button` - ta kontrolka jest
              // pisana od zera, więc regułę repo trzeba powtórzyć jawnie.
              "pointer-coarse:min-h-11 pointer-coarse:px-3",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            <span aria-hidden="true" className="hidden sm:inline">
              {t(`adminClubs.layout.${layout}`)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
