// Prywatna strona uczestnika: status zgłoszeń na wydarzenia, ślad zdarzeń
// płatności i powody anulowania/zwrotu.
//
// Trasa leży pod layoutem `/profile`, więc dziedziczy jego bramkę
// zalogowania; dane i tak ogranicza baza do `auth.uid()` (RPC
// `event_my_registrations` nie przyjmuje żadnego identyfikatora).
import { createFileRoute } from "@tanstack/react-router";

import { ParticipantTicketsPanel } from "@/components/profile/ParticipantTicketsPanel";

export const Route = createFileRoute("/profile/tickets")({
  component: ParticipantTicketsPanel,
});
