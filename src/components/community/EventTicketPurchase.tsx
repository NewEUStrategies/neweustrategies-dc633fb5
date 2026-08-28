// Zakup biletu na płatne wydarzenie. Kwota nigdy nie pochodzi z klienta -
// serwer (`createCheckoutOrder`, kind=one_time + event_id) czyta ją z wiersza
// wydarzenia, dolicza benefity planu i tworzy zamówienie u operatora. Po
// zaksięgowaniu webhook potwierdza RSVP i wysyła mail rejestracyjny, więc tu
// nie zmieniamy żadnego stanu lokalnie.
//
// TRZY ŚCIEŻKI, JEDNA REGUŁA (katalog członkostw v6.1). Bilet może być:
//   * WLICZONY w plan - członek odbiera go z rocznej puli i NIE PŁACI nic;
//     pulę konsumuje `rsvp_event` (bramka biletowa, migracja 20260822091000),
//     więc poprawną akcją jest zapis, nie kasa;
//   * ZNIŻKOWY - stawki studencka i akademicka mają 50% zamiast puli;
//   * PEŁNOPŁATNY - cena katalogowa wydarzenia.
// Którą z nich widzi kupujący, rozstrzyga JEDNA czysta funkcja (`ticketOffer`)
// - ta sama, którą serwer liczy kwotę do pobrania. Rozjazd karty i kasy co do
// grosza jest tu niemożliwy z konstrukcji.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Ticket, CheckCircle2, BadgeCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { createCheckoutOrder } from "@/lib/billing/checkout.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { LazyEmbeddedCheckoutDialog } from "@/components/checkout/LazyEmbeddedCheckoutDialog";
import { AddToCartButton } from "@/components/cart/atoms/AddToCartButton";
import { formatMoney } from "@/lib/billing/types";
import { rsvpEvent } from "@/lib/community/publicQueries";
import { getMyTicketAllowance } from "@/lib/events/ticketAllowance.functions";
import {
  EMPTY_TICKET_ALLOWANCE,
  parseTicketAllowance,
  ticketOffer,
} from "@/lib/events/ticketAllowance";

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
  /** Odświeżenie stanu RSVP po odebraniu biletu z puli (właścicielem jest trasa). */
  onClaimed?: () => void;
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
  onClaimed,
}: EventTicketPurchaseProps) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const navigate = useNavigate();
  const checkout = useServerFn(createCheckoutOrder);
  const loadAllowance = useServerFn(getMyTicketAllowance);
  // `clientSecret` sesji Stripe - modal osadzonego checkoutu zamiast nakładki.
  const [checkoutSecret, setCheckoutSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Pula biletów wliczonych w plan. Awaria odczytu degraduje do PUSTEJ puli,
  // czyli do pełnej ceny - jedyny bezpieczny kierunek: w drugą stronę błąd
  // sieci rozdawałby darmowe wejściówki.
  const allowanceQ = useQuery({
    queryKey: ["ticket-allowance", session?.user?.id ?? null],
    queryFn: async () => parseTicketAllowance(await loadAllowance()),
    enabled: !!session,
    staleTime: 60_000,
  });
  const allowance = allowanceQ.data ?? EMPTY_TICKET_ALLOWANCE;
  const offer = ticketOffer(priceCents, allowance);

  const claim = useMutation({
    // Bilet z puli odstępuje RPC `rsvp_event`: sprawdza próg rangi, regułę
    // Chatham House, limit miejsc i dopiero wtedy konsumuje pulę. Klient nie
    // ma jak przyznać sobie biletu z pominięciem tej ścieżki.
    mutationFn: () => rsvpEvent(eventId, "going"),
    onSuccess: (result) => {
      allowanceQ.refetch().catch(() => {
        /* licznik jest informacją, nie warunkiem - odświeży się przy kolejnym wejściu */
      });
      onClaimed?.();
      if (result.status === "waitlist") {
        toast.success(t("community.events.toastWaitlist", { position: result.waitlist_position }));
        return;
      }
      toast.success(t("community.events.ticketClaimed"));
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("ticket required")) toast.error(t("community.events.ticketRequired"));
      else if (msg.includes("chatham house")) toast.error(t("community.events.rsvpTierError"));
      else if (msg.includes("membership required"))
        toast.error(t("community.events.rsvpTierError"));
      else if (msg.includes("full")) toast.error(t("community.events.rsvpFull"));
      else toast.error(t("community.events.rsvpError"));
    },
  });

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
    try {
      const res = await checkout({
        data: {
          kind: "one_time",
          event_id: eventId,
          success_path: `/events/${slug}`,
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

  // Bilet wliczony w plan: przycisk prowadzi do ZAPISU, nie do kasy. Wysłanie
  // takiego członka do checkoutu skończyłoby się zamówieniem na zero złotych,
  // które serwer i tak odrzuca (`ticket_included_in_plan`).
  if (offer.kind === "included") {
    return (
      <div className="flex flex-col items-start gap-1">
        <Button onClick={() => claim.mutate()} disabled={claim.isPending || isFull}>
          <BadgeCheck className="mr-2 h-4 w-4" aria-hidden="true" />
          {isFull ? t("community.events.soldOut") : t("community.events.claimIncludedTicket")}
        </Button>
        <p className="text-xs text-muted-foreground">
          {offer.scope === "organisation"
            ? t("community.events.ticketPoolOrg", { remaining: allowance.remaining })
            : t("community.events.ticketPoolPersonal", { remaining: allowance.remaining })}
        </p>
      </div>
    );
  }

  const amount = formatMoney(offer.kind === "free" ? 0 : offer.amountCents, currency, lang);

  return (
    <>
      <LazyEmbeddedCheckoutDialog
        clientSecret={checkoutSecret}
        onOpenChange={(open) => {
          if (!open) setCheckoutSecret(null);
        }}
      />
      <div className="flex flex-col items-start gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void buy()} disabled={busy || isFull}>
            <Ticket className="mr-2 h-4 w-4" aria-hidden="true" />
            {isFull
              ? t("community.events.soldOut")
              : t("community.events.buyTicket", { price: amount })}
          </Button>
          {/* Odłożenie na później - notatka w przeglądarce, bez rezerwacji
              miejsca i bez zamówienia (patrz `CartPanel`). */}
          {!isFull && offer.kind !== "free" && (
            <AddToCartButton
              item={{
                eventId,
                slug,
                titlePl: "",
                titleEn: "",
                ticketTypeId: null,
                ticketNamePl: "",
                ticketNameEn: "",
                priceCents: offer.amountCents,
                currency,
              }}
            />
          )}
        </div>
        {offer.kind === "discounted" && (
          <p className="text-xs text-muted-foreground">
            {t("community.events.ticketMemberDiscount", {
              pct: offer.discountPct,
              full: formatMoney(offer.faceValueCents, currency, lang),
            })}
          </p>
        )}
      </div>
    </>
  );
}
