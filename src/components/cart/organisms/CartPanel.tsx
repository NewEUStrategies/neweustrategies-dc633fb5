// Organizm: KOSZYK. Lista odłożonych biletów + płatność za pojedynczą pozycję.
//
// PŁATNOŚĆ IDZIE POZYCJA PO POZYCJI, I TO JEST DECYZJA, NIE BRAK. Jedna sesja
// Stripe na kilka biletów znaczyłaby jedno zamówienie (`payment_orders`) na
// kilka zapisów, a webhook przenosi wynik płatności na DOKŁADNIE JEDNO
// zgłoszenie (`payments_apply_event_ticket_outcome`). Zwrot częściowy takiego
// pakietu nie miałby jak wskazać, które miejsce zwolnić. Dopóki backend nie zna
// zamówień wielopozycyjnych, koszyk jest kolejką zakupową - i mówi to wprost.
//
// KWOTA Z KOSZYKA NIE TRAFIA DO KASY. Do serwera jedzie wyłącznie wskazanie
// pozycji (`event_id`, `ticket_type_id`); cenę, fazę i dostępność liczy baza.
import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ShoppingCart } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useCart } from "@/lib/cart/useCart";
import { cartItemLabel } from "@/lib/cart/cartStore";
import { createCheckoutOrder } from "@/lib/billing/checkout.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { LazyEmbeddedCheckoutDialog } from "@/components/checkout/LazyEmbeddedCheckoutDialog";
import { CartLine } from "@/components/cart/molecules/CartLine";
import { formatMoney } from "@/lib/billing/types";
import { uiLang } from "@/lib/i18n/format";
import { ensureI18n } from "@/lib/i18n-cart";

ensureI18n();

export function CartPanel() {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const { session } = useAuth();
  const navigate = useNavigate();
  const checkout = useServerFn(createCheckoutOrder);
  const { items, totals, remove, clear } = useCart();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [checkoutSecret, setCheckoutSecret] = useState<string | null>(null);
  // KOD RABATOWY JEST TYLKO NAPISEM. Zniżkę liczy `createCheckoutOrder`
  // (validate_b2b_coupon -> redeem_b2b_coupon) tuż przed utworzeniem
  // zamówienia; przeglądarka nie zna ani wartości rabatu, ani finalnej kwoty.
  const [promo, setPromo] = useState("");

  const pay = async (id: string) => {
    const item = items.find((entry) => entry.id === id);
    if (item === undefined) return;
    if (!session) {
      toast.error(t("cart.signInToPay"));
      return;
    }
    setBusyId(id);
    const code = promo.trim().toUpperCase();
    try {
      const res = await checkout({
        data: {
          kind: "one_time",
          event_id: item.eventId,
          ticket_type_id: item.ticketTypeId,
          success_path: `/events/${item.slug}`,
          cancel_path: "/cart",
          environment: getStripeEnvironment(),
          ...(code.length > 0 ? { coupon_code: code } : {}),
        },
      });
      if (!res.ok) {
        toast.error(res.mode === "coupon" ? t("cart.promoError") : t("cart.payError"));
        return;
      }
      if (res.mode === "stripe") {
        setCheckoutSecret(res.clientSecret);
        return;
      }
      void navigate({ to: "/checkout/success", search: { order: res.orderId, mock: 1 } });
    } catch {
      toast.error(t("cart.payError"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <LazyEmbeddedCheckoutDialog
        clientSecret={checkoutSecret}
        onOpenChange={(open) => {
          if (!open) setCheckoutSecret(null);
        }}
      />

      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="flex items-center gap-2 text-lg font-bold">
            <ShoppingCart className="h-5 w-5 text-primary" aria-hidden="true" />
            {t("cart.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("cart.lead")}</p>
        </header>

        {items.length === 0 ? (
          <div className="space-y-3 rounded-[6px] border border-border bg-muted/30 p-6 text-sm text-muted-foreground">
            <p>{t("cart.empty")}</p>
            <Button asChild size="sm" variant="outline">
              <Link to="/events">{t("cart.browseEvents")}</Link>
            </Button>
          </div>
        ) : (
          <>
            <ul className="space-y-3">
              {items.map((item) => (
                <CartLine
                  key={item.id}
                  label={cartItemLabel(item, lang)}
                  price={formatMoney(item.priceCents, item.currency, lang)}
                  eventLink={
                    <Link
                      to="/events/$slug"
                      params={{ slug: item.slug }}
                      className="underline-offset-2 hover:text-foreground hover:underline"
                    >
                      {t("cart.openEvent")}
                    </Link>
                  }
                  busy={busyId === item.id}
                  payLabel={busyId === item.id ? t("cart.paying") : t("cart.pay")}
                  removeLabel={t("cart.remove")}
                  onPay={() => void pay(item.id)}
                  onRemove={() => {
                    remove(item.id);
                    toast.success(t("cart.removed"));
                  }}
                />
              ))}
            </ul>

            <section className="space-y-2 rounded-[6px] border border-border bg-card p-4">
              <label
                htmlFor="cart-promo"
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {t("cart.promoLabel")}
              </label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  id="cart-promo"
                  value={promo}
                  onChange={(event) => setPromo(event.target.value)}
                  maxLength={64}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t("cart.promoPlaceholder")}
                  className="h-10 w-full rounded-[6px] border border-input bg-background px-3 text-sm uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-xs"
                />
                <p className="text-xs text-muted-foreground">{t("cart.promoHint")}</p>
              </div>
            </section>

            <footer className="flex flex-col gap-3 rounded-[6px] border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1 text-sm">
                <p className="font-semibold">{t("cart.itemsCount", { count: totals.count })}</p>
                {totals.byCurrency.map((total) => (
                  <p key={total.currency} className="text-muted-foreground">
                    {t("cart.total", { currency: total.currency })}:{" "}
                    <span className="font-medium text-foreground">
                      {formatMoney(total.amountCents, total.currency, lang)}
                    </span>
                  </p>
                ))}
                <p className="text-xs text-muted-foreground">{t("cart.totalHint")}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  clear();
                  toast.success(t("cart.cleared"));
                }}
              >
                {t("cart.clear")}
              </Button>
            </footer>
          </>
        )}
      </div>
    </>
  );
}
