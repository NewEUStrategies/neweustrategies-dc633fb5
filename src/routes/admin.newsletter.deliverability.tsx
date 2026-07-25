// /admin/newsletter/deliverability - reputacja nadawcy, lista wykluczeń
// (bounce/complaint) i status pętli zwrotnej dostawcy.
import { createFileRoute } from "@tanstack/react-router";
import { DeliverabilityPanel } from "@/components/admin/newsletter/deliverability/DeliverabilityPanel";

export const Route = createFileRoute("/admin/newsletter/deliverability")({
  component: DeliverabilityPanel,
});
