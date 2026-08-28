// Prywatna strona profilu: historia wydarzeń uczestnika.
//
// Trasa leży pod layoutem `/profile`, więc dziedziczy jego bramkę zalogowania;
// dane i tak ogranicza baza do `auth.uid()` (RPC `event_my_registrations` nie
// przyjmuje żadnego identyfikatora).
import { createFileRoute } from "@tanstack/react-router";

import { MyEventsPanel } from "@/components/profile/events/MyEventsPanel";

export const Route = createFileRoute("/profile/events")({
  component: MyEventsPanel,
});
