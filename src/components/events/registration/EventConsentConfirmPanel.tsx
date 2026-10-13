// Organizm: potwierdzenie zgód marketingu/partnerów linkiem z maila (double
// opt-in, REG-02 / REG-14). Strona `/event-consent/confirm#token=…`.
//
// OTWARCIE LINKU NICZEGO NIE ZMIENIA. Skanery bezpieczeństwa w klientach
// pocztowych otwierają każdy adres z wiadomości; gdyby zgoda działa się przy
// wejściu, „potwierdzałby" ją skaner, a nie właściciel skrzynki - i dowód
// z art. 7 ust. 1 RODO byłby fikcją. Dlatego wejście tylko pokazuje PODGLĄD
// (wydarzenie, cele i DOKŁADNE teksty zgód z wersji linku), a zgodę udziela
// dopiero przycisk - osobne żądanie POST.
//
// TOKEN Z FRAGMENTU (`#token=`). Fragmentu przeglądarka nie wysyła na serwer
// (logi dostępu, `Referer`, podgląd linków w poczcie), więc token czytamy
// w przeglądarce po zamontowaniu i od razu wycieramy go z paska adresu
// (`history.replaceState`) - nie zostaje w historii ani w zakładce.
//
// STANY Z BAZY: open (podgląd + przycisk), already, expired, not_found. Awaria
// i okno wdrożenia to osobny stan „spróbuj ponownie" - nie udajemy, że link
// wygasł.
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Loader2, MailCheck, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  readConsentFragmentToken,
  type EventConsentConfirmResult,
  type EventConsentPreview,
} from "@/lib/events/eventConsent";
import { confirmEventConsent, previewEventConsent } from "@/lib/events/eventConsent.functions";
import { formatEventDateTime } from "@/lib/events/timezone";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { ensureEventRegistrationI18n } from "@/lib/i18n-event-registration";

ensureEventRegistrationI18n();

const PURPOSE_KEYS = {
  marketing: "eventRegistration.consentConfirm.purposes.marketing",
  partner_sharing: "eventRegistration.consentConfirm.purposes.partnerSharing",
} as const;

type Outcome = "confirmed" | "already" | "expired" | "not_found" | "error";

/** Wynik przycisku -> stan ekranu. Limit prób zostawia podgląd (komunikat obok). */
function outcomeOf(result: EventConsentConfirmResult): Outcome | null {
  if (result.ok) return result.state;
  if (result.state === "expired" || result.state === "not_found") return result.state;
  if (result.state === "rate_limited") return null;
  return "error";
}

export function EventConsentConfirmPanel() {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const preview = useServerFn(previewEventConsent);
  const confirm = useServerFn(confirmEventConsent);
  // `undefined` = fragment jeszcze nieprzeczytany (pierwszy render), `null` = brak tokenu.
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [rateLimited, setRateLimited] = useState(false);

  useEffect(() => {
    setToken(readConsentFragmentToken(window.location.hash));
    if (window.location.hash !== "") {
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    }
  }, []);

  const previewQuery = useQuery({
    // Token to poświadczenie: zostaje w pamięci tej karty, nie trafia do
    // żadnego trwałego cache - klucz zapytania rozdziela odpowiedzi.
    queryKey: ["event-consent-preview", token],
    queryFn: async (): Promise<EventConsentPreview | null> => {
      const result = await preview({ data: { token: token ?? "" } });
      if (!result.ok) throw new Error(result.reason);
      return result.preview;
    },
    enabled: typeof token === "string",
    retry: false,
    staleTime: Infinity,
  });

  const confirmM = useMutation({
    mutationFn: (value: string) => confirm({ data: { token: value } }),
    onSuccess: (result) => {
      setRateLimited(!result.ok && result.state === "rate_limited");
      setOutcome(outcomeOf(result));
    },
    onError: () => setOutcome("error"),
  });

  if (token === undefined || (token !== null && previewQuery.isPending)) {
    return (
      <div className="space-y-3" aria-busy="true">
        <p className="sr-only">{t("eventRegistration.consentConfirm.loading")}</p>
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const data = previewQuery.data ?? null;
  const state: Outcome | "open" =
    outcome ??
    (token === null
      ? "not_found"
      : previewQuery.isError || data === null
        ? "error"
        : data.state === "open"
          ? "open"
          : data.state);

  const event = data?.event ?? null;
  const eventTitle =
    event === null
      ? ""
      : pickLocalized({ title_pl: event.titlePl, title_en: event.titleEn }, "title", lang);

  return (
    <section className="space-y-6" aria-live="polite">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("eventRegistration.consentConfirm.title")}
        </h1>
        {state === "open" && (
          <p className="text-sm text-muted-foreground">
            {t("eventRegistration.consentConfirm.subtitle")}
          </p>
        )}
      </header>

      {eventTitle !== "" && (
        <div className="rounded-[6px] border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("eventRegistration.consentConfirm.eventLabel")}
          </p>
          <p className="mt-1 text-base font-medium text-foreground">{eventTitle}</p>
          {event?.startsAt ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {formatEventDateTime(event.startsAt, event.timezone, lang)}
            </p>
          ) : null}
        </div>
      )}

      {state === "open" && data !== null && token !== null && (
        <div className="space-y-4 rounded-[6px] border border-border bg-card p-4">
          <p className="text-sm font-medium text-foreground">
            {t("eventRegistration.consentConfirm.textsIntro")}
          </p>
          <ul className="space-y-3">
            {data.texts.map((text) => (
              <li key={text.purpose} className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(PURPOSE_KEYS[text.purpose])}
                </p>
                <blockquote className="border-l-2 border-primary/40 pl-3 text-sm text-foreground">
                  {text.body}
                </blockquote>
              </li>
            ))}
          </ul>
          {data.expiresAt !== null && (
            <p className="text-xs text-muted-foreground">
              {t("eventRegistration.consentConfirm.expiresAt", {
                date: formatEventDateTime(data.expiresAt, event?.timezone ?? null, lang),
              })}
            </p>
          )}
          {rateLimited && (
            <p role="alert" className="text-sm text-destructive">
              {t("eventRegistration.consentConfirm.rateLimited")}
            </p>
          )}
          <Button
            type="button"
            disabled={confirmM.isPending}
            onClick={() => confirmM.mutate(token)}
          >
            {confirmM.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <MailCheck className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {confirmM.isPending
              ? t("eventRegistration.consentConfirm.confirming")
              : t("eventRegistration.consentConfirm.confirm")}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t("eventRegistration.consentConfirm.withdrawHint")}
          </p>
        </div>
      )}

      {(state === "confirmed" || state === "already") && (
        <div className="space-y-2 rounded-[6px] border border-primary/40 bg-primary/5 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {t(
              state === "confirmed"
                ? "eventRegistration.consentConfirm.confirmedTitle"
                : "eventRegistration.consentConfirm.alreadyTitle",
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            {t(
              state === "confirmed"
                ? "eventRegistration.consentConfirm.confirmedBody"
                : "eventRegistration.consentConfirm.alreadyBody",
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("eventRegistration.consentConfirm.withdrawHint")}
          </p>
        </div>
      )}

      {(state === "expired" || state === "not_found" || state === "error") && (
        <div className="space-y-3 rounded-[6px] border border-border bg-card p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <XCircle className="h-4 w-4" aria-hidden="true" />
            {t(REFUSAL_COPY[state].title)}
          </p>
          <p className="text-sm text-muted-foreground">{t(REFUSAL_COPY[state].body)}</p>
          {state === "error" && token !== null && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setOutcome(null);
                void previewQuery.refetch();
              }}
            >
              {t("eventRegistration.consentConfirm.retry")}
            </Button>
          )}
        </div>
      )}

      <Link to="/" className="inline-block text-sm text-primary hover:underline">
        {t("eventRegistration.consentConfirm.backHome")}
      </Link>
    </section>
  );
}

/** Stan odmowy -> zdania (pełne literały kluczy dla bramki słowników). */
const REFUSAL_COPY = {
  expired: {
    title: "eventRegistration.consentConfirm.expiredTitle",
    body: "eventRegistration.consentConfirm.expiredBody",
  },
  not_found: {
    title: "eventRegistration.consentConfirm.notFoundTitle",
    body: "eventRegistration.consentConfirm.notFoundBody",
  },
  error: {
    title: "eventRegistration.consentConfirm.errorTitle",
    body: "eventRegistration.consentConfirm.errorBody",
  },
} as const;
