// Molekula: zgody i dane z zapisu w rozwinieciu wiersza zgloszenia
// (REG-02 / REG-14).
//
// CO WIDZI ORGANIZATOR:
//   * ROZNICE - niezweryfikowany zapis na istniejaca osobe nie przepisuje
//     kartoteki; to, co przyslano, stoi obok tego, co jest (pole po polu),
//     z przyciskiem przeniesienia. Przeniesienie to swiadoma decyzja
//     organizatora i idzie TYM SAMYM zapisem co reczna edycja
//     (`admin_event_registration_upsert`, wylacznie roznice);
//   * OTWARTY LINK DOI - plakietka „czeka na potwierdzenie": zgoda marketingu
//     albo partnerow jeszcze NIE obowiazuje;
//   * KSIEGA ZGOD OSOBY - kazde udzielenie, prosba i wycofanie z kanalem
//     dowodu, tekstem i wersja (art. 7 ust. 1 RODO: organizator musi umiec
//     wykazac zgode).
//
// Dane ladujemy dopiero po rozwinieciu - lista zgloszen w dniu wydarzenia ma
// setki wierszy, a ksiega jest potrzebna w pojedynczych przypadkach.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { adminRegistrationErrorMessage } from "@/lib/events/adminRegistrationErrors";
import {
  applySubmittedProfile,
  fetchRegistrationConsentDetail,
  type RegistrationConsentDetail as Detail,
} from "@/lib/events/registrationsApi";
import { registrationKeys } from "@/lib/events/useEventRegistrations";
import { formatDateTime } from "@/lib/i18n/format";
import { ensureI18n as ensureAdminEventRegistrationI18n } from "@/lib/i18n-admin-event-registration";

ensureAdminEventRegistrationI18n();

const BASE = "adminEventRegistration.consentDetail";

/** Klucz zapytania szczegolu (jeden na zgloszenie - odswiezany po przeniesieniu). */
function registrationConsentDetailKey(registrationId: string) {
  return ["admin-event-registration-consent-detail", registrationId] as const;
}

export function RegistrationConsentDetail({
  eventId,
  registrationId,
}: {
  eventId: string;
  registrationId: string;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const detailQuery = useQuery({
    queryKey: registrationConsentDetailKey(registrationId),
    queryFn: () => fetchRegistrationConsentDetail(registrationId),
    staleTime: 15_000,
  });

  const applyM = useMutation({
    mutationFn: (detail: Detail) => applySubmittedProfile(detail),
    onSuccess: async () => {
      toast.success(t(`${BASE}.applied`));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: registrationConsentDetailKey(registrationId) }),
        queryClient.invalidateQueries({ queryKey: registrationKeys.event(eventId) }),
      ]);
    },
    onError: (error: unknown) => toast.error(adminRegistrationErrorMessage(error)),
  });

  if (detailQuery.isPending) {
    return (
      <p className="text-sm text-muted-foreground" aria-busy="true">
        {t(`${BASE}.loading`)}
      </p>
    );
  }
  if (detailQuery.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t(`${BASE}.loadError`)}
      </p>
    );
  }

  const detail = detailQuery.data;
  const date = (value: string | null): string =>
    value === null ? "" : formatDateTime(value, i18n.language);

  return (
    <div className="space-y-4 rounded-md border border-border bg-muted/30 p-3 text-sm">
      {detail.openConfirmation !== null && (
        <Badge variant="secondary">
          {t(`${BASE}.pending`, { date: date(detail.openConfirmation.expiresAt) })}
        </Badge>
      )}

      {detail.differs && detail.submittedProfile !== null ? (
        <div className="space-y-2">
          <p className="font-medium text-foreground">{t(`${BASE}.differsTitle`)}</p>
          <p className="text-xs text-muted-foreground">{t(`${BASE}.differsHint`)}</p>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th scope="col" className="py-1 pr-2 font-medium">
                  {t(`${BASE}.field`)}
                </th>
                <th scope="col" className="py-1 pr-2 font-medium">
                  {t(`${BASE}.current`)}
                </th>
                <th scope="col" className="py-1 font-medium">
                  {t(`${BASE}.submitted`)}
                </th>
              </tr>
            </thead>
            <tbody>
              {detail.differences.map((field) => (
                <tr key={field} className="border-t border-border">
                  <th scope="row" className="py-1 pr-2 font-normal text-muted-foreground">
                    {t(`${BASE}.fields.${field}`)}
                  </th>
                  <td className="py-1 pr-2 text-foreground">{detail.current[field] ?? "-"}</td>
                  <td className="py-1 text-foreground">
                    {detail.submittedProfile?.[field] ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={applyM.isPending}
            onClick={() => applyM.mutate(detail)}
          >
            {applyM.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            {applyM.isPending ? t(`${BASE}.applying`) : t(`${BASE}.apply`)}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t(`${BASE}.noDifferences`)}</p>
      )}

      <div className="space-y-1">
        <p className="font-medium text-foreground">{t(`${BASE}.ledgerTitle`)}</p>
        {detail.ledger.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t(`${BASE}.ledgerEmpty`)}</p>
        ) : (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {detail.ledger.map((entry) => (
              <li key={entry.id}>
                {[
                  date(entry.createdAt),
                  t(`${BASE}.purposes.${entry.purpose}`, { defaultValue: entry.purpose }),
                  t(`${BASE}.statuses.${entry.status}`, { defaultValue: entry.status }),
                  t(`${BASE}.ledgerEvidence`, {
                    evidence: t(`${BASE}.evidences.${entry.evidence}`, {
                      defaultValue: entry.evidence,
                    }),
                  }),
                  entry.textVersion === null
                    ? ""
                    : t(`${BASE}.ledgerText`, {
                        version: entry.textVersion,
                        lang: entry.textLang ?? "",
                      }),
                ]
                  .filter((part) => part !== "")
                  .join(" · ")}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
