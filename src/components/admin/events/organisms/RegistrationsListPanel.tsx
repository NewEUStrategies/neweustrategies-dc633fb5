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
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { BellRing, ChevronLeft, ChevronRight, Search } from "lucide-react";
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

export function RegistrationsListPanel({ eventId }: { eventId: string }) {
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
    decide.mutate(
      { registrationId: decided.id, action, note },
      {
        onSuccess: () => {
          toast.success(t(`${base}.toasts.${TOAST_KEYS[action]}`));
          setDecided(null);
          setAction(null);
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
        onSuccess: () =>
          toast.success(t(`${base}.toasts.promoted`, { count: promoteCount })),
        onError: fail,
      },
    );
  };

  const runMarkNotified = () => {
    if (awaitingIds.length === 0) return;
    markNotified.mutate(awaitingIds, {
      onSuccess: (count) => toast.success(t(`${base}.toasts.notified`, { count })),
      onError: fail,
    });
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
          <Label htmlFor="registrations-search">{t(`${base}.filters.status`)}</Label>
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
            <Button variant="outline" onClick={submitSearch} aria-label={t(`${base}.searchPlaceholder`)}>
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
          onClick={runMarkNotified}
          disabled={awaitingIds.length === 0 || markNotified.isPending}
        >
          <BellRing className="mr-2 h-4 w-4" />
          {t("adminEventRegistration.actions.markNotified")}
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
