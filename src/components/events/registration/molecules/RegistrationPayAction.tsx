// Molekuła: JEDYNA droga ze zgłoszenia „unpaid" do kasy.
//
// PO CO TO ISTNIEJE. Migracja `20260828206000` zamknęła dziurę, w której płatna
// wejściówka wychodziła za darmo: zgłoszenie powstaje jako `pending`,
// z `payment_status = 'unpaid'` i BEZ kodu QR. Nagłówek tamtej migracji
// zapisał sobie resztę pracy wprost - „żeby formularz miał czym pokierować do
// kasy zamiast pokazywać potwierdzenie". Do tej molekuły ekran potwierdzenia
// mówił „nie masz jeszcze wejściówki" i na tym kończył: bez przycisku, bez
// odnośnika, bez niczego.
//
// PRZEBIEG SKOPIOWANY, KOMPONENT NIE. `EventTicketPurchase` (moduł
// społeczności) ma działający przebieg `createCheckoutOrder` → `clientSecret`
// → osadzony modal operatora, ale liczy cenę z WIERSZA WYDARZENIA i nie zna
// zgłoszeń etapu 4 ani cennika wejściówek. Wspólny jest przebieg, nie ekran.
//
// KWOTY NIE WYSYŁAMY. Klient przekazuje wyłącznie identyfikatory; kwotę liczy
// `event_ticket_checkout_quote` po stronie bazy - ta sama funkcja, z której
// czyta kartę biletu. Kwota na tym ekranie jest informacją, nie żądaniem.
//
// `registration_id` JEST KLUCZEM DOWIĄZANIA. Bez niego
// `payments_apply_event_ticket_outcome` dopasowuje wpłatę PO OSOBIE z `LIMIT 1`
// po dacie utworzenia, więc uczestnik z dwoma zgłoszeniami na to samo
// wydarzenie dostaje opłacony bilet przypięty do najnowszego wiersza -
// niekoniecznie tego, za który zapłacił.
//
// GOŚĆ BEZ KONTA NIE DOSTAJE MARTWEGO PRZYCISKU. `createCheckoutOrder` stoi za
// `requireSupabaseAuth`, a księgowanie wpłaty wymaga `payment_orders.user_id`,
// więc gość zobaczy zdanie z prawdziwym powodem (paragon i droga zwrotu należą
// do konta) i odnośnik do logowania - a nie kontrolkę, która go wyrzuci.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CreditCard, Loader2, LogIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { createCheckoutOrder } from "@/lib/billing/checkout.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { LazyEmbeddedCheckoutDialog } from "@/components/checkout/LazyEmbeddedCheckoutDialog";
import {
  admissionQuoteMessageKey,
  ticketCheckoutRefusal,
  type TicketCheckoutRefusal,
} from "@/lib/events/admissionApi";
import { RegistrationAmountDue } from "@/components/events/registration/atoms/RegistrationAmountDue";
import { ensureEventRegistrationI18n } from "@/lib/i18n-event-registration";

ensureEventRegistrationI18n();

export interface RegistrationPayActionProps {
  registrationId: string;
  /** Wydarzenie i wejściówka - kasa wymaga kompletu, `null` wyłącza przycisk. */
  eventId: string | null;
  ticketTypeId: string | null;
  amountCents: number | null;
  currency: string | null;
  /** Dokąd wraca kupujący z kasy (sukces i rezygnacja). */
  returnPath: string;
  /** „Zapłać" na ekranie potwierdzenia, „Dokończ płatność" przy powrocie. */
  intent?: "pay" | "resume";
  /**
   * Czy TA molekuła ma pokazać kwotę.
   *
   * Ekran potwierdzenia mówi ją już w zdaniu nagłówkowym
   * (`result.paymentHintAmount`), więc powtórzenie jej tuż pod spodem czyta się
   * jak dwie różne kwoty. Panel uczestnika i strona samoobsługi własnego zdania
   * o kwocie nie mają - tam domyślne `true` jest jedynym jej źródłem.
   */
  showAmount?: boolean;
  /**
   * Zgłoszenie należy do zalogowanego wołającego.
   *
   * `undefined` znaczy „nie wiemy" - wtedy pytamy tylko o zalogowanie, bo
   * autorytetem i tak jest baza (`event_registration_payment_context`).
   */
  ownedByCaller?: boolean;
}

export function RegistrationPayAction({
  registrationId,
  eventId,
  ticketTypeId,
  amountCents,
  currency,
  returnPath,
  intent = "pay",
  showAmount = true,
  ownedByCaller,
}: RegistrationPayActionProps) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const navigate = useNavigate();
  const checkout = useServerFn(createCheckoutOrder);

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<TicketCheckoutRefusal | null>(null);

  // BRAK KONTA. Zdanie ma być prawdziwe - „płatna wejściówka wymaga konta, bo
  // do niego należy paragon i możliwość zwrotu" - a nie ogólne „zaloguj się".
  if (session === null) {
    return (
      <div className="space-y-2 rounded-[6px] border border-border bg-muted/30 p-3">
        <p className="text-sm font-semibold text-foreground">
          {t("eventRegistration.payment.accountRequiredTitle")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("eventRegistration.payment.accountRequiredBody")}
        </p>
        {showAmount && <RegistrationAmountDue amountCents={amountCents} currency={currency} />}
        <Link
          to="/login"
          search={{ mode: "signin" }}
          className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
        >
          <LogIn className="h-4 w-4" aria-hidden="true" />
          {t("eventRegistration.payment.signIn")}
        </Link>
      </div>
    );
  }

  // ZALOGOWANY, ALE NIE WŁAŚCICIEL. Baza odmówi (`not_found`), więc mówimy
  // o tym zawczasu, zamiast prowadzić do kasy pod odmowę.
  if (ownedByCaller === false) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t("eventRegistration.payment.notOwnerBody")}
      </p>
    );
  }

  const ready = eventId !== null && ticketTypeId !== null;

  async function pay(): Promise<void> {
    if (!ready) return;
    setBusy(true);
    setRefusal(null);
    try {
      const result = await checkout({
        data: {
          kind: "one_time",
          event_id: eventId,
          ticket_type_id: ticketTypeId,
          registration_id: registrationId,
          success_path: returnPath,
          cancel_path: returnPath,
          environment: getStripeEnvironment(),
        },
      });
      if (!result.ok) {
        // Odmowa kuponu/konfiguracji wraca jako `ok: false` z własnym kodem;
        // mapujemy ją tym samym słownikiem, co odmowy wyceny.
        setRefusal(ticketCheckoutRefusal(result.error));
        return;
      }
      if (result.mode === "stripe") {
        setClientSecret(result.clientSecret);
        return;
      }
      // Tryb mock (brak dostawcy w dev) - ta sama trasa, co przy zakupie biletu.
      void navigate({ to: "/checkout/success", search: { order: result.orderId, mock: 1 } });
    } catch (error: unknown) {
      setRefusal(ticketCheckoutRefusal(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <LazyEmbeddedCheckoutDialog
        clientSecret={clientSecret}
        onOpenChange={(open) => {
          if (!open) setClientSecret(null);
        }}
      />
      {showAmount && <RegistrationAmountDue amountCents={amountCents} currency={currency} />}
      <Button type="button" disabled={busy || !ready} onClick={() => void pay()}>
        {busy ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <CreditCard className="mr-2 h-4 w-4" aria-hidden="true" />
        )}
        {busy
          ? t("eventRegistration.payment.paying")
          : intent === "resume"
            ? t("eventRegistration.payment.resume")
            : t("eventRegistration.payment.payNow")}
      </Button>
      {refusal !== null && (
        <p role="status" className="text-sm text-destructive">
          {t(admissionQuoteMessageKey(refusal))}
        </p>
      )}
    </div>
  );
}
