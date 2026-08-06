// Zakup biletu na płatne wydarzenie. Kwota nigdy nie pochodzi z klienta -
// serwer (`createCheckoutOrder`, kind=one_time + event_id) czyta ją z wiersza
// wydarzenia, tworzy zamówienie i transakcję u operatora. Po zaksięgowaniu
// webhook potwierdza RSVP i wysyła mail rejestracyjny, więc tu nie zmieniamy
// żadnego stanu lokalnie.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Ticket, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { createCheckoutOrder } from "@/lib/billing/checkout.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { EmbeddedCheckoutDialog } from "@/components/checkout/EmbeddedCheckoutDialog";
import { prefetchEmbeddedCheckout } from "@/components/checkout/stripeFrameChunk";
import { formatMoney } from "@/lib/billing/types";

export interface EventTicketPurchaseProps {
  eventId: string;
  slug: string;
  priceCents: number;
  currency: string;
  lang: "pl" | "en";
  /** Bilet już opłacony (RSVP „going" po webhooku) - pokazujemy potwierdzenie. */
  hasTicket: boolean;
  isPast: boolean;
  isFull: boolean;
}

export function EventTicketPurchase({
  eventId,
  slug,
  priceCents,
  currency,
  lang,
  hasTicket,
  isPast,
  isFull,
}: EventTicketPurchaseProps) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const navigate = useNavigate();
  const checkout = useServerFn(createCheckoutOrder);
  // `clientSecret` sesji Stripe - modal osadzonego checkoutu zamiast nakładki.
  const [checkoutSecret, setCheckoutSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const price = formatMoney(priceCents, currency, lang);
  const successPath = `/events/${slug}`;

  if (hasTicket) {
    return (
      <p className="inline-flex items-center gap-2 text-sm text-primary" aria-live="polite">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        {lang === "pl" ? "Bilet opłacony" : "Ticket paid"}
      </p>
    );
  }

  if (isPast) return null;

  const buy = async () => {
    if (!session) {
      toast.error(
        lang === "pl" ? "Zaloguj się, aby kupić bilet." : "Sign in to purchase a ticket.",
      );
      return;
    }
    setBusy(true);
    // Rozgrzewka leniwego chunku kasy równolegle z tworzeniem sesji.
    prefetchEmbeddedCheckout();
    try {
      const res = await checkout({
        data: {
          kind: "one_time",
          event_id: eventId,
          success_path: successPath,
          cancel_path: `/events/${slug}`,
          environment: getStripeEnvironment(),
        },
      });
      if (!res.ok) {
        toast.error(t("checkout.paymentsNotConfigured"));
        return;
      }
      if (res.mode === "stripe") {
        setCheckoutSecret(res.clientSecret);
        return;
      }
      void navigate({ to: "/checkout/success", search: { order: res.orderId, mock: 1 } });
    } catch {
      toast.error(t("checkout.paymentsNotConfigured"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <EmbeddedCheckoutDialog
        clientSecret={checkoutSecret}
        onOpenChange={(open) => {
          if (!open) setCheckoutSecret(null);
        }}
      />
      <Button onClick={() => void buy()} disabled={busy || isFull}>
        <Ticket className="mr-2 h-4 w-4" aria-hidden="true" />
        {isFull
          ? lang === "pl"
            ? "Brak miejsc"
            : "Sold out"
          : lang === "pl"
            ? `Kup bilet - ${price}`
            : `Buy ticket - ${price}`}
      </Button>
    </>
  );
}
