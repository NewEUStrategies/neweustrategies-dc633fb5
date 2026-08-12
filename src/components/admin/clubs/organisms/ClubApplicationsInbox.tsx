// Skrzynka zgloszen klubowych w panelu.
//
// Uklad: zakladki = specjalizacje (bo to nimi steruje wejscie na hubie),
// w kazdej zakladce filtr statusu, wyszukiwarka i lista zgloszen z data oraz
// kartoteka kandydata. Liczniki nieprzeczytanych ("pending") sa przy zakladce,
// zeby redakcja widziala, gdzie zalega decyzja - bez wchodzenia w kazda z osma.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { uiLang, uiLocale } from "@/lib/i18n/format";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Inbox,
  Mail,
  RefreshCw,
  Search,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { FormSelect } from "@/components/atoms/FormSelect";
import {
  clubApplicationStatusErrorCode,
  fetchAdminClubApplicationCounts,
  fetchAdminClubApplications,
  retryClubApplicationCrmSync,
  setClubApplicationStatus,
  type ClubApplicationAdminRow,
  type ClubApplicationStatus,
} from "@/lib/clubs/applyApi";
import {
  isNotifiableStatus,
  notifyClubApplicationStatus,
} from "@/lib/clubs/applicationNotify.functions";
import { useServerFn } from "@tanstack/react-start";
import { useClubSpecializations } from "@/lib/clubs/useClubSpecializations";

const STATUSES: ClubApplicationStatus[] = [
  "pending",
  "review",
  "accepted",
  "rejected",
  "needs_info",
];

const applicationKeys = {
  all: ["admin", "club-applications"] as const,
  list: (spec: string, status: string, search: string) =>
    [...applicationKeys.all, "list", spec, status, search] as const,
  counts: () => [...applicationKeys.all, "counts"] as const,
};

function statusTone(status: ClubApplicationStatus): string {
  if (status === "accepted") return "border-emerald-500/40 text-emerald-600 dark:text-emerald-400";
  if (status === "rejected") return "border-destructive/40 text-destructive";
  if (status === "review" || status === "needs_info")
    return "border-amber-500/40 text-amber-600 dark:text-amber-400";
  return "border-border text-muted-foreground";
}

/**
 * Widoczny stan synchronizacji z CRM dla pojedynczego zgloszenia.
 *
 * Cicha porazka synchronizacji jest najgorszym mozliwym wynikiem: redakcja
 * widzi zgloszenie w panelu i zaklada, ze kartoteka w CRM istnieje. Dlatego
 * kazdy wiersz niesie status ostatniej proby, jej date i - przy bledzie -
 * jego tresc oraz przycisk ponowienia.
 */
function CrmSyncChip(props: {
  row: ClubApplicationAdminRow;
  onRetry: (id: string) => void;
  retrying: boolean;
}) {
  const { row } = props;
  const { t, i18n } = useTranslation();
  const locale = uiLocale(i18n.language);
  const fmt = (iso: string | null): string =>
    iso === null
      ? "-"
      : new Date(iso).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });

  const state = row.crm_sync_status;
  const tone =
    state === "ok"
      ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
      : state === "error"
        ? "border-destructive/40 text-destructive"
        : "border-border text-muted-foreground";
  const Icon = state === "ok" ? CheckCircle2 : state === "error" ? AlertTriangle : RefreshCw;
  const detail =
    state === "ok"
      ? t("adminClubs.applications.crm.syncedAt", { when: fmt(row.crm_synced_at) })
      : row.crm_last_attempt_at === null
        ? t("adminClubs.applications.crm.never")
        : t("adminClubs.applications.crm.lastAttempt", { when: fmt(row.crm_last_attempt_at) });

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge variant="outline" className={tone} title={row.crm_error ?? detail}>
        <Icon className="mr-1 h-3 w-3" aria-hidden="true" />
        {t("adminClubs.applications.crm.label")}: {t(`adminClubs.applications.crm.${state}`)}
      </Badge>
      <span className="text-[11px] text-muted-foreground">{detail}</span>
      {state === "ok" ? null : (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={props.retrying}
          onClick={() => props.onRetry(row.id)}
        >
          <RefreshCw
            className={`mr-1 h-3 w-3 ${props.retrying ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          {props.retrying
            ? t("adminClubs.applications.crm.retrying")
            : t("adminClubs.applications.crm.retry")}
        </Button>
      )}
    </span>
  );
}

function ApplicationRow(props: {
  row: ClubApplicationAdminRow;
  onStatus: (id: string, status: ClubApplicationStatus) => void;
  onRetryCrm: (id: string) => void;
  busy: boolean;
  retrying: boolean;
}) {
  const { row } = props;
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const lang = uiLang(i18n.language);
  const locale = uiLocale(i18n.language);
  const when = new Date(row.created_at).toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  // RPC podaje obie nazwy klubu, bo redakcja pracuje w dwoch jezykach. Wybor
  // z fallbackiem na druga wersje - klub moze miec wypelnione tylko jedno pole,
  // a wtedy lepsza jest nazwa w "obcym" jezyku niz puste miejsce w wierszu.
  const clubName =
    lang === "en" ? row.club_name_en || row.club_name_pl : row.club_name_pl || row.club_name_en;

  const detail = (labelKey: string, value: string | number | null): React.ReactNode =>
    value === null || value === "" ? null : (
      <div>
        <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          {t(labelKey)}
        </dt>
        <dd className="mt-0.5 break-words text-sm">{String(value)}</dd>
      </div>
    );

  return (
    <li className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
          aria-expanded={open}
        >
          <ChevronDown
            className={`mt-1 h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">
              {row.first_name} {row.last_name}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {row.email} · {row.company} · {row.job_position}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {when} · {row.specialization_slug}
              {clubName === null || clubName === "" ? "" : ` · ${clubName}`} · {row.tier_key}
            </span>
            <span className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
              <Mail className="h-3 w-3 shrink-0" aria-hidden="true" />
              {row.notify_error !== null
                ? t("adminClubs.applications.mail.error", { message: row.notify_error })
                : row.notified_status === null || row.notified_at === null
                  ? t("adminClubs.applications.mail.none")
                  : t("adminClubs.applications.mail.sent", {
                      status: t(`adminClubs.applications.status.${row.notified_status}`),
                      when: new Date(row.notified_at).toLocaleString(locale, {
                        dateStyle: "short",
                        timeStyle: "short",
                      }),
                    })}
            </span>
          </span>
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <CrmSyncChip row={row} onRetry={props.onRetryCrm} retrying={props.retrying} />
          <Badge variant="outline" className={statusTone(row.status)}>
            {t(`adminClubs.applications.status.${row.status}`)}
          </Badge>
          {STATUSES.filter((s) => s !== row.status).map((s) => (
            <Button
              key={s}
              size="sm"
              variant="outline"
              disabled={props.busy}
              onClick={() => props.onStatus(row.id, s)}
            >
              {t(`adminClubs.applications.setStatus.${s}`)}
            </Button>
          ))}
        </div>
      </div>

      {open ? (
        <dl className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-3">
          {detail("club.spec.apply.phone", row.phone)}
          {detail("club.spec.apply.country", row.country)}
          {detail("club.spec.apply.city", row.city)}
          {detail("club.spec.apply.seniority", row.seniority)}
          {detail("club.spec.apply.industry", row.industry)}
          {detail("club.spec.apply.years", row.years_experience)}
          {detail("club.spec.apply.linkedin", row.linkedin_url)}
          {detail("club.spec.apply.languages", row.languages)}
          {detail("club.spec.apply.availability", row.availability)}
          {detail("club.spec.apply.referral", row.referral_source)}
          <div className="sm:col-span-2 lg:col-span-3">
            {detail("club.spec.apply.expertise", row.expertise)}
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            {detail("club.spec.apply.motivation", row.motivation)}
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            {detail("club.spec.apply.goals", row.goals)}
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            {detail("club.spec.apply.contribution", row.contribution)}
          </div>
        </dl>
      ) : null}
    </li>
  );
}

export function ClubApplicationsInbox() {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const qc = useQueryClient();
  const specsQuery = useClubSpecializations();
  const [spec, setSpec] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");

  const countsQuery = useQuery({
    queryKey: applicationKeys.counts(),
    queryFn: fetchAdminClubApplicationCounts,
    staleTime: 30_000,
  });

  const listQuery = useQuery({
    queryKey: applicationKeys.list(spec, status, search),
    queryFn: () =>
      fetchAdminClubApplications({
        specialization: spec === "" ? null : spec,
        status: status === "" ? null : (status as ClubApplicationStatus),
        search: search === "" ? null : search,
      }),
    staleTime: 15_000,
  });

  const notify = useServerFn(notifyClubApplicationStatus);

  /**
   * Zmiana statusu i - dla decyzji, ktore kandydat musi poznac - powiadomienie
   * e-mail w jego jezyku. Blad wysylki NIE cofa decyzji: zapis statusu jest
   * zrodlem prawdy, a nieudana wysylka zostaje przy zgloszeniu jako widoczny
   * slad (`notify_error`) do ponowienia.
   */
  const mutation = useMutation({
    mutationFn: async ({ id, next }: { id: string; next: ClubApplicationStatus }) => {
      await setClubApplicationStatus(id, next);
      if (!isNotifiableStatus(next)) return { mailed: false as const };
      const res = await notify({ data: { applicationId: id, status: next } });
      return { mailed: true as const, res };
    },
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: applicationKeys.all });
      toast.success(t("adminClubs.applications.statusSaved"));
      if (!result.mailed) return;
      if (!result.res.ok) {
        toast.error(t("adminClubs.applications.mail.failed"));
        return;
      }
      toast.success(
        t(
          result.res.skipped === "duplicate"
            ? "adminClubs.applications.mail.duplicate"
            : "adminClubs.applications.mail.queued",
        ),
      );
    },
    // Kod z bazy zamiast jednego zdania na wszystko: cofniecie decyzji przy
    // innym OTWARTYM zgloszeniu tej osoby konczy sie `duplicate_open`, a to nie
    // jest awaria zapisu - operator ma zamknac tamto zgloszenie. Ogolny
    // `statusError` zostaje fallbackiem dla bledow, ktorych nie umiemy nazwac.
    onError: (error: unknown) => {
      const code = clubApplicationStatusErrorCode(error instanceof Error ? error.message : "");
      toast.error(
        code === "duplicate_open"
          ? t("adminClubs.applications.statusErrors.duplicate_open")
          : t("adminClubs.applications.statusError"),
      );
    },
  });

  const crmRetry = useMutation({
    mutationFn: (id: string) => retryClubApplicationCrmSync(id),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: applicationKeys.all });
      if (result.crm_sync_status === "ok") {
        toast.success(t("adminClubs.applications.crm.retryOk"));
      } else {
        toast.error(t("adminClubs.applications.crm.retryFailed"));
      }
    },
    onError: () => toast.error(t("adminClubs.applications.crm.retryFailed")),
  });

  const pendingBySpec = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of countsQuery.data ?? []) map.set(row.specialization_slug, row.pending);
    return map;
  }, [countsQuery.data]);

  const totalPending = (countsQuery.data ?? []).reduce((acc, row) => acc + row.pending, 0);

  const tabs = [
    { slug: "", label: t("adminClubs.applications.allTab"), pending: totalPending },
    ...(specsQuery.data ?? []).map((row) => ({
      slug: row.slug,
      label: lang === "en" ? row.label_en || row.label_pl : row.label_pl || row.label_en,
      pending: pendingBySpec.get(row.slug) ?? 0,
    })),
  ];

  const rows = listQuery.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Inbox className="h-4 w-4" aria-hidden="true" />
          {t("adminClubs.applications.title")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t("adminClubs.applications.lead")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="tabs-scroller flex gap-2 overflow-x-auto pb-1" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.slug === "" ? "all" : tab.slug}
              type="button"
              role="tab"
              aria-selected={spec === tab.slug}
              onClick={() => setSpec(tab.slug)}
              className={`whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
                spec === tab.slug
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
              {tab.pending > 0 ? (
                <span className="ml-2 rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
                  {tab.pending}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("adminClubs.applications.searchPlaceholder")}
              aria-label={t("adminClubs.applications.searchPlaceholder")}
              className="pl-9"
            />
          </div>
          <div className="w-[220px]">
            <FormSelect
              value={status}
              onValueChange={setStatus}
              options={[
                { value: "", label: t("adminClubs.applications.allStatuses") },
                ...STATUSES.map((s) => ({
                  value: s,
                  label: t(`adminClubs.applications.status.${s}`),
                })),
              ]}
              placeholder={t("adminClubs.applications.allStatuses")}
              aria-label={t("adminClubs.applications.allStatuses")}
            />
          </div>
        </div>

        {listQuery.isLoading ? (
          <p className="py-6 text-sm text-muted-foreground">
            {t("adminClubs.applications.loading")}
          </p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">{t("adminClubs.applications.empty")}</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <ApplicationRow
                key={row.id}
                row={row}
                busy={mutation.isPending}
                retrying={crmRetry.isPending && crmRetry.variables === row.id}
                onStatus={(id, next) => mutation.mutate({ id, next })}
                onRetryCrm={(id) => crmRetry.mutate(id)}
              />
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">{t("adminClubs.applications.crmNote")}</p>
      </CardContent>
    </Card>
  );
}
