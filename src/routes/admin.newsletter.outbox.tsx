// /admin/newsletter/outbox - skrzynka wysyłek: dziennik każdej wiadomości
// wysłanej przez platformę wraz ze statusem i powodem niepowodzenia.
import { createFileRoute } from "@tanstack/react-router";
import { EmailOutboxPanel } from "@/components/admin/newsletter/outbox/EmailOutboxPanel";

export const Route = createFileRoute("/admin/newsletter/outbox")({
  component: EmailOutboxPanel,
});
