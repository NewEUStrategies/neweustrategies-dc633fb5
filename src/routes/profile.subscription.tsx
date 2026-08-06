// Konsolidacja IA finansów (§11): ta trasa renderowała wyłącznie
// SubscriptionManagerSection - komponent, który jest już częścią huba
// członkostwa (/profile/membership), a jego pełniejszy odpowiednik (status,
// aktywny plan, portal operatora, dostęp dożywotni, zmiana planu, skrót
// historii płatności) mieszka na /profile/plan. Trzy pozycje nawigacji dla
// jednej rzeczy to nie wybór, tylko koszt decyzji dla użytkownika.
//
// Trasa zostaje jako przekierowanie: stare linki, zakładki, wyniki
// wyszukiwarki wewnętrznej i pozycje menu konta prowadzą do kanonicznej strony.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/profile/subscription")({
  beforeLoad: () => {
    throw redirect({ to: "/profile/plan", replace: true });
  },
});
