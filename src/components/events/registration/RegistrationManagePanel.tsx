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
//
// GNIAZDA TORÓW F1-F5 (spec B.11). Pod kartą stanu zgłoszenia (gdy stan jest
// znany) stoją trzy PUSTE gniazda: B (przekazanie, zwrot), A (przypomnienia
// i kalendarz), C (ankieta, certyfikat). Tory wypełniają swoje pliki gniazd;
// linie montażu są dla nich nietykalne.
//
// SKUTEK FINANSOWY PRZED POTWIERDZENIEM (REG-03, decyzja D9). Drugie kliknięcie
// pokazuje, co stanie się z wpłatą (`event_registration_cancel_preview`),
// i dopiero z wczytanym skutkiem wolno potwierdzić; rezygnacja odsyła skutek,
// który uczestnik zobaczył (`acknowledged_effect`). Odmowy znane z góry
// (zgłoszenie zamknięte, wydarzenie zakończone - REG-13, klucz wygasły) chowają
// przycisk i mówią zdaniem, zamiast czekać na błąd bazy.
//
// KLUCZ POZA ADRESAMI, KTÓRE WYCHODZĄ (REG-17). Przycisk „kopiuj" daje odnośnik
// z kluczem we fragmencie (`#token=`), a adres powrotu z kasy - samą stronę bez
// klucza: klucz czeka na powrót w `sessionStorage` karty (`onBeforeCheckout`).
// Klucz wygasły z końcem wydarzenia (podgląd `expired`) zostawia tylko zdanie,
// kartę wyłączenia SMS-ów i e-maili (przegląd R67: wycofanie zgody musi być
// możliwe zawsze) i gniazdo zgód - bez przycisków rezygnacji i kopiowania.
//
// ZGODY (REG-14). Pod resztą panelu stoi gniazdo wycofania zgód marketingu
// i partnerów (`ManageConsentsSlot`) - przy KAŻDYM kluczu, który nie jest
// nieznany: także po anulowaniu zgłoszenia i po końcu wydarzenia, bo zgodę
// wycofuje się w dowolnej chwili, a nie tylko do dnia wydarzenia.
//
// ZGODA NA PRZEKAZANIE DANYCH PARTNEROM WYCOFUJE SIĘ TU JEDNYM KLIKNIĘCIEM -
// tak samo, jak się jej udziela w formularzu zapisu (art. 7 ust. 3 RODO).
// Karta stoi tylko wtedy, gdy zgoda na TO wydarzenie jest skuteczna; samo
// otwarcie strony niczego nie zmienia, więc skaner poczty jej nie wycofa.
import { browserPublicOrigin } from "@/lib/http/host";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Info,
  Loader2,
  ShieldOff,
  XCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FieldBox } from "@/components/ui/field-box";
import { Skeleton } from "@/components/ui/skeleton";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { formatEventDateTime } from "@/lib/events/timezone";
import { formatMoney } from "@/lib/billing/types";
import { fetchEventPageHeader } from "@/lib/community/publicQueries";
import {
  cancelRegistration,
  loadRegistrationManageView,
  type RegistrationCancelResult,
  withdrawPartnerConsent,
} from "@/lib/events/publicRegistrationApi";
import {
  acknowledgedEffectFor,
  cancellationReady,
  type CancellationRefusal,
} from "@/lib/events/cancellationPreview";
import {
  cancellationPreviewKey,
  useCancellationPreview,
} from "@/lib/events/useCancellationPreview";
import { CancellationFinancialEffect } from "@/components/events/registration/molecules/CancellationFinancialEffect";
import { RegistrationPayAction } from "@/components/events/registration/molecules/RegistrationPayAction";
import { ChannelWithdrawCard } from "@/components/events/participant/molecules/ChannelWithdrawCard";
import { ManageCalendarRemindersSlot } from "@/components/events/participant/slots/ManageCalendarRemindersSlot";
import { ManageConsentsSlot } from "@/components/events/participant/slots/ManageConsentsSlot";
import { ManageFollowUpSlot } from "@/components/events/participant/slots/ManageFollowUpSlot";
import { ManageTicketActionsSlot } from "@/components/events/participant/slots/ManageTicketActionsSlot";
import {
  cancellationErrorMessage,
  isRefundTermsChanged,
  registrationErrorMessage,
} from "@/lib/events/publicRegistrationErrors";
import {
  isManageToken,
  manageLinkPath,
  managePagePath,
  stashManageTokenForReturn,
} from "@/lib/events/manageToken";
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

  const queryClient = useQueryClient();

  const [typed, setTyped] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [outcome, setOutcome] = useState<RegistrationCancelResult | null>(null);

  const headerQuery = useQuery({
    queryKey: ["event-page-header", slug, "manage"],
    queryFn: () => fetchEventPageHeader(slug),
    staleTime: 60_000,
  });

  const activeToken = token ?? (isManageToken(typed) ? typed.trim() : null);

  // STAN ZGLOSZENIA POD KLUCZEM. Bez tego zapytania strona pokazywala naglowek
  // wydarzenia i przycisk rezygnacji, a o samym zgloszeniu nie mowila nic -
  // niezaplacone zgloszenie nie mialo stad ZADNEJ drogi powrotu do kasy.
  //
  // Klucz jest POSWIADCZENIEM, wiec nie trafia do wspoldzielonego cache pod
  // golym slugiem: klucz w kluczu zapytania trzyma odpowiedzi rozdzielnie.
  const stateQuery = useQuery({
    queryKey: ["event-registration-manage-view", slug, activeToken],
    queryFn: () => loadRegistrationManageView({ manageToken: activeToken ?? "" }),
    enabled: activeToken !== null,
    staleTime: 15_000,
  });
  const state = stateQuery.data?.kind === "view" ? stateQuery.data.view : null;

  // SKUTEK REZYGNACJI pod tym samym kluczem zapytania, co gniazdo zasad zwrotu.
  const previewQuery = useCancellationPreview({ slug, manageToken: activeToken });
  const preview = previewQuery.data;
  const refusal: CancellationRefusal | null =
    preview?.kind === "ok" && !preview.canCancel ? preview.refusal : null;
  // Wygaśnięcie mówi KAŻDA z dwóch odpowiedzi - podgląd stanu i podgląd
  // rezygnacji (ta druga bywa niedostępna w oknie wdrożenia).
  const keyExpired = preview?.kind === "expired" || stateQuery.data?.kind === "expired";
  const keyUnknown = preview?.kind === "not_found";

  const cancelM = useMutation({
    mutationFn: (manageToken: string) => {
      const acknowledgedEffect = acknowledgedEffectFor(preview);
      return cancelRegistration(
        acknowledgedEffect === undefined ? { manageToken } : { manageToken, acknowledgedEffect },
      );
    },
    onSuccess: (result) => {
      setOutcome(result);
      setConfirming(false);
    },
    onError: (error: unknown) => {
      // Skutek się zmienił (termin minął w trakcie, organizator zmienił
      // zasadę, ktoś zwrócił wpłatę): zostawiamy pytanie otwarte z NOWYM
      // skutkiem do ponownego potwierdzenia. Każda inna odmowa wraca do
      // stanu wyjściowego - kolejne kliknięcie ma być znów świadome.
      void queryClient.invalidateQueries({ queryKey: cancellationPreviewKey(slug, activeToken) });
      if (isRefundTermsChanged(error)) {
        toast.error(t("eventRegistration.cancelRefund.termsChanged"));
        return;
      }
      setConfirming(false);
      toast.error(cancellationErrorMessage(error));
    },
  });

  const partnerM = useMutation({
    mutationFn: (manageToken: string) => withdrawPartnerConsent({ manageToken }),
    // Stan zgłoszenia czytamy na nowo - po wycofaniu baza mówi już „brak
    // zgody", a karta zostaje tylko po to, żeby pokazać potwierdzenie.
    onSuccess: () => void stateQuery.refetch(),
    onError: (error: unknown) => {
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
  const refundOutcome = outcome?.refund ?? null;

  async function copyManageLink(): Promise<void> {
    if (activeToken === null) return;
    try {
      await navigator.clipboard.writeText(
        `${browserPublicOrigin()}${manageLinkPath(slug, activeToken)}`,
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
          {outcome !== null && outcome.promotedFromWaitlist > 0 && (
            <p className="text-sm text-muted-foreground">
              {t("eventFront.manage.promoted", { count: outcome.promotedFromWaitlist })}
            </p>
          )}
          {refundOutcome?.jobState === "pending" && (
            <p className="text-sm text-muted-foreground">
              {refundOutcome.amountCents !== null && refundOutcome.currency !== null
                ? t("eventRegistration.cancelRefund.refundQueued", {
                    amount: formatMoney(refundOutcome.amountCents, refundOutcome.currency, lang),
                  })
                : t("eventRegistration.cancelRefund.refundQueuedPlain")}
            </p>
          )}
          {refundOutcome?.jobState === "needs_review" && (
            <p className="text-sm text-muted-foreground">
              {t("eventRegistration.cancelRefund.reviewQueued")}
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

          {activeToken !== null && keyExpired && (
            <p role="status" className="text-sm text-muted-foreground">
              {t("eventFront.manage.expired")}
            </p>
          )}

          {activeToken !== null && !keyExpired && stateQuery.isSuccess && state === null && (
            <p role="status" className="text-sm text-muted-foreground">
              {t("eventFront.manage.notFound")}
            </p>
          )}

          {state !== null && (
            <div className="space-y-3 rounded-[6px] border border-border bg-card p-4">
              <h2 className="text-sm font-semibold text-foreground">
                {t("eventFront.manage.stateTitle")}
              </h2>
              <p className="text-sm text-foreground">{statusSentence(state.status, state, t)}</p>
              {state.paymentStatus !== null && state.paymentStatus !== "not_required" && (
                <p className="text-sm text-muted-foreground">
                  {t(
                    state.paymentStatus === "paid"
                      ? "eventFront.manage.paymentPaid"
                      : state.paymentStatus === "unpaid"
                        ? "eventFront.manage.paymentUnpaid"
                        : state.paymentStatus === "partially_refunded"
                          ? "eventFront.manage.paymentPartiallyRefunded"
                          : "eventFront.manage.paymentRefunded",
                  )}
                </p>
              )}
              {/* DROGA POWROTNA DO KASY. Bez niej jedynym wyjsciem ze stanu
                  „nieoplacone" byl zapis DRUGI RAZ - czyli produkowanie
                  zduplikowanych wierszy, o ktore rozbijalo sie dopasowanie
                  wplaty (patrz `payments_apply_event_ticket_outcome`). */}
              {state.paymentStatus === "unpaid" && state.status !== "cancelled" && (
                <RegistrationPayAction
                  registrationId={state.registrationId}
                  eventId={state.eventId}
                  ticketTypeId={state.ticketTypeId}
                  amountCents={state.amountCents}
                  currency={state.currency}
                  returnPath={managePagePath(slug)}
                  onBeforeCheckout={() => {
                    if (activeToken !== null) stashManageTokenForReturn(slug, activeToken);
                  }}
                  intent="resume"
                  ownedByCaller={state.ownedByCaller}
                />
              )}
            </div>
          )}
          {state !== null && (
            <>
              <ManageTicketActionsSlot slug={slug} token={activeToken} view={state} />
              <ManageCalendarRemindersSlot slug={slug} token={activeToken} view={state} />
              <ManageFollowUpSlot slug={slug} token={activeToken} view={state} />
            </>
          )}

          {activeToken !== null && refusal !== null && !keyExpired && (
            <div className="space-y-3 rounded-[6px] border border-border bg-card p-4">
              <p className="flex items-start gap-2 text-sm text-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {t(REFUSAL_KEYS[refusal])}
              </p>
              <Button type="button" variant="secondary" onClick={() => void copyManageLink()}>
                <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
                {t("eventFront.manage.copyLink")}
              </Button>
            </div>
          )}

          {activeToken !== null &&
            state !== null &&
            (state.partnerConsent || partnerM.isSuccess) && (
              <div className="space-y-3 rounded-[6px] border border-border bg-card p-4">
                <h2 className="text-sm font-semibold text-foreground">
                  {t("eventFront.manage.partnerTitle")}
                </h2>
                {partnerM.isSuccess ? (
                  <p role="status" className="flex items-center gap-2 text-sm text-foreground">
                    <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {t("eventFront.manage.partnerWithdrawn")}
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      {t("eventFront.manage.partnerBody")}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={partnerM.isPending}
                      onClick={() => partnerM.mutate(activeToken)}
                    >
                      {partnerM.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <ShieldOff className="mr-2 h-4 w-4" aria-hidden="true" />
                      )}
                      {partnerM.isPending
                        ? t("eventFront.manage.partnerWithdrawing")
                        : t("eventFront.manage.partnerWithdraw")}
                    </Button>
                  </>
                )}
              </div>
            )}

          {activeToken !== null && refusal === null && !keyExpired && !keyUnknown && (
            <div className="space-y-4 rounded-[6px] border border-destructive/40 bg-destructive/5 p-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  {t("eventFront.manage.confirmTitle")}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("eventFront.manage.confirmBody")}
                </p>
              </div>

              {confirming && (
                <CancellationFinancialEffect
                  preview={preview}
                  isError={previewQuery.isError}
                  onRetry={() => void previewQuery.refetch()}
                  timezone={header?.timezone ?? null}
                />
              )}

              <div className="flex flex-wrap gap-2">
                {confirming ? (
                  <>
                    <Button
                      type="button"
                      variant="destructive"
                      // Potwierdzenie dopiero ze skutkiem na ekranie: bez niego
                      // baza i tak odmówi (`refund_ack_required`), a uczestnik
                      // nie wiedziałby, co potwierdza.
                      disabled={cancelM.isPending || !cancellationReady(preview)}
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

      {/* WYCOFANIE PO KONCU WYDARZENIA (przeglad R67). Klucz wygasly nie
          otwiera widoku zgloszenia, wiec gniazda nie rysuja sie wcale - a zgode
          na SMS-y i e-maile trzeba moc wycofac zawsze (baza przyjmuje na takim
          kluczu wylacznie wylaczenie). */}
      {activeToken !== null && keyExpired && (
        <ChannelWithdrawCard manageToken={activeToken} reason="expired" />
      )}
      {activeToken !== null && !keyUnknown && <ManageConsentsSlot token={activeToken} />}
    </section>
  );
}

/** Odmowa znana z podglądu -> zdanie (literały kluczy dla bramki słowników). */
const REFUSAL_KEYS: Record<CancellationRefusal, string> = {
  already_closed: "eventRegistration.cancelRefund.refusals.alreadyClosed",
  event_finished: "eventRegistration.cancelRefund.refusals.eventFinished",
  event_ended: "eventRegistration.cancelRefund.refusals.eventEnded",
};

/**
 * Stan zapisu -> zdanie dla uczestnika.
 *
 * Nieznany status czytamy jako `unknown`, a nie jako „przyjete": zdanie, ktore
 * obiecuje wejscie na podstawie wartosci, ktorej nie znamy, jest gorsze niz
 * przyznanie sie do niewiedzy.
 */
function statusSentence(
  status: string,
  state: { waitlistPosition: number | null },
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (status === "approved" || status === "attended") return t("eventFront.manage.stateApproved");
  if (status === "pending" || status === "draft") return t("eventFront.manage.statePending");
  if (status === "waitlist") {
    return t("eventFront.manage.stateWaitlist", { position: state.waitlistPosition ?? 0 });
  }
  if (status === "cancelled") return t("eventFront.manage.stateCancelled");
  if (status === "rejected") return t("eventFront.manage.stateRejected");
  return t("eventFront.manage.stateUnknown");
}
