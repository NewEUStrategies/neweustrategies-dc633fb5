// Zarządzanie subskrypcją (/profile/subscription). Cała logika i widok żyją w
// SubscriptionManagerSection - ten sam komponent renderuje hub członkostwa
// (/profile/membership), więc obie ścieżki nigdy się nie rozjadą.
import { createFileRoute } from "@tanstack/react-router";
import { SubscriptionManagerSection } from "@/components/billing/SubscriptionManagerSection";

export const Route = createFileRoute("/profile/subscription")({
  component: SubscriptionPage,
});

function SubscriptionPage() {
  return <SubscriptionManagerSection />;
}
