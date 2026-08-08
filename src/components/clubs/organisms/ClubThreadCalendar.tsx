// Organizm: siatka miesiąca harmonogramu wątku.
//
// DLACZEGO SIATKA, SKORO JEST LISTA. Lista odpowiada na „co dalej", siatka na
// „jak gęsto" - a to jest inne pytanie i częste w klubie, który układa cykl
// spotkań wokół kalendarza instytucjonalnego. Oba widoki czytają JEDEN zbiór
// danych (`club_thread_milestones`), więc nie ma jak się rozjechać.
//
// Siatka to `<table>`, a nie grid z divów: miesiąc JEST tabelą (kolumny = dni
// tygodnia, wiersze = tygodnie), a czytnik ekranu w tabeli potrafi zapowiedzieć
// nagłówek kolumny przy każdej komórce. Grid z divów wymagałby ręcznego
// odtworzenia tych ról i i tak wypadłby gorzej.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClubStatusPill, milestoneTone } from "@/components/clubs/atoms/ClubStatusPill";
import { milestoneWhen } from "@/components/clubs/molecules/ClubMilestoneRow";
import { uiLocale } from "@/lib/i18n/format";
import {
  buildCalendarGrid,
  toClubMilestoneStatus,
  type ClubThreadMilestoneRow,
} from "@/lib/clubs/threadWorkspaceTypes";

/** Skrócone nazwy dni od PONIEDZIAŁKU - taki jest tydzień w PL i w instytucjach
 *  UE. Bierzemy je z `Intl`, więc nie ma tu żadnego słownika do utrzymania. */
function weekdayNames(lang: string): string[] {
  const formatter = new Intl.DateTimeFormat(uiLocale(lang), { weekday: "short" });
  // 2024-01-01 był poniedziałkiem - dowolna data spełniająca ten warunek
  // wystarczy, bo interesuje nas wyłącznie kolejność.
  return Array.from({ length: 7 }, (_, i) => formatter.format(new Date(2024, 0, 1 + i)));
}

export function ClubThreadCalendar({
  rows,
  lang,
  onSelect,
}: {
  rows: readonly ClubThreadMilestoneRow[];
  lang: "pl" | "en";
  onSelect?: (row: ClubThreadMilestoneRow) => void;
}) {
  const { t } = useTranslation();
  const today = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));

  const cells = useMemo(() => buildCalendarGrid(rows, month, today), [rows, month, today]);
  const weekdays = useMemo(() => weekdayNames(lang), [lang]);
  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat(uiLocale(lang), { month: "long", year: "numeric" }).format(month),
    [month, lang],
  );

  const shift = (delta: number) =>
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));

  const weeks = useMemo(() => {
    const out: (typeof cells)[] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [cells]);

  return (
    <div className="rounded-lg border border-border/60 bg-card p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          aria-label={t("club.threadHub.calendar.previous")}
          onClick={() => shift(-1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        {/* `aria-live` bo zmiana miesiąca nie przenosi fokusu - bez tego
            użytkownik czytnika klika strzałkę i nie dostaje żadnej informacji
            zwrotnej. */}
        <p className="text-sm font-semibold first-letter:uppercase" aria-live="polite">
          {monthLabel}
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          aria-label={t("club.threadHub.calendar.next")}
          onClick={() => shift(1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] table-fixed border-collapse">
          <caption className="sr-only">
            {t("club.threadHub.calendar.caption", { month: monthLabel })}
          </caption>
          <thead>
            <tr>
              {weekdays.map((day) => (
                <th
                  key={day}
                  scope="col"
                  className="px-1 pb-2 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                >
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week[0]?.iso}>
                {week.map((cell) => (
                  <td
                    key={cell.iso}
                    className={
                      "h-20 border border-border/40 p-1 align-top sm:h-24 " +
                      (cell.inMonth ? "" : "bg-muted/20 text-muted-foreground/60")
                    }
                  >
                    <span
                      className={
                        "inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] tabular-nums " +
                        (cell.isToday ? "bg-primary font-semibold text-primary-foreground" : "")
                      }
                    >
                      {cell.day}
                    </span>
                    {cell.items.length > 0 ? (
                      <ul className="mt-0.5 space-y-0.5">
                        {/* Dwie pozycje i licznik reszty: komórka dnia ma stałą
                            wysokość, więc piąte spotkanie nie może rozpychać
                            całego tygodnia. */}
                        {cell.items.slice(0, 2).map((item) => {
                          const status = toClubMilestoneStatus(item.status);
                          const label = `${item.title} - ${milestoneWhen(item, lang)}`;
                          return (
                            <li key={item.id}>
                              <button
                                type="button"
                                title={label}
                                aria-label={label}
                                onClick={() => onSelect?.(item)}
                                className={
                                  "block w-full truncate rounded px-1 py-0.5 text-left text-[10px] leading-tight transition-colors " +
                                  (status === "cancelled"
                                    ? "bg-muted text-muted-foreground line-through"
                                    : status === "done"
                                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                      : "bg-primary/15 text-foreground hover:bg-primary/25")
                                }
                              >
                                {item.title}
                              </button>
                            </li>
                          );
                        })}
                        {cell.items.length > 2 ? (
                          <li className="px-1 text-[10px] text-muted-foreground">
                            {t("club.threadHub.calendar.more", { count: cell.items.length - 2 })}
                          </li>
                        ) : null}
                      </ul>
                    ) : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
        <ClubStatusPill
          label={t("club.threadHub.milestoneStatus.planned")}
          tone={milestoneTone("planned")}
        />
        <ClubStatusPill
          label={t("club.threadHub.milestoneStatus.done")}
          tone={milestoneTone("done")}
        />
        <ClubStatusPill
          label={t("club.threadHub.milestoneStatus.cancelled")}
          tone={milestoneTone("cancelled")}
        />
      </p>
    </div>
  );
}
