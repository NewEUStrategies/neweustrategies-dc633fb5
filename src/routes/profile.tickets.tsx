// Prywatna strona uczestnika: status zgłoszeń na wydarzenia, ślad zdarzeń
// płatności i powody anulowania/zwrotu.
//
// Trasa leży pod layoutem `/profile`, więc dziedziczy jego bramkę
// zalogowania; dane i tak ogranicza baza do `auth.uid()` (RPC
// `event_my_registrations` nie przyjmuje żadnego identyfikatora).
//
// Własny tytuł i opis jak `/profile/invoices`: layout daje tylko ogólne
// „Profil - Mój panel", więc karta i historia nie mówiły, gdzie jest uczestnik.
// `robots` celowo NIE jest powtórzony: `noindex, nofollow` daje layout
// `/profile`, a router zostawia meta rodzica, której dziecko nie nadpisuje
// (jak `/profile/events`). Literalny `noindex` tutaj wymagałby też wpisu
// w `NOINDEX_CODE_ROUTE_PATHS` (bramka `noindexCodeRoutes.test.ts`).
import { createFileRoute } from "@tanstack/react-router";

import { ParticipantTicketsPanel } from "@/components/profile/ParticipantTicketsPanel";

export const Route = createFileRoute("/profile/tickets")({
  component: ParticipantTicketsPanel,
  head: () => ({
    meta: [
      { title: "Moje zgłoszenia - New European Strategies" },
      {
        name: "description",
        content:
          "Status Twoich zgłoszeń na wydarzenia, historia płatności oraz powody anulowania i zwrotów.",
      },
      { property: "og:title", content: "Moje zgłoszenia - New European Strategies" },
      {
        property: "og:description",
        content: "Zgłoszenia na wydarzenia, ślad płatności i zwroty uczestnika.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});
