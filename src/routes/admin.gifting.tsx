// Trasa panelu prezentow (Gift Articles) - cienkie opakowanie organizmu.
// Zawartosc panelu mieszka w `@/components/admin/gifting`.
import { createFileRoute } from "@tanstack/react-router";
import { GiftingAdmin } from "@/components/admin/gifting/organisms/GiftingAdmin";

export const Route = createFileRoute("/admin/gifting")({
  component: GiftingAdmin,
});
