// Organizm: „Moje zgłoszenia" - status zapisu, historia zdarzeń płatności,
// wyraźny powód anulowania/zwrotu oraz centrum kanałów per zgłoszenie.
//
// POWÓD JEST TREŚCIĄ, NIE ETYKIETĄ. Do tej pory uczestnik widział wyłącznie
// słowo „anulowane" i pisał do organizatora z pytaniem „dlaczego". Karta
// nazywa zdarzenie zdaniem (kto, kiedy, ile wróciło) i dopiero pod spodem
// pokazuje surowy ślad zdarzeń operatora dla tych, którzy chcą dowodu.
//
// PORTFEL TYLKO ZE STRONY BILETU. Baza trzyma wyłącznie skrót kodu QR, więc
// ta lista nie ma z czego złożyć przepustki Apple/Google Wallet. Przy bilecie
// ważnym (przyjęty albo obecny, opłacony albo bezpłatny) karta mówi więc,
// skąd ją dodać - z linku do strony biletu w mailu.
//
// KANAŁY SĄ PER ZGŁOSZENIE. Przełączniki piszą do
// `event_registration_set_channels`, a wysyłka transakcyjna czyta te same
// kolumny - to jedna prawda, nie dwie.
//
// SMS TYLKO ZA ZGODĄ (REG-10, D12). Włączenie SMS-a otwiera `SmsConsentConfirm`
// i dopiero zgoda wysyła `notify_sms: true` z `sms_consent: true`; wyłączenie
// idzie od razu. Gdy platforma nie wysyła SMS-ów, przełącznika nie da się
// włączyć (wyłączyć - zawsze). Odmowy bazy (`sms_consent_required`,
// `phone_required`, ...) mają własne zdania (`channelErrorKey`).
//
// GNIAZDA TORÓW F1-F5 (spec B.11). Karta ma trzy PUSTE gniazda, które
// wypełniają tory: B pod sekcją płatności (oferta, przekazanie, zwrot),
// A pod kanałami (przypomnienia), C nad dziennikiem płatności (ankieta,
// certyfikat). Linie montażu gniazd są nietykalne dla torów.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  channelErrorKey,
  fetchMyRegistrations,
  setRegistrationChannels,
  type ParticipantRegistration,
} from "@/lib/events/participantTicketsApi";
import {
  registrationPreferencesKey,
  useParticipantSmsAvailable,
  useRegistrationPreferences,
} from "@/lib/events/useRegistrationPreferences";
import { SmsConsentConfirm } from "@/components/events/participant/molecules/SmsConsentConfirm";
import { RegistrationPayAction } from "@/components/events/registration/molecules/RegistrationPayAction";
import { EventInvoiceTicketStatus } from "@/components/events/invoices/atoms/EventInvoiceTicketStatus";
import { RegistrationCardActionsSlot } from "@/components/events/participant/slots/RegistrationCardActionsSlot";
import { RegistrationCardFollowUpSlot } from "@/components/events/participant/slots/RegistrationCardFollowUpSlot";
import { RegistrationCardRemindersSlot } from "@/components/events/participant/slots/RegistrationCardRemindersSlot";
import { ensureI18n } from "@/lib/i18n-participant-tickets";
import { ensureEventWalletI18n } from "@/lib/i18n-event-wallet";

ensureI18n();
ensureEventWalletI18n();

const QUERY_KEY = ["profile", "event-registrations"] as const;

/** Stany, w których bilet działa przy bramce (jak `event_ticket_wallet_payload`). */
const WALLET_STATUSES: ReadonlySet<string> = new Set(["approved", "attended"]);
const WALLET_PAYMENTS: ReadonlySet<string> = new Set(["paid", "not_required"]);

function statusKey(status: string): string {
  if (status === "approved" || status === "confirmed") return "approved";
  if (status === "waitlist" || status === "waitlisted") return "waitlist";
  if (status === "cancelled" || status === "canceled") return "cancelled";
  if (status === "rejected") return "rejected";
  if (status === "pending") return "pending";
  return "unknown";
}

/** Płatność gościa opłaconego zamówieniem prowadzącego - po samym `payment_status`. */
function sharedPaymentLabel(paymentStatus: string | null, t: (key: string) => string): string {
  if (paymentStatus === "refunded") return t("participantTickets.payment.refunded");
  if (paymentStatus === "partially_refunded") return t("participantTickets.payment.partial");
  if (paymentStatus === "paid") return t("participantTickets.payment.paidByGroup");
  return t("participantTickets.payment.unpaid");
}

function money(cents: number | null, currency: string | null, locale: string): string {
  if (cents === null) return "-";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: (currency ?? "PLN").toUpperCase(),
  }).format(cents / 100);
}

function RegistrationCard({ item }: { item: ParticipantRegistration }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const isEn = i18n.language?.startsWith("en") === true;
  const locale = isEn ? "en-GB" : "pl-PL";
  const title = (isEn ? item.eventTitleEn : item.eventTitlePl) ?? item.eventSlug;

  const smsAvailable = useParticipantSmsAvailable();
  const [smsConsentOpen, setSmsConsentOpen] = useState(false);
  // ZGODA NA NUMER, KTÓRY POKAZANO (przegląd R67). Okno zgody czyta
  // podpowiedź numeru z preferencji tego zgłoszenia - dopiero przy otwarciu,
  // ten sam wpis cache co karta przypomnień - i odsyła ją z potwierdzeniem.
  // Numer zmieniony w tle daje odmowę `phone_changed` zamiast zgody na numer,
  // którego uczestnik nie widział. Bez wczytanych preferencji (baza sprzed
  // migracji, błąd) podpowiedź nie jedzie wcale.
  const consentPrefs = useRegistrationPreferences({
    registrationId: item.registrationId,
    enabled: smsConsentOpen,
  });
  const consentPrefsData = consentPrefs.data?.kind === "ok" ? consentPrefs.data : null;

  const channels = useMutation({
    mutationFn: (patch: {
      notifyEmail?: boolean;
      notifySms?: boolean;
      smsConsent?: boolean;
      phoneHint?: string | null;
    }) => setRegistrationChannels({ registrationId: item.registrationId, ...patch }),
    onSuccess: () => {
      toast.success(t("participantTickets.channels.saved"));
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      // Karta przypomnień tego zgłoszenia czyta `notify_*` ze swojego wpisu.
      void queryClient.invalidateQueries({
        queryKey: registrationPreferencesKey(item.registrationId),
      });
    },
    onError: (error: unknown) => toast.error(t(channelErrorKey(error))),
    onSettled: () => setSmsConsentOpen(false),
  });
  // Wyłączyć SMS można zawsze; włączyć - tylko gdy platforma je wysyła.
  const smsLocked = !item.notifySms && !smsAvailable;

  const fullyRefunded =
    item.amountCents !== null && item.amountCents > 0 && item.refundedCents >= item.amountCents;
  const partiallyRefunded = item.refundedCents > 0 && !fullyRefunded;

  // Gość grupy (płaci prowadzący) nie dostaje z bazy kwoty zamówienia - pusta
  // kwota NIE znaczy tu „bezpłatne", tylko „opłacone cudzym zamówieniem".
  const paymentLabel = item.paymentShared
    ? sharedPaymentLabel(item.paymentStatus, t)
    : item.amountCents === null || item.amountCents === 0
      ? t("participantTickets.payment.free")
      : fullyRefunded
        ? t("participantTickets.payment.refunded")
        : partiallyRefunded
          ? t("participantTickets.payment.partial")
          : item.paymentStatus === "paid"
            ? t("participantTickets.payment.paid")
            : t("participantTickets.payment.unpaid");

  const reasonSentence = item.cancelledAt
    ? t("participantTickets.reason.cancelled", {
        date: new Date(item.cancelledAt).toLocaleString(locale),
      })
    : fullyRefunded
      ? t("participantTickets.reason.refunded")
      : partiallyRefunded
        ? t("participantTickets.reason.partial")
        : t("participantTickets.reason.none");

  return (
    <article className="space-y-4 rounded-[6px] border border-border bg-card p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-foreground">{title}</h2>
          {item.eventStartsAt !== null && (
            <p className="text-sm text-muted-foreground">
              {new Date(item.eventStartsAt).toLocaleString(locale)}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {t(`participantTickets.status.${statusKey(item.status)}`)}
          </Badge>
          <Badge variant="outline">{paymentLabel}</Badge>
          <Link
            to="/events/$slug"
            params={{ slug: item.eventSlug }}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t("participantTickets.openEvent")}
          </Link>
          {/* Faktura na firme za ten bilet: numer, prosba albo mozliwosc prosby. */}
          <EventInvoiceTicketStatus registrationId={item.registrationId} />
        </div>
      </header>

      <dl className="grid gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("participantTickets.payment.amount")}
          </dt>
          <dd className="text-sm text-foreground">
            {money(item.amountCents, item.currency, locale)}
          </dd>
        </div>
        {item.refundedCents > 0 && (
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("participantTickets.payment.refundedAmount")}
            </dt>
            <dd className="text-sm text-foreground">
              {money(item.refundedCents, item.currency, locale)}
            </dd>
          </div>
        )}
        {item.waitlistPosition !== null && (
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("participantTickets.status.waitlist")}
            </dt>
            <dd className="text-sm text-foreground">
              {t("participantTickets.waitlistPosition", { position: item.waitlistPosition })}
            </dd>
          </div>
        )}
      </dl>

      {WALLET_STATUSES.has(item.status) && WALLET_PAYMENTS.has(item.paymentStatus ?? "") && (
        <p className="text-xs text-muted-foreground">{t("eventWallet.profileHint")}</p>
      )}

      {/* DROGA POWROTNA DO KASY. Karta pokazywala „nieopłacone" i nie dawała
          z tym NIC zrobić: jedyną drogą do zapłaty był ekran potwierdzenia,
          który uczestnik dawno zamknął, więc płacił, zapisując się DRUGI RAZ -
          co produkuje zduplikowane wiersze, o które rozbija się dopasowanie
          wpłaty. Warunek jest zawężony do stanów, w których zapłata ma sens:
          zgłoszenie odwołane albo odrzucone kasy nie potrzebuje. */}
      {item.paymentStatus === "unpaid" &&
        item.status !== "cancelled" &&
        item.status !== "rejected" && (
          <section className="rounded-[6px] border border-brand/50 bg-brand/5 p-3">
            <h3 className="text-sm font-semibold text-foreground">
              {t("participantTickets.payment.unpaid")}
            </h3>
            <RegistrationPayAction
              registrationId={item.registrationId}
              eventId={item.eventId}
              ticketTypeId={item.ticketTypeId}
              amountCents={item.amountCents}
              currency={item.currency}
              returnPath="/profile/tickets"
              intent="resume"
            />
          </section>
        )}
      <RegistrationCardActionsSlot item={item} />

      <section className="rounded-[6px] border border-border/60 bg-muted/30 p-3">
        <h3 className="text-sm font-semibold text-foreground">
          {t("participantTickets.reason.title")}
        </h3>
        <p className="text-sm text-muted-foreground">{reasonSentence}</p>
        {/* Stan zwrotu zamknietego zgloszenia (takze zamknietego odwolaniem
            calego wydarzenia, przeglad R45) - baza oddaje go tylko dla
            zgloszen zamknietych i tylko z wlasnego zamowienia uczestnika. */}
        {item.refundState !== null && (
          <p className="mt-1 text-sm text-foreground">
            {t(`participantTickets.refundState.${item.refundState}`)}
          </p>
        )}
        {/* Tylko zgloszenie zamkniete: powod na ponownie otwartym wierszu byl
            juz nieaktualny (baza i tak go nie oddaje - podwojny zamek). */}
        {item.participantReason !== null &&
          (item.status === "rejected" || item.status === "cancelled") && (
            <p className="mt-1 text-sm text-muted-foreground">
              {t("participantTickets.reason.participantReason", {
                reason: item.participantReason,
              })}
            </p>
          )}
        {item.decisionSource !== null && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("participantTickets.reason.source", { source: item.decisionSource })}
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">
          {t("participantTickets.channels.title")}
        </h3>
        <p className="text-xs text-muted-foreground">{t("participantTickets.channels.hint")}</p>
        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Switch
              checked={item.notifyEmail}
              disabled={channels.isPending}
              onCheckedChange={(checked) => channels.mutate({ notifyEmail: checked })}
            />
            {t("participantTickets.channels.email")}
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Switch
              checked={item.notifySms}
              disabled={channels.isPending || smsLocked}
              onCheckedChange={(checked) =>
                checked ? setSmsConsentOpen(true) : channels.mutate({ notifySms: false })
              }
            />
            {t("participantTickets.channels.sms")}
          </label>
        </div>
        {smsLocked && (
          <p className="text-xs text-muted-foreground">
            {t("participantTickets.channels.smsUnavailable")}
          </p>
        )}
        <SmsConsentConfirm
          open={smsConsentOpen}
          phoneHint={consentPrefsData?.phoneHint ?? null}
          pending={channels.isPending || (smsConsentOpen && consentPrefs.isFetching)}
          onConfirm={() =>
            channels.mutate(
              consentPrefsData !== null
                ? { notifySms: true, smsConsent: true, phoneHint: consentPrefsData.phoneHint }
                : { notifySms: true, smsConsent: true },
            )
          }
          onCancel={() => setSmsConsentOpen(false)}
        />
      </section>
      <RegistrationCardRemindersSlot item={item} />
      <RegistrationCardFollowUpSlot item={item} />

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">
          {t("participantTickets.webhooks.title")}
        </h3>
        {item.webhooks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("participantTickets.webhooks.empty")}</p>
        ) : (
          <ul className="space-y-1">
            {item.webhooks.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] border border-border/60 px-3 py-2 text-sm"
              >
                <span className="font-medium text-foreground">{entry.eventType}</span>
                <span className="text-muted-foreground">
                  {entry.occurredAt === null
                    ? "-"
                    : new Date(entry.occurredAt).toLocaleString(locale)}
                </span>
                <span className="text-muted-foreground">
                  {entry.status}
                  {entry.retryCount > 0
                    ? ` · ${t("participantTickets.webhooks.retries")}: ${entry.retryCount}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}

export function ParticipantTicketsPanel({
  /**
   * Zawężenie listy do JEDNEGO wydarzenia - prezentacyjne, nie ochronne:
   * RPC i tak oddaje wyłącznie zgłoszenia wołającego. Używa go panel „Moje"
   * na stronie wydarzenia, gdzie cała historia byłaby szumem.
   */
  slugFilter,
  /** Panel osadzony pod cudzym nagłówkiem nie powtarza własnego `h1`. */
  hideHeader = false,
}: {
  slugFilter?: string;
  hideHeader?: boolean;
} = {}) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchMyRegistrations,
    select: (rows: ParticipantRegistration[]) =>
      slugFilter === undefined ? rows : rows.filter((row) => row.eventSlug === slugFilter),
  });

  return (
    <div className="space-y-6">
      {!hideHeader && (
        <header className="space-y-1">
          <h1 className="text-lg font-bold">{t("participantTickets.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("participantTickets.lead")}</p>
        </header>
      )}

      {query.isPending && (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full rounded-[6px]" />
          <Skeleton className="h-32 w-full rounded-[6px]" />
        </div>
      )}

      {query.isError && (
        <p className="rounded-[6px] border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {t("participantTickets.loadError")}
        </p>
      )}

      {query.isSuccess && query.data.length === 0 && (
        <p className="rounded-[6px] border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          {t("participantTickets.empty")}
        </p>
      )}

      {query.isSuccess &&
        query.data.map((item) => <RegistrationCard key={item.registrationId} item={item} />)}
    </div>
  );
}
