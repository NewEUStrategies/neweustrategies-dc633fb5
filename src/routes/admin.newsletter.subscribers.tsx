// /admin/newsletter/subscribers - tabela subskrybentow + eksport CSV.
import { createFileRoute } from "@tanstack/react-router";
import { SubscribersPanel } from "@/components/admin/newsletter/SubscribersPanel";

export const Route = createFileRoute("/admin/newsletter/subscribers")({
  component: SubscribersPanel,
});
