// Skrzynka zgloszen klubowych w panelu - KOMPOZYCJA.
//
// Uklad: zakladki = specjalizacje (bo to nimi steruje wejscie na hubie),
// w kazdej zakladce filtr statusu, wyszukiwarka i lista zgloszen z data oraz
// kartoteka kandydata. Liczniki nieprzeczytanych ("pending") sa przy zakladce,
// zeby redakcja widziala, gdzie zalega decyzja - bez wchodzenia w kazda z osma.
//
// CO ZOSTALO W TYM PLIKU PO WYPROWADZENIU REGUL. Wylacznie sklejenie: trzy
// zapytania, dwie mutacje i to, CO do nich jedzie oraz co panel robi
// z odpowiedzia. Reguly (filtry jako `null` zamiast `""`, zawezenie statusu
// ze selecta, nazwanie odmowy `duplicate_open`, deskryptor stanu CRM, stan
// poczty, lista pol kartoteki, zakladki z licznikami) mieszkaja
// w `lib/clubs/adminApplicationsInbox.ts`; jeden wiersz i pas zakladek -
// w molekulach `ClubInboxRow` i `ClubInboxSpecTabs`.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { uiLang } from "@/lib/i18n/format";
import { toast } from "sonner";
import { Inbox, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormSelect } from "@/components/atoms/FormSelect";
import { ClubInboxRow } from "@/components/admin/clubs/molecules/ClubInboxRow";
import { ClubInboxSpecTabs } from "@/components/admin/clubs/molecules/ClubInboxSpecTabs";
import {
  clubApplicationStatusErrorCode,
  fetchAdminClubApplicationCounts,
  fetchAdminClubApplications,
  retryClubApplicationCrmSync,
  setClubApplicationStatus,
  type ClubApplicationStatus,
} from "@/lib/clubs/applyApi";
import {
  isNotifiableStatus,
  notifyClubApplicationStatus,
} from "@/lib/clubs/applicationNotify.functions";
import { useServerFn } from "@tanstack/react-start";
import { useClubSpecializations } from "@/lib/clubs/useClubSpecializations";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";
import {
  APPLICATION_STATUSES,
  applicationInboxKeys,
  applicationListFilters,
  applicationMailToast,
  applicationSpecTabs,
  applicationStatusErrorKey,
  crmRetryToast,
  type InboxToast,
} from "@/lib/clubs/adminApplicationsInbox";

export function ClubApplicationsInbox() {
  ensureAdminClubsI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const qc = useQueryClient();
  const specsQuery = useClubSpecializations();
  const [spec, setSpec] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");

  /** Jedno miejsce na ton toastu - deskryptory z regul nie znaja `sonner`. */
  const announce = (info: InboxToast): void => {
    if (info.tone === "error") toast.error(t(info.key));
    else toast.success(t(info.key));
  };

  const countsQuery = useQuery({
    queryKey: applicationInboxKeys.counts(),
    queryFn: fetchAdminClubApplicationCounts,
    staleTime: 30_000,
  });

  const listQuery = useQuery({
    queryKey: applicationInboxKeys.list(spec, status, search),
    queryFn: () => fetchAdminClubApplications(applicationListFilters(spec, status, search)),
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
      void qc.invalidateQueries({ queryKey: applicationInboxKeys.all });
      toast.success(t("adminClubs.applications.statusSaved"));
      if (!result.mailed) return;
      announce(applicationMailToast(result.res));
    },
    // Kod z bazy zamiast jednego zdania na wszystko: cofniecie decyzji przy
    // innym OTWARTYM zgloszeniu tej osoby konczy sie `duplicate_open`, a to nie
    // jest awaria zapisu - operator ma zamknac tamto zgloszenie. Ogolny
    // `statusError` zostaje fallbackiem dla bledow, ktorych nie umiemy nazwac.
    onError: (error: unknown) => {
      const code = clubApplicationStatusErrorCode(error instanceof Error ? error.message : "");
      toast.error(t(applicationStatusErrorKey(code)));
    },
  });

  const crmRetry = useMutation({
    mutationFn: (id: string) => retryClubApplicationCrmSync(id),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: applicationInboxKeys.all });
      announce(crmRetryToast(result));
    },
    onError: () => toast.error(t("adminClubs.applications.crm.retryFailed")),
  });

  const tabs = applicationSpecTabs({
    specs: specsQuery.data,
    counts: countsQuery.data,
    lang,
    allLabel: t("adminClubs.applications.allTab"),
  });

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
        <ClubInboxSpecTabs tabs={tabs} active={spec} onSelect={setSpec} />

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
                ...APPLICATION_STATUSES.map((s) => ({
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
              <ClubInboxRow
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
