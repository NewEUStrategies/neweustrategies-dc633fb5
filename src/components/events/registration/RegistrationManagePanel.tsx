// Organizm: samoobsługa zgłoszenia po kluczu `manage_token`.
//
// GOŚĆ BEZ KONTA MUSI MÓC SIĘ WYPISAĆ SAM. To jedyna droga: `event_register`
// wiąże zgłoszenie z kontem tylko wtedy, gdy ktoś był zalogowany, a reszta
// uczestników ma wyłącznie ten klucz. Bez tej strony rezygnacja oznaczałaby
// mail do organizatora i ręczną zmianę statusu.
//
// OTWARCIE ODNOŚNIKA NICZEGO NIE ZMIENIA. Skanery bezpieczeństwa w klientach
// pocztowych odwiedzają każdy adres z wiadomości; gdyby rezygnacja działa się
// przy wejściu na stronę, połowa uczestników straciłaby miejsce, zanim
// przeczytałaby maila. Dlatego wejście tylko POKAZUJE zgłoszenie, a odwołanie
// wymaga drugiego, świadomego kliknięcia - ten sam wzorzec, co wypisanie
// z newslettera.
//
// KONTEKST BIERZE SIĘ ZE SLUGA, NIE Z KLUCZA. Nagłówek wydarzenia czytamy
// publicznym `event_page_header`, więc uczestnik widzi, CZEGO dotyczy
// rezygnacja, a klucz nie musi w tym celu wyjeżdżać do żadnego dodatkowego
// zapytania.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Copy, Loader2, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FieldBox } from "@/components/ui/field-box";
import { Skeleton } from "@/components/ui/skeleton";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { formatEventDateTime } from "@/lib/events/timezone";
import { fetchEventPageHeader } from "@/lib/community/publicQueries";
import { cancelRegistration } from "@/lib/events/publicRegistrationApi";
import { registrationErrorMessage } from "@/lib/events/publicRegistrationErrors";
import { isManageToken, manageLinkPath } from "@/lib/events/manageToken";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";
import { ensureEventRegistrationI18n } from "@/lib/i18n-event-registration";

ensureEventFrontI18n();
ensureEventRegistrationI18n();

export function RegistrationManagePanel({
  slug,
  token,
}: {
  slug: string;
  /** Klucz z adresu albo `null`, gdy odnośnik przyszedł bez niego. */
  token: string | null;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);

  const [typed, setTyped] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [promoted, setPromoted] = useState<number | null>(null);

  const headerQuery = useQuery({
    queryKey: ["event-page-header", slug, "manage"],
    queryFn: () => fetchEventPageHeader(slug),
    staleTime: 60_000,
  });

  const activeToken = token ?? (isManageToken(typed) ? typed.trim() : null);

  const cancelM = useMutation({
    mutationFn: (manageToken: string) => cancelRegistration({ manageToken }),
    onSuccess: (result) => {
      setPromoted(result.promotedFromWaitlist);
      setConfirming(false);
    },
    onError: (error: unknown) => {
      setConfirming(false);
      toast.error(registrationErrorMessage(error));
    },
  });

  const header = headerQuery.data ?? null;
  const eventTitle = pickLocalized(
    { title_pl: header?.title_pl ?? null, title_en: header?.title_en ?? null },
    "title",
    lang,
  );
  const when = header === null ? "" : formatEventDateTime(header.starts_at, header.timezone, lang);

  async function copyManageLink(): Promise<void> {
    if (activeToken === null) return;
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${manageLinkPath(slug, activeToken)}`,
      );
      toast.success(t("eventFront.manage.copied"));
    } catch {
      // Schowek bywa odcięty uprawnieniami - odnośnik i tak stoi w pasku adresu.
      toast.error(t("eventFront.manage.manageLink"));
    }
  }

  if (headerQuery.isPending) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <section className="space-y-6" aria-live="polite">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("eventFront.manage.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("eventFront.manage.subtitle")}</p>
      </header>

      {eventTitle !== "" && (
        <div className="rounded-[6px] border border-border bg-card p-4">
          <p className="text-base font-medium text-foreground">{eventTitle}</p>
          {when !== "" && <p className="mt-1 text-sm text-muted-foreground">{when}</p>}
          <Link
            to="/events/$slug"
            params={{ slug }}
            className="mt-3 inline-block text-sm text-primary hover:underline"
          >
            {t("eventFront.manage.backToEvent")}
          </Link>
        </div>
      )}

      {cancelM.isSuccess ? (
        <div className="space-y-3 rounded-[6px] border border-primary/40 bg-primary/5 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {t("eventFront.manage.cancelled")}
          </p>
          {promoted !== null && promoted > 0 && (
            <p className="text-sm text-muted-foreground">
              {t("eventFront.manage.promoted", { count: promoted })}
            </p>
          )}
        </div>
      ) : (
        <>
          {token === null && (
            <div className="space-y-3 rounded-[6px] border border-border bg-card p-4">
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {t("eventFront.manage.missingToken")}
              </p>
              <FieldBox
                label={t("eventFront.manage.tokenLabel")}
                value={typed}
                autoComplete="off"
                spellCheck={false}
                placeholder={t("eventFront.manage.tokenPlaceholder")}
                onChange={(event) => setTyped(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("eventFront.manage.tokenHint")}</p>
            </div>
          )}

          {activeToken !== null && (
            <div className="space-y-4 rounded-[6px] border border-destructive/40 bg-destructive/5 p-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  {t("eventFront.manage.confirmTitle")}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("eventFront.manage.confirmBody")}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {confirming ? (
                  <>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={cancelM.isPending}
                      onClick={() => cancelM.mutate(activeToken)}
                    >
                      {cancelM.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <XCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                      )}
                      {cancelM.isPending
                        ? t("eventFront.manage.confirming")
                        : t("eventFront.manage.confirm")}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
                      {t("eventFront.manage.keep")}
                    </Button>
                  </>
                ) : (
                  <Button type="button" variant="destructive" onClick={() => setConfirming(true)}>
                    <XCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                    {t("eventFront.manage.confirm")}
                  </Button>
                )}

                <Button type="button" variant="secondary" onClick={() => void copyManageLink()}>
                  <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
                  {t("eventFront.manage.copyLink")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("eventFront.manage.manageLinkHint")}
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
