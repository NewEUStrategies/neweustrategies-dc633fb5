// Trasa: `/cart` - koszyk uczestnika.
//
// PRYWATNA TREŚĆ, ALE BEZ BRAMKI TRASY. Koszyk żyje w przeglądarce, więc widzi
// go także gość - i to jest poprawne: bilet można odłożyć przed założeniem
// konta, a dopiero płatność wymaga sesji (`CartPanel` prosi wtedy o logowanie).
// Bramka na trasie kasowałaby koszyk gościa razem z powodem, dla którego wrócił.
import { createFileRoute } from "@tanstack/react-router";

import { CartPanel } from "@/components/cart/organisms/CartPanel";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { SITE_NAME } from "@/lib/seo/meta";

export const Route = createFileRoute("/cart")({
  component: CartPage,
  head: () => {
    // head() biegnie POZA drzewem Reacta i poza dostawcą i18next, więc `t()` tu
    // nie istnieje - język bierzemy z adresu przez `activeLang`, dokładnie jak
    // `welcome.tsx`. Bez tego użytkownik z angielskim interfejsem dostawał polską
    // kartę przeglądarki i polski podgląd linku przy udostępnieniu.
    const lang = activeLang(getRequestUrl() || "/cart");
    const title = lang === "en" ? `My cart - ${SITE_NAME}` : `Mój koszyk - ${SITE_NAME}`;
    const description =
      lang === "en"
        ? "Tickets set aside for purchase: review the items and complete payment."
        : "Bilety odłożone do zakupu: przejrzyj pozycje i dokończ płatność.";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
        // Koszyk jest osobisty - w indeksie nie ma czego pokazać.
        { name: "robots", content: "noindex, nofollow" },
      ],
    };
  },
});

function CartPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <CartPanel />
    </main>
  );
}
