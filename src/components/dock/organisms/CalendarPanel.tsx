// Organizm: mini-kalendarz doku. Siatka miesiąca (logika w calendarGrid),
// wydarzenia i zadania z terminem, lista wybranego dnia.
//
// ── CZAS IDZIE PRZEZ JEDNO ŹRÓDŁO PRAWDY ─────────────────────────────────
// Panel czytał `new Date()` i formatował miesiąc gołym
// `new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "pl-PL", ...)`, czyli
// bez strefy i z własną tabelką locale. Repozytorium ma na to `lib/i18n/format.ts`
// (`SITE_TIME_ZONE`, `formatDate`, `uiLocale`) i to nie jest kwestia stylu:
// bez przypiętej strefy „dziś" jest dniem MASZYNY CZYTELNIKA, a każda inna
// data na tej samej stronie jest dniem redakcji (Europe/Warsaw). Czytelnik
// spoza CET/CEST widział więc obwódkę „dziś" na dniu, który w treści obok był
// już dniem następnym - między 22:00 a 24:00 UTC to po prostu inna data na
// jednym ekranie. Kursor startowy i klucz „dziś" liczy teraz `siteMonth`
// i `siteDayKey`, a etykietę miesiąca `formatDate`.
//
// ── PRZEWIJANIE MIESIĄCA NIE GASI SIATKI ─────────────────────────────────
// Zmiana miesiąca zmienia klucz zapytania, więc siatka gubiła kropki, a lista
// dnia twierdziła „brak wydarzeń tego dnia", zanim cokolwiek wiedziała.
// `useDockCalendar` trzyma teraz poprzedni miesiąc na ekranie
// (`placeholderData`) i zgłasza `isFetching`, a panel to pokazuje.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { DockPanelShell } from "../DockPanelShell";
import { DockEmptyState } from "../atoms/DockEmptyState";
import { monthGrid, shiftMonth, siteDayKey, siteMonth } from "@/lib/dock/calendarGrid";
import {
  calendarEntryTitle,
  useDockCalendar,
  type CalendarEventEntry,
} from "@/lib/dock/useDockCalendar";
import { formatDateOnly } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";
import "@/lib/i18n-dock";

export function CalendarPanel({ onClose, lang }: { onClose: () => void; lang: "pl" | "en" }) {
  const { t } = useTranslation();
  // Dzień i miesiąc BIEŻĄCY w strefie serwisu - jedno wywołanie na montaż,
  // żeby przejście przez północ nie przestawiło kursora pod ręką użytkownika.
  const todayKey = useMemo(() => siteDayKey(), []);
  const [cursor, setCursor] = useState<[number, number]>(() => siteMonth());
  const [selected, setSelected] = useState<string>(todayKey);
  const { entries, isPending, isFetching, isError } = useDockCalendar(cursor[0], cursor[1]);

  const grid = useMemo(() => monthGrid(cursor[0], cursor[1], entries), [cursor, entries]);
  // Mapa zamiast `grid.find` - lista dnia czyta ją przy każdym renderze.
  const byKey = useMemo(() => {
    const map = new Map<string, CalendarEventEntry[]>();
    for (const day of grid) map.set(day.key, day.entries);
    return map;
  }, [grid]);
  const selectedEntries = byKey.get(selected);
  const weekdays = t("dock.calendar.weekdays", { returnObjects: true }) as string[];
  // ETYKIETA MIESIĄCA IDZIE PRZEZ `formatDateOnly`, czyli UTC - a nie przez
  // strefę serwisu. Miesiąc NIE MA CHWILI, tak samo jak kolumna DATE, więc
  // jest to ten sam przypadek, który `DATE_ONLY_TIME_ZONE` w `format.ts`
  // opisuje wprost. Wariant „zbuduj `new Date(rok, miesiąc, 1)` i sformatuj
  // w strefie serwisu" jest ZŁY i daje się odtworzyć: `new Date(y, m, 1)` to
  // lokalna północ czytelnika, więc dla TZ=Asia/Tokyo przypada ona jeszcze
  // w POPRZEDNIM miesiącu czasu warszawskiego - nad wrześniową siatką stało
  // „sierpień 2026". `YYYY-MM-01` sformatowane w UTC nie ma jak się przesunąć.
  const monthIso = `${cursor[0]}-${String(cursor[1] + 1).padStart(2, "0")}-01`;
  const monthLabel = formatDateOnly(monthIso, lang, { month: "long", year: "numeric" });

  return (
    <DockPanelShell
      title={t("dock.calendar.title")}
      icon={<CalendarDays className="h-4 w-4" />}
      onClose={onClose}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={() => setCursor(shiftMonth(cursor[0], cursor[1], -1))}
          aria-label={t("dock.calendar.prev")}
          className="rounded-[6px] p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <span className="flex-1 text-center text-sm font-semibold capitalize text-foreground">
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={() => setCursor(shiftMonth(cursor[0], cursor[1], 1))}
          aria-label={t("dock.calendar.next")}
          className="rounded-[6px] p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {/* `aria-busy` na SIATCE, nie na całym panelu: nawigacja miesiącami musi
          zostać klikalna, a poprzedni miesiąc jest nadal poprawną treścią -
          tylko już nieaktualną. */}
      <div className="p-3" aria-busy={isFetching ? "true" : undefined}>
        <div className="grid grid-cols-7 gap-1 pb-1 text-center text-[10px] font-semibold uppercase text-muted-foreground">
          {weekdays.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div
          className={cn(
            "grid grid-cols-7 gap-1 transition-opacity duration-150",
            isFetching && "opacity-60",
          )}
        >
          {grid.map((day) => {
            const isToday = day.key === todayKey;
            return (
              <button
                key={day.key}
                type="button"
                onClick={() => setSelected(day.key)}
                aria-pressed={selected === day.key}
                aria-label={day.key}
                className={cn(
                  "relative flex h-8 items-center justify-center rounded-[6px] text-xs transition-colors",
                  day.inMonth ? "text-foreground" : "text-muted-foreground/50",
                  selected === day.key ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                  isToday && selected !== day.key && "ring-1 ring-primary",
                )}
              >
                {day.date.getDate()}
                {day.entries.length > 0 ? (
                  <span
                    className={cn(
                      "absolute bottom-1 h-1 w-1 rounded-full",
                      selected === day.key ? "bg-primary-foreground" : "bg-primary",
                    )}
                    aria-hidden
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {isError ? (
        <DockEmptyState>{t("dock.error")}</DockEmptyState>
      ) : isPending ? (
        // PIERWSZE pobranie tego miesiąca: nie wiemy jeszcze nic, więc nie
        // wolno twierdzić, że dzień jest pusty.
        <div aria-busy="true" className="space-y-2 border-t border-border p-3">
          <div className="skeleton-shimmer h-4 w-3/4 rounded-[6px]" />
          <div className="skeleton-shimmer h-4 w-1/2 rounded-[6px]" />
        </div>
      ) : !selectedEntries || selectedEntries.length === 0 ? (
        <DockEmptyState>{t("dock.calendar.dayEmpty")}</DockEmptyState>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {selectedEntries.map((entry) => {
            const title = calendarEntryTitle(entry, lang);
            return (
              <li key={entry.id} className="px-3 py-2">
                {entry.href ? (
                  <a href={entry.href} className="text-sm text-foreground hover:underline">
                    {title}
                  </a>
                ) : (
                  <span className="text-sm text-foreground">{title}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </DockPanelShell>
  );
}
