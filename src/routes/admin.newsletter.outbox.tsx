// /admin/newsletter/outbox - skrzynka wysyłek: dziennik każdej wiadomości
// wysłanej przez platformę wraz ze statusem i powodem niepowodzenia.
//
// Nagłówek sekcyjny (AGENTS.md): layouty `/admin` i `/admin/newsletter` nie
// dają tej podstronie własnego tytułu, a panel go nie ustawia.
import { createFileRoute } from "@tanstack/react-router";
import { EmailOutboxPanel } from "@/components/admin/newsletter/outbox/EmailOutboxPanel";
import { adminPageHead } from "@/lib/adminPageHead";

export const Route = createFileRoute("/admin/newsletter/outbox")({
  head: () =>
    adminPageHead(
      "Email outbox",
      "Review every message sent by the platform with its status and failure reason. New European Strategies administration.",
    ),
  component: EmailOutboxPanel,
});
