// Molekuła: zawężenia strumienia, które NIE są działem.
//
// PO CO. Do tej pory jedynym widocznym wymiarem porządkującym był dział, więc
// redakcja wyrażała nim wszystko, co miała do wyrażenia: format pracy
// („Stanowiska klubu"), kotwicę („Akty prawne") i powierzchnię („Biblioteka").
// Skutkiem był wątek stanowiskowy założony w „Debacie otwartej", którego nie
// dało się znaleźć - mimo że `kind = 'position'` siedział w bazie od A3 i był
// renderowany na wierszu.
//
// Ta kontrolka oddaje trybowi pracy i kotwicy własne miejsce, dzięki czemu
// dział może wreszcie znaczyć TEMAT i nic poza tym.
//
// DLACZEGO OSOBNO OD `ClubSegmented` NAD STRUMIENIEM. Tamten przełącznik
// zmienia ŹRÓDŁO (wątki / dokumenty / terminy), ten zawęża JEDNO źródło.
// Dwie kontrolki o identycznym wyglądzie i różnym znaczeniu czytałyby się jak
// jeden dwurzędowy filtr - dlatego tryb pracy jest cichy (obrys), a wybór
// źródła zostaje mocny (wypełnienie).
//
// Filtry idą do RPC, nie do przeglądarki: `club_threads_list` przyjmuje
// `p_kind`, `p_anchored` i `p_unread_only` od migracji A26, a filtrowanie
// strony kursorowej po jej pobraniu dawałoby niepełne strony.
import { useTranslation } from "react-i18next";
import { Link2, MailOpen, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CLUB_THREAD_KINDS, type ClubThreadKind } from "@/lib/clubs/types";

const CHIP =
  "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium leading-none transition-colors";
const CHIP_OFF =
  "border-border/60 bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground";
const CHIP_ON = "border-primary/40 bg-primary/10 text-primary";

export function ClubStreamFilters({
  kind,
  onKindChange,
  anchoredOnly,
  onAnchoredOnlyChange,
  unreadOnly,
  onUnreadOnlyChange,
  canFilterUnread,
  className,
}: {
  kind: ClubThreadKind | null;
  onKindChange: (next: ClubThreadKind | null) => void;
  anchoredOnly: boolean;
  onAnchoredOnlyChange: (next: boolean) => void;
  unreadOnly: boolean;
  onUnreadOnlyChange: (next: boolean) => void;
  /** Nieprzeczytane liczą się z `last_read_at` wołającego - bez sesji filtr
   *  zwróciłby pustkę i sugerował, że klub jest pusty. */
  canFilterUnread: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const dirty = kind !== null || anchoredOnly || (canFilterUnread && unreadOnly);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div
        role="radiogroup"
        aria-label={t("club.kind.label")}
        className="-mx-3 flex gap-1 overflow-x-auto px-3 [scrollbar-width:none] sm:mx-0 sm:px-0"
      >
        <button
          type="button"
          role="radio"
          aria-checked={kind === null}
          onClick={() => onKindChange(null)}
          className={cn(CHIP, kind === null ? CHIP_ON : CHIP_OFF)}
        >
          {t("club.allKinds")}
        </button>
        {CLUB_THREAD_KINDS.map((value) => {
          const active = kind === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              // Ponowne kliknięcie aktywnego rodzaju zdejmuje zawężenie:
              // bez tego jedyną drogą powrotu jest osobny przycisk, którego
              // użytkownik nie szuka, bo właśnie kliknął to, co chciał.
              onClick={() => onKindChange(active ? null : value)}
              className={cn(CHIP, active ? CHIP_ON : CHIP_OFF)}
            >
              <span className="whitespace-nowrap">{t(`club.kind.${value}`)}</span>
            </button>
          );
        })}
      </div>

      <div className="-mx-3 flex gap-1 overflow-x-auto px-3 [scrollbar-width:none] sm:mx-0 sm:px-0">
        <button
          type="button"
          aria-pressed={anchoredOnly}
          onClick={() => onAnchoredOnlyChange(!anchoredOnly)}
          className={cn(CHIP, anchoredOnly ? CHIP_ON : CHIP_OFF)}
        >
          <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="whitespace-nowrap">{t("club.filters.anchorOnly")}</span>
        </button>
        {canFilterUnread ? (
          <button
            type="button"
            aria-pressed={unreadOnly}
            onClick={() => onUnreadOnlyChange(!unreadOnly)}
            className={cn(CHIP, unreadOnly ? CHIP_ON : CHIP_OFF)}
          >
            <MailOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="whitespace-nowrap">{t("club.filters.unreadOnly")}</span>
          </button>
        ) : null}
        {dirty ? (
          <button
            type="button"
            onClick={() => {
              onKindChange(null);
              onAnchoredOnlyChange(false);
              onUnreadOnlyChange(false);
            }}
            className={cn(CHIP, CHIP_OFF, "border-dashed")}
          >
            <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="whitespace-nowrap">{t("club.filters.clear")}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
