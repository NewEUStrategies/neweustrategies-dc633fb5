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
// KOMPAKTOWOŚĆ. Trzy rzędy chipów (rodzaje + przełączniki + czyszczenie)
// zjadały nad strumieniem tyle pionu, co dwa wpisy. Widoczne zostają cztery
// decyzje podejmowane realnie co dzień - „wszystkie", dyskusja, pytanie,
// stanowisko - a rzadsze rodzaje i przełączniki stanu chowa piąty przycisk
// „Więcej" z licznikiem, żeby ukryte zawężenie nigdy nie działało po cichu.
import { useTranslation } from "react-i18next";
import { Check, Link2, MailOpen, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CLUB_THREAD_KINDS, type ClubThreadKind } from "@/lib/clubs/types";

const CHIP =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium leading-none transition-colors";
const CHIP_OFF =
  "border-border/60 bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground";
const CHIP_ON = "border-primary/40 bg-primary/10 text-primary";

/** Rodzaje na wierzchu. Reszta żyje w „Więcej" - kolejność bierzemy z typu,
 *  żeby nowy rodzaj nie zniknął z UI tylko dlatego, że nie ma go na liście. */
const PRIMARY_KINDS: ReadonlyArray<ClubThreadKind> = ["discussion", "question", "position"];

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
  const secondaryKinds = CLUB_THREAD_KINDS.filter((value) => !PRIMARY_KINDS.includes(value));
  const hiddenKindActive = kind !== null && !PRIMARY_KINDS.includes(kind);
  const hiddenCount =
    (hiddenKindActive ? 1 : 0) + (anchoredOnly ? 1 : 0) + (canFilterUnread && unreadOnly ? 1 : 0);
  const dirty = kind !== null || anchoredOnly || (canFilterUnread && unreadOnly);

  return (
    <div
      role="group"
      aria-label={t("club.kind.label")}
      className={cn(
        "-mx-3 flex items-center gap-1 overflow-x-auto px-3 [scrollbar-width:none] sm:mx-0 sm:px-0",
        className,
      )}
    >
      <button
        type="button"
        aria-pressed={kind === null}
        onClick={() => onKindChange(null)}
        className={cn(CHIP, kind === null ? CHIP_ON : CHIP_OFF)}
      >
        <span className="whitespace-nowrap">{t("club.allKinds")}</span>
      </button>
      {PRIMARY_KINDS.map((value) => {
        const active = kind === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
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

      <Popover>
        <PopoverTrigger
          className={cn(CHIP, hiddenCount > 0 ? CHIP_ON : CHIP_OFF)}
          aria-label={t("club.filters.moreLabel")}
        >
          <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="whitespace-nowrap">{t("club.filters.more")}</span>
          {hiddenCount > 0 ? (
            <span className="rounded bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
              {hiddenCount}
            </span>
          ) : null}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-1.5">
          <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("club.filters.kindHeading")}
          </p>
          {secondaryKinds.map((value) => {
            const active = kind === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => onKindChange(active ? null : value)}
                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
              >
                <span className="truncate">{t(`club.kind.${value}`)}</span>
                {active ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                ) : null}
              </button>
            );
          })}

          <p className="mt-1 border-t border-border/60 px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("club.filters.stateHeading")}
          </p>
          <button
            type="button"
            aria-pressed={anchoredOnly}
            onClick={() => onAnchoredOnlyChange(!anchoredOnly)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
          >
            <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{t("club.filters.anchorOnly")}</span>
            {anchoredOnly ? (
              <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
            ) : null}
          </button>
          {canFilterUnread ? (
            <button
              type="button"
              aria-pressed={unreadOnly}
              onClick={() => onUnreadOnlyChange(!unreadOnly)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
            >
              <MailOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{t("club.filters.unreadOnly")}</span>
              {unreadOnly ? (
                <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              ) : null}
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
              className="mt-1 flex w-full items-center gap-2 rounded-md border-t border-border/60 px-2 py-1.5 pt-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{t("club.filters.clear")}</span>
            </button>
          ) : null}
        </PopoverContent>
      </Popover>

      {dirty ? (
        <button
          type="button"
          onClick={() => {
            onKindChange(null);
            onAnchoredOnlyChange(false);
            onUnreadOnlyChange(false);
          }}
          aria-label={t("club.filters.clear")}
          className={cn(CHIP, CHIP_OFF, "w-7 justify-center px-0")}
        >
          <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
