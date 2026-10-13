// Organizm: zgody dla organizatora wydarzeń na /profile/privacy (REG-14).
//
// PO CO OSOBNA SEKCJA. Katalog zgód konta (`ConsentsPanel`, `set_user_consent`)
// to zgody PLATFORMY. Zgody zaznaczane przy zapisie na wydarzenie żyją
// w osobnej księdze (`event_consent_records`) i do tej pory nie dało się ich
// ani zobaczyć, ani wycofać z konta - jedyną drogą był mail do organizatora.
// Art. 7 ust. 3 RODO: wycofanie ma być równie łatwe jak udzielenie.
//
// STAN Z KSIĘGI, NIE Z FORMULARZA. Sekcja pokazuje projekcję (co obowiązuje),
// otwarty link double opt-in (zgoda czeka na potwierdzenie w mailu) i 20
// ostatnich wpisów księgi z kanałem dowodu - art. 15 RODO. Skrótu adresu IP
// i przeglądarki baza tu nie oddaje (to dowód dla organizatora).
//
// WYCOFANIE Z SESJI. Osobę wskazuje wyłącznie konto (serwer czyta je z sesji,
// baza - dowiązaną kartotekę); przeglądarka podaje tylko cele.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { EventConsentEvidence, EventConsentPurpose } from "@/lib/events/consentTexts";
import {
  hasActiveGrant,
  type EventConsentWithdrawResult,
  type EventConsentWithdrawScope,
  type MyEventConsentState,
} from "@/lib/events/eventConsent";
import { listMyEventConsents, withdrawEventConsents } from "@/lib/events/eventConsent.functions";
import { formatDateTime, uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { ensureI18n as ensureProfileI18n } from "@/lib/i18n-profile";

const BASE = "profile.privacy.eventConsents";

/** Klucz zapytania - eksportowany dla testów i odświeżenia po wycofaniu. */
export const MY_EVENT_CONSENTS_KEY = ["my-event-consents"] as const;

const PURPOSE_KEYS: Record<EventConsentPurpose, string> = {
  data_processing: `${BASE}.purposes.dataProcessing`,
  marketing: `${BASE}.purposes.marketing`,
  partner_sharing: `${BASE}.purposes.partnerSharing`,
};

const STATUS_KEYS = {
  pending: `${BASE}.statuses.pending`,
  confirmed: `${BASE}.statuses.confirmed`,
  withdrawn: `${BASE}.statuses.withdrawn`,
} as const;

const EVIDENCE_KEYS: Record<EventConsentEvidence, string> = {
  registration_form: `${BASE}.evidences.registrationForm`,
  verified_account: `${BASE}.evidences.verifiedAccount`,
  email_double_opt_in: `${BASE}.evidences.emailDoubleOptIn`,
  manage_token: `${BASE}.evidences.manageToken`,
  account_settings: `${BASE}.evidences.accountSettings`,
  unsubscribe_link: `${BASE}.evidences.unsubscribeLink`,
  legacy_single_opt_in: `${BASE}.evidences.legacySingleOptIn`,
};

const WITHDRAW_BUTTONS: Record<EventConsentWithdrawScope, string> = {
  marketing: `${BASE}.withdrawMarketing`,
  partner_sharing: `${BASE}.withdrawPartner`,
  all: `${BASE}.withdrawAll`,
};

function resultKey(result: EventConsentWithdrawResult): string {
  if (result.ok) return `${BASE}.done`;
  return result.reason === "rate_limited" ? `${BASE}.rateLimited` : `${BASE}.failed`;
}

export function EventOrganizerConsentsSection() {
  ensureProfileI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const queryClient = useQueryClient();
  const list = useServerFn(listMyEventConsents);
  const withdraw = useServerFn(withdrawEventConsents);
  const [asked, setAsked] = useState<EventConsentWithdrawScope | null>(null);
  const [message, setMessage] = useState<{ key: string; ok: boolean } | null>(null);

  const stateQuery = useQuery({
    queryKey: MY_EVENT_CONSENTS_KEY,
    queryFn: async (): Promise<MyEventConsentState> => {
      const result = await list();
      if (!result.ok) throw new Error(result.reason);
      return result.state;
    },
    staleTime: 30_000,
    retry: false,
  });

  const withdrawM = useMutation({
    mutationFn: (purposes: EventConsentWithdrawScope) => withdraw({ data: { purposes } }),
    onSuccess: (result) => {
      setMessage({ key: resultKey(result), ok: result.ok });
      void queryClient.invalidateQueries({ queryKey: MY_EVENT_CONSENTS_KEY });
    },
    onError: () => setMessage({ key: `${BASE}.failed`, ok: false }),
    onSettled: () => setAsked(null),
  });

  const date = (value: string | null): string =>
    value === null ? "" : formatDateTime(value, i18n.language);

  const state = stateQuery.data ?? null;
  const consents = state?.consents ?? null;
  const open = state?.openConfirmation ?? null;

  const statusLine = (since: string | null): string =>
    since === null ? t(`${BASE}.inactive`) : t(`${BASE}.activeSince`, { date: date(since) });

  const scopes: EventConsentWithdrawScope[] = [];
  if (consents?.marketingAt) scopes.push("marketing");
  if (consents?.partnerSharingAt) scopes.push("partner_sharing");
  if (scopes.length === 2) scopes.push("all");

  return (
    <section aria-labelledby="privacy-event-consents-heading" className="space-y-3">
      <div className="space-y-1">
        <h4 id="privacy-event-consents-heading" className="text-sm font-semibold text-foreground">
          {t(`${BASE}.title`)}
        </h4>
        <p className="text-xs leading-relaxed text-muted-foreground">{t(`${BASE}.hint`)}</p>
      </div>

      {stateQuery.isPending ? (
        <p className="text-sm text-muted-foreground" aria-busy="true">
          {t(`${BASE}.loading`)}
        </p>
      ) : stateQuery.isError || state === null ? (
        <p role="alert" className="text-sm text-destructive">
          {t(`${BASE}.loadError`)}
        </p>
      ) : !state.linked ? (
        <p className="text-sm text-muted-foreground">{t(`${BASE}.notLinked`)}</p>
      ) : (
        <div className="space-y-4 rounded-lg border border-border p-4">
          <dl className="grid gap-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
            <dt className="text-foreground">{t(`${BASE}.marketing`)}</dt>
            <dd className="text-muted-foreground">{statusLine(consents?.marketingAt ?? null)}</dd>
            <dt className="text-foreground">{t(`${BASE}.partnerSharing`)}</dt>
            <dd className="text-muted-foreground">
              {statusLine(consents?.partnerSharingAt ?? null)}
            </dd>
          </dl>
          {consents?.withdrawnAt ? (
            <p className="text-xs text-muted-foreground">
              {t(`${BASE}.withdrawnAll`, { date: date(consents.withdrawnAt) })}
            </p>
          ) : null}
          {open !== null ? (
            <p className="text-xs text-muted-foreground">
              {t(`${BASE}.pending`, { date: date(open.expiresAt) })}
            </p>
          ) : null}

          {hasActiveGrant(consents) ? (
            <div className="flex flex-wrap gap-2">
              {scopes.map((scope) => (
                <Button
                  key={scope}
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={withdrawM.isPending}
                  onClick={() => {
                    setMessage(null);
                    setAsked(scope);
                  }}
                >
                  {t(WITHDRAW_BUTTONS[scope])}
                </Button>
              ))}
            </div>
          ) : null}
          {message !== null && (
            <p
              role={message.ok ? "status" : "alert"}
              className={message.ok ? "text-sm text-foreground" : "text-sm text-destructive"}
            >
              {t(message.key)}
            </p>
          )}

          <div className="space-y-2">
            <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t(`${BASE}.historyTitle`)}
            </h5>
            {state.ledger.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t(`${BASE}.historyEmpty`)}</p>
            ) : (
              <ul className="space-y-1 text-xs text-muted-foreground">
                {state.ledger.map((entry, index) => {
                  const event = pickLocalized(
                    { title_pl: entry.eventTitlePl, title_en: entry.eventTitleEn },
                    "title",
                    lang,
                  );
                  return (
                    <li key={`${entry.createdAt}-${entry.purpose}-${index}`}>
                      {[
                        date(entry.createdAt),
                        t(PURPOSE_KEYS[entry.purpose]),
                        t(STATUS_KEYS[entry.status]),
                        t(EVIDENCE_KEYS[entry.evidence]),
                        event,
                      ]
                        .filter((part) => part !== "")
                        .join(" · ")}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      <AlertDialog
        open={asked !== null}
        onOpenChange={(value) => {
          if (!value && !withdrawM.isPending) setAsked(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${BASE}.confirmTitle`)}</AlertDialogTitle>
            <AlertDialogDescription>{t(`${BASE}.confirmBody`)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={withdrawM.isPending}>{t(`${BASE}.cancel`)}</AlertDialogCancel>
            <AlertDialogAction
              disabled={withdrawM.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (asked !== null) withdrawM.mutate(asked);
              }}
            >
              {withdrawM.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              {withdrawM.isPending ? t(`${BASE}.working`) : t(`${BASE}.confirm`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
