// Trasa: `/cart` - koszyk uczestnika.
//
// PRYWATNA TREŚĆ, ALE BEZ BRAMKI TRASY. Koszyk żyje w przeglądarce, więc widzi
// go także gość - i to jest poprawne: bilet można odłożyć przed założeniem
// konta, a dopiero płatność wymaga sesji (`CartPanel` prosi wtedy o logowanie).
// Bramka na trasie kasowałaby koszyk gościa razem z powodem, dla którego wrócił.
import { createFileRoute } from "@tanstack/react-router";

import { CartPanel } from "@/components/cart/organisms/CartPanel";

export const Route = createFileRoute("/cart")({
  component: CartPage,
  head: () => ({
    meta: [
      { title: "Mój koszyk - New European Strategies" },
      {
        name: "description",
        content: "Bilety odłożone do zakupu: przejrzyj pozycje i dokończ płatność.",
      },
      { property: "og:title", content: "Mój koszyk - New European Strategies" },
      {
        property: "og:description",
        content: "Bilety odłożone do zakupu: przejrzyj pozycje i dokończ płatność.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      // Koszyk jest osobisty - w indeksie nie ma czego pokazać.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function CartPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <CartPanel />
    </main>
  );
}
