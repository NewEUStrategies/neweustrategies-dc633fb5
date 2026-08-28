// Organizm: „Moje zgłoszenia" - status zapisu, historia zdarzeń płatności,
// wyraźny powód anulowania/zwrotu oraz centrum kanałów per zgłoszenie.
//
// POWÓD JEST TREŚCIĄ, NIE ETYKIETĄ. Do tej pory uczestnik widział wyłącznie
// słowo „anulowane" i pisał do organizatora z pytaniem „dlaczego". Karta
// nazywa zdarzenie zdaniem (kto, kiedy, ile wróciło) i dopiero pod spodem
// pokazuje surowy ślad zdarzeń operatora dla tych, którzy chcą dowodu.
//
// KANAŁY SĄ PER ZGŁOSZENIE. Przełączniki piszą do
// `event_registration_set_channels`, a wysyłka transakcyjna czyta te same
// kolumny - to jedna prawda, nie dwie.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchMyRegistrations,
  setRegistrationChannels,
  type ParticipantRegistration,
} from "@/lib/events/participantTicketsApi";
import { ensureI18n } from "@/lib/i18n-participant-tickets";

ensureI18n();

const QUERY_KEY = ["profile", "event-registrations"] as const;

function statusKey(status: string): string {
  if (status === "approved" || status === "confirmed") return "approved";
  if (status === "waitlist" || status === "waitlisted") return "waitlist";
  if (status === "cancelled" || status === "canceled") return "cancelled";
  if (status === "rejected") return "rejected";
  if (status === "pending") return "pending";
  return "unknown";
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

  const channels = useMutation({
    mutationFn: (patch: { notifyEmail?: boolean; notifySms?: boolean }) =>
      setRegistrationChannels({ registrationId: item.registrationId, ...patch }),
    onSuccess: () => {
      toast.success(t("participantTickets.channels.saved"));
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: () => toast.error(t("participantTickets.channels.failed")),
  });

  const fullyRefunded =
    item.amountCents !== null && item.amountCents > 0 && item.refundedCents >= item.amountCents;
  const partiallyRefunded = item.refundedCents > 0 && !fullyRefunded;

  const paymentLabel =
    item.amountCents === null || item.amountCents === 0
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

      <section className="rounded-[6px] border border-border/60 bg-muted/30 p-3">
        <h3 className="text-sm font-semibold text-foreground">
          {t("participantTickets.reason.title")}
        </h3>
        <p className="text-sm text-muted-foreground">{reasonSentence}</p>
        {item.cancelReason !== null && (
          <p className="mt-1 text-sm text-muted-foreground">
            {t("participantTickets.reason.note", { note: item.cancelReason })}
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
              disabled={channels.isPending}
              onCheckedChange={(checked) => channels.mutate({ notifySms: checked })}
            />
            {t("participantTickets.channels.sms")}
          </label>
        </div>
      </section>

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
