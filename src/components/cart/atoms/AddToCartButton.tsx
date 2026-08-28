// Atom: DODAJ DO KOSZYKA. Odkłada wskazany bilet jako notatkę zakupową.
//
// PRZYCISK NIE PŁACI I NIE REZERWUJE - dlatego jest wariantem pobocznym obok
// głównego „Kup bilet". Cena, którą zapisuje, jest podglądem; przy płatności
// autorytetem pozostaje baza.
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, ShoppingCart } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useCart } from "@/lib/cart/useCart";
import { cartItemId, type CartItem } from "@/lib/cart/cartStore";
import { ensureI18n } from "@/lib/i18n-cart";

ensureI18n();

export type AddToCartInput = Omit<CartItem, "id" | "kind" | "addedAt">;

export function AddToCartButton({ item }: { item: AddToCartInput }) {
  const { t } = useTranslation();
  const { add, has } = useCart();
  const id = cartItemId(item.eventId, item.ticketTypeId);
  const inCart = has(id);

  if (inCart) {
    return (
      <Button variant="ghost" size="sm" disabled className="text-muted-foreground">
        <Check className="mr-2 h-4 w-4" aria-hidden="true" />
        {t("cart.inCart")}
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        add({ ...item, id, kind: "event_ticket", addedAt: new Date().toISOString() });
        toast.success(t("cart.added"));
      }}
    >
      <ShoppingCart className="mr-2 h-4 w-4" aria-hidden="true" />
      {t("cart.addToCart")}
    </Button>
  );
}
