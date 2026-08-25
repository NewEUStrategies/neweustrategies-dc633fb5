// Organizm: lista zgloszen jednego wydarzenia z decyzjami organizatora.
//
// FILTRY SIEDZA W KLUCZU ZAPYTANIA, NIE W STANIE WIERSZY. Lista i liczniki
// czytaja ten sam zestaw filtrow, wiec zakladka statusu pokazuje liczbe z tego
// samego przekroju, ktory zobaczy organizator po kliknieciu. Liczniki NIE biora
// filtra statusu - inaczej kazda zakladka pokazywalaby liczbe samej siebie.
//
// PRZYCISKI DECYZJI SA WYLICZANE ZE STANU WIERSZA. Zestaw bierzemy z jednego
// modulu regul (`registrationRows`), bo baza odrzuca niedozwolone przejscia
// bledem, ktorego organizator nie umie zinterpretowac. Lepiej nie pokazac
// przycisku niz pokazac go i przegrac z CHECK-iem.
//
// STRONICOWANIE JEST SERWEROWE. `total_count` przychodzi w kazdym wierszu okna
// nad zapytaniem, wiec licznik stron nie wymaga drugiego zapytania, a lista w
// dniu wydarzenia nie ciagnie tysiaca wierszy do przegladarki.
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { BellRing, ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { RegistrationDecideDialog } from "@/components/admin/events/molecules/RegistrationDecideDialog";
import { adminRegistrationErrorMessage } from "@/lib/events/adminRegistrationErrors";
import { notifyEventRegistrationDecision } from "@/lib/events/registrationNotify.functions";
import { registrationsCsvFileName, registrationsToCsv } from "@/lib/events/registrationsCsv";
import { formatDateTime, uiLang } from "@/lib/i18n/format";
import {
  allowedRegistrationActions,
  areConsentsWithdrawn,
  hasMissingRequiredTerms,
  isAwaitingWaitlistNotice,
  registrationGroupLabel,
  registrationOffsetForPage,
  registrationPageCount,
  registrationPageIndex,
  registrationPersonName,
  registrationStatusTone,
  registrationTicketLabel,
  type StatusTone,
} from "@/lib/events/registrationRows";
import {
  fetchRegistrations,
  DEFAULT_REGISTRATIONS_QUERY,
  REGISTRATION_STATUSES,
  type EventRegistrationRow,
  type RegistrationAction,
  type RegistrationStatusFilter,
} from "@/lib/events/registrationsApi";
import {
  useDecideRegistration,
  useEventTickets,
  useMarkRegistrationsNotified,
  usePromoteFromWaitlist,
  useRegistrationCounts,
  useRegistrationsList,
} from "@/lib/events/useEventRegistrations";

const ALL_TICKETS = "__all__";

/** Gorna granica jednej strony `admin_event_registrations_list` - lustro SQL. */
const EXPORT_PAGE_SIZE = 200;

/** Tonacja stanu -> wariant plakietki. Kolory pochodza wylacznie z tokenow. */
const TONE_VARIANT: Record<StatusTone, "default" | "secondary" | "destructive" | "outline"> = {
  success: "default",
  warning: "secondary",
  danger: "destructive",
  info: "secondary",
  neutral: "outline",
};

const TOAST_KEYS: Record<RegistrationAction, string> = {
  approve: "approved",
  reject: "rejected",
  waitlist: "waitlisted",
  cancel: "cancelled",
  attended: "attended",
  no_show: "noShow",
};

export function RegistrationsListPanel({
  eventId,
  eventSlug = "",
}: {
  eventId: string;
  /** Slug wydarzenia - wchodzi wylacznie do nazwy pliku eksportu. */
  eventSlug?: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);

  const [status, setStatus] = useState<RegistrationStatusFilter>("all");
  const [ticketTypeId, setTicketTypeId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = DEFAULT_REGISTRATIONS_QUERY.limit;
  const [promoteCount, setPromoteCount] = useState(1);

  const [decided, setDecided] = useState<EventRegistrationRow | null>(null);
  const [action, setAction] = useState<RegistrationAction | null>(null);

  const filters = useMemo(
    () => ({ eventId, ticketTypeId, groupId: null, q, from: null, to: null }),
    [eventId, ticketTypeId, q],
  );

  const listQ = useRegistrationsList({ ...filters, status, limit, offset });
  const countsQ = useRegistrationCounts(filters);
  const ticketsQ = useEventTickets(eventId);

  const decide = useDecideRegistration(eventId);
  const promote = usePromoteFromWaitlist(eventId);
  const markNotified = useMarkRegistrationsNotified(eventId);
  // Wysylka maila zyje na serwerze (kolejka, idempotencja, lista wykluczen);
  // panel jest tylko wyzwalaczem i pokazuje wynik.
  const notifyDecision = useServerFn(notifyEventRegistrationDecision);
  const [notifying, setNotifying] = useState(false);
  const [exporting, setExporting] = useState(false);

  const rows = listQ.data?.rows ?? [];
  const total = listQ.data?.total ?? 0;
  const counts = countsQ.data ?? null;
  const pageCount = registrationPageCount(total, limit);
  const page = registrationPageIndex(offset, limit);

  const base = "adminEventRegistration.registrations";
  const fail = (error: unknown) => toast.error(adminRegistrationErrorMessage(error));

  /** Zmiana filtra wraca na pierwsza strone - inaczej lista bywa pusta bez powodu. */
  const resetPage = () => setOffset(0);

  const submitSearch = () => {
    setQ(search);
    resetPage();
  };

  const confirmDecision = (note: string | null) => {
    if (decided === null || action === null) return;
    const registrationId = decided.id;
    decide.mutate(
      { registrationId, action, note },
      {
        onSuccess: () => {
          toast.success(t(`${base}.toasts.${TOAST_KEYS[action]}`));
          setDecided(null);
          setAction(null);
          // Decyzja BEZ wiadomosci jest decyzja, o ktorej uczestnik sie nie
          // dowie. Mail leci od razu po zapisie, fail-soft: nieudana wysylka
          // nie cofa decyzji, ale organizator musi o niej wiedziec.
          if (action === "approve" || action === "reject") {
            void notifyDecision({
              data: {
                registrationId,
                notice: action === "approve" ? "approved" : "rejected",
              },
            })
              .then((result) => {
                if (!result.ok) toast.error(t(`${base}.toasts.notifyFailed`));
              })
              .catch(() => toast.error(t(`${base}.toasts.notifyFailed`)));
          }
        },
        onError: fail,
      },
    );
  };

  const awaitingIds = rows.filter(isAwaitingWaitlistNotice).map((row) => row.id);

  const runPromote = () => {
    promote.mutate(
      { eventId, registrationId: null, ticketTypeId, count: promoteCount },
      {
        onSuccess: () => toast.success(t(`${base}.toasts.promoted`, { count: promoteCount })),
        onError: fail,
      },
    );
  };

  /**
   * Powiadomienie o awansie z rezerwy.
   *
   * WYSYLA, A NIE TYLKO ODZNACZA. Do tej pory ten przycisk stemplowal
   * `waitlist_notified_at` i nic wiecej - czyli organizator potwierdzal, ze
   * powiadomil kogos JAKOS, poza systemem. Teraz kazdy wiersz dostaje maila,
   * a pieczec stawia dopiero udana wysylka (robi to funkcja serwerowa).
   *
   * SZEREGOWO, NIE ROWNOLEGLE. Lista bywa dlugia, a kazdy mail to zapis do
   * dziennika wysylek i wstawienie do kolejki; dwadziescia rownoleglych
   * wywolan konczy sie limitem po stronie dostawcy, a nie dwudziestoma mailami.
   */
  const runNotifyPromoted = () => {
    if (awaitingIds.length === 0 || notifying) return;
    setNotifying(true);
    void (async () => {
      let sent = 0;
      let failed = 0;
      for (const registrationId of awaitingIds) {
        try {
          const result = await notifyDecision({ data: { registrationId, notice: "promoted" } });
          if (result.ok) sent += 1;
          else failed += 1;
        } catch {
          failed += 1;
        }
      }
      setNotifying(false);
      if (sent > 0) toast.success(t(`${base}.toasts.notified`, { count: sent }));
      if (failed > 0) toast.error(t(`${base}.toasts.notifyFailedCount`, { count: failed }));
      // Pieczec stawia serwer, ale to panel trzyma liste - odswiezamy ja,
      // zeby wiersze zniknely z „czeka na powiadomienie".
      markNotified.reset();
      void listQ.refetch();
      void countsQ.refetch();
    })();
  };

  /**
   * Eksport listy uczestnikow.
   *
   * BIERZE CALY PRZEKROJ FILTRA, NIE BIEZACA STRONE. Organizator eksportuje
   * po to, zeby miec komplet - plik z dwudziestoma wierszami z widocznej
   * strony bylby pulapka.
   *
   * CHODZIMY PO STRONACH, BO RPC TNIE DO 200 WIERSZY
   * (`admin_event_registrations_list`: `LEAST(GREATEST(p_limit, 1), 200)`).
   * Poproszenie o 2000 nie daje bledu - daje 200 wierszy wygladajacych na
   * komplet, czyli najgorszy mozliwy wynik: plik, ktoremu organizator ufa.
   */
  const runExport = () => {
    if (exporting) return;
    setExporting(true);
    void (async () => {
      try {
        const rows: EventRegistrationRow[] = [];
        let cursor = 0;
        let total = 0;
        // Zabezpieczenie przed petla, gdyby RPC kiedys przestalo oddawac
        // `total_count`: 100 stron po 200 wierszy to 20 tysiecy zgloszen,
        // wielokrotnie ponad najwieksze wydarzenie w historii serwisu.
        for (let page = 0; page < 100; page += 1) {
          const chunk = await fetchRegistrations({
            ...filters,
            status,
            limit: EXPORT_PAGE_SIZE,
            offset: cursor,
          });
          rows.push(...chunk.rows);
          total = chunk.total;
          cursor += chunk.rows.length;
          if (chunk.rows.length < EXPORT_PAGE_SIZE || cursor >= chunk.total) break;
        }
        // Nie obiecujemy kompletu, ktorego nie mamy - liczba w komunikacie
        // jest liczba WIERSZY W PLIKU, a nie liczba zgloszen w bazie.
        if (total > rows.length) toast.warning(t(`${base}.toasts.exportTruncated`));
        const csv = registrationsToCsv(rows, lang);
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = registrationsCsvFileName(eventSlug, new Date().toISOString());
        document.body.appendChild(link);
        link.click();
        link.remove();
        // Zwolnienie w NASTEPNEJ klatce - Safari przerywa pobieranie, gdy adres
        // znika synchronicznie po kliknieciu.
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
        toast.success(t(`${base}.toasts.exported`, { count: rows.length }));
      } catch (error: unknown) {
        fail(error);
      } finally {
        setExporting(false);
      }
    })();
  };

  const seatsLabel = (): string => {
    if (counts === null || counts.capacity === null) {
      return t(`${base}.capacity.unlimited`);
    }
    if ((counts.seatsLeft ?? 0) <= 0) return t(`${base}.capacity.soldOut`);
    return t(`${base}.capacity.ofCapacity`, {
      left: counts.seatsLeft,
      capacity: counts.capacity,
    });
  };

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t(`${base}.title`)}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">{t(`${base}.subtitle`)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {t(`${base}.capacity.label`)}
          </p>
          <p className="text-sm font-semibold">{seatsLabel()}</p>
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem] flex-1 space-y-1.5">
          <Label htmlFor="registrations-search">{t(`${base}.searchPlaceholder`)}</Label>
          <div className="flex gap-2">
            <Input
              id="registrations-search"
              value={search}
              placeholder={t(`${base}.searchPlaceholder`)}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitSearch();
              }}
            />
            <Button
              variant="outline"
              onClick={submitSearch}
              aria-label={t(`${base}.searchPlaceholder`)}
            >
              <Search className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="w-56 space-y-1.5">
          <Label htmlFor="registrations-status">{t(`${base}.filters.status`)}</Label>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value as RegistrationStatusFilter);
              resetPage();
            }}
          >
            <SelectTrigger id="registrations-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {`${t(`${base}.tabs.all`)}${counts === null ? "" : ` (${counts.all})`}`}
              </SelectItem>
              {REGISTRATION_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {`${t(`adminEventRegistration.statuses.${value}`)}${
                    counts === null ? "" : ` (${counts.byStatus[value]})`
                  }`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-56 space-y-1.5">
          <Label htmlFor="registrations-ticket">{t(`${base}.filters.ticket`)}</Label>
          <Select
            value={ticketTypeId ?? ALL_TICKETS}
            onValueChange={(value) => {
              setTicketTypeId(value === ALL_TICKETS ? null : value);
              resetPage();
            }}
          >
            <SelectTrigger id="registrations-ticket">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_TICKETS}>{t(`${base}.filters.allTickets`)}</SelectItem>
              {(ticketsQ.data ?? []).map((ticket) => (
                <SelectItem key={ticket.id} value={ticket.id}>
                  {lang === "en"
                    ? ticket.name_en || ticket.name_pl
                    : ticket.name_pl || ticket.name_en}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Rezerwa: awans po kolejce i odznaczenie wyslanych wiadomosci. Osoba bez
          konta nie dostaje powiadomienia w aplikacji, wiec ten stan musi byc
          widoczny, a nie domyslany z daty awansu. */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-4">
        <div className="w-40 space-y-1.5">
          <Label htmlFor="registrations-promote-count">
            {t("adminEventRegistration.waitlist.promoteCountLabel")}
          </Label>
          <Input
            id="registrations-promote-count"
            type="number"
            min={1}
            max={500}
            value={promoteCount}
            onChange={(event) => setPromoteCount(Math.max(1, Number(event.target.value) || 1))}
          />
        </div>
        <Button variant="outline" onClick={runPromote} disabled={promote.isPending}>
          {t("adminEventRegistration.actions.promote")}
        </Button>
        <Button
          variant="outline"
          onClick={runNotifyPromoted}
          disabled={awaitingIds.length === 0 || notifying}
        >
          <BellRing className="mr-2 h-4 w-4" />
          {t("adminEventRegistration.actions.markNotified")}
        </Button>
        <Button variant="outline" onClick={runExport} disabled={exporting || total === 0}>
          <Download className="mr-2 h-4 w-4" />
          {t("adminEventRegistration.actions.exportCsv")}
        </Button>
        {counts === null || counts.awaitingNotice === 0 ? null : (
          <p className="text-sm text-muted-foreground">
            {`${t("adminEventRegistration.waitlist.awaitingNotice")}: ${counts.awaitingNotice}`}
          </p>
        )}
      </div>

      <AdminCatalogListState
        isLoading={listQ.isLoading}
        loadingLabel={t(`${base}.loading`)}
        errorMessage={listQ.error === null ? null : adminRegistrationErrorMessage(listQ.error)}
        isEmpty={rows.length === 0}
        emptyLabel={
          status === "all" && q === "" && ticketTypeId === null
            ? t(`${base}.empty`)
            : t(`${base}.emptyFiltered`)
        }
      >
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((row) => {
            const ticket = registrationTicketLabel(row, lang);
            const group = registrationGroupLabel(row, lang);
            return (
              <li key={row.id} className="flex flex-wrap items-start gap-3 p-4">
                <div className="min-w-[14rem] flex-1 space-y-1">
                  <p className="font-medium">{registrationPersonName(row)}</p>
                  <p className="text-sm text-muted-foreground">{row.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {[row.job_title, row.company_name ?? row.company_text]
                      .filter((part) => part !== null && part !== "")
                      .join(" · ")}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Badge variant={TONE_VARIANT[registrationStatusTone(row.status)]}>
                      {t(`adminEventRegistration.statuses.${row.status}`, {
                        defaultValue: row.status,
                      })}
                    </Badge>
                    {ticket === null ? null : <Badge variant="outline">{ticket}</Badge>}
                    {group === null ? null : <Badge variant="outline">{group}</Badge>}
                    {row.status === "waitlist" && row.waitlist_position !== null ? (
                      <Badge variant="outline">
                        {t("adminEventRegistration.waitlist.position", {
                          position: row.waitlist_position,
                        })}
                      </Badge>
                    ) : null}
                    {isAwaitingWaitlistNotice(row) ? (
                      <Badge variant="secondary">
                        {t("adminEventRegistration.waitlist.notNotified")}
                      </Badge>
                    ) : null}
                    {hasMissingRequiredTerms(row) ? (
                      <Badge variant="destructive">
                        {t(`${base}.consents.requiredMissing`, {
                          count: row.required_terms_missing,
                        })}
                      </Badge>
                    ) : null}
                    {areConsentsWithdrawn(row) ? (
                      <Badge variant="destructive">{t(`${base}.consents.withdrawn`)}</Badge>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-1 text-right text-xs text-muted-foreground">
                  <p>{formatDateTime(row.created_at, i18n.language)}</p>
                  {row.decision_note === null || row.decision_note === "" ? null : (
                    <p className="max-w-xs">{`${t(`${base}.decision.note`)}: ${row.decision_note}`}</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                  {allowedRegistrationActions(row.status).map((value) => (
                    <Button
                      key={value}
                      size="sm"
                      variant={value === "approve" ? "default" : "outline"}
                      disabled={decide.isPending}
                      onClick={() => {
                        setDecided(row);
                        setAction(value);
                      }}
                    >
                      {t(`adminEventRegistration.actions.${value}`)}
                    </Button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      </AdminCatalogListState>

      {pageCount <= 1 ? null : (
        <nav className="flex items-center justify-end gap-2" aria-label={t(`${base}.title`)}>
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setOffset(registrationOffsetForPage(page - 1, limit, total))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">{`${page} / ${pageCount}`}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pageCount}
            onClick={() => setOffset(registrationOffsetForPage(page + 1, limit, total))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </nav>
      )}

      <RegistrationDecideDialog
        open={action !== null}
        action={action}
        personName={decided === null ? "" : registrationPersonName(decided)}
        isPending={decide.isPending}
        onOpenChange={(open) => {
          if (!open) {
            setAction(null);
            setDecided(null);
          }
        }}
        onConfirm={confirmDecision}
      />
    </section>
  );
}
