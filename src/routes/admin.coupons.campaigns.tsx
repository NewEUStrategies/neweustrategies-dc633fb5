// Trasa kampanii kuponowych - cienkie opakowanie organizmu.
// Zawartosc panelu mieszka w `@/components/admin/coupons`.
import { createFileRoute } from "@tanstack/react-router";
import { CampaignsPage } from "@/components/admin/coupons/organisms/CampaignsPage";

export const Route = createFileRoute("/admin/coupons/campaigns")({
  component: CampaignsPage,
});
