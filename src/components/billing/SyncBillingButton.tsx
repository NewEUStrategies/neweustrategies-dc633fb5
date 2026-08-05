// Przycisk „Synchronizuj ze Stripe" - samoobsługowa naprawa stanu, gdy webhook
// dotarł z opóźnieniem albo w ogóle nie dotarł. Wywołuje wąską funkcję
// serwerową ograniczoną do subskrypcji wołającego i unieważnia wszystkie
// widoki rozliczeniowe (plan, warstwa, zamówienia, dokumenty).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { billingKeys } from "@/lib/billing/keys";
import { getStripeEnvironmentSafe } from "@/lib/stripe";
import { syncMyBillingFromProvider } from "@/utils/payments.functions";

interface Props {
  className?: string;
  variant?: "outline" | "ghost" | "secondary";
  size?: "sm" | "default";
}

export function SyncBillingButton({ className, variant = "outline", size = "sm" }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const result = await syncMyBillingFromProvider({
        data: { environment: getStripeEnvironmentSafe() },
      });
      if ("error" in result && result.error) throw new Error(result.error);
      await Promise.all([
        qc.invalidateQueries({ queryKey: billingKeys.mySubscriptionAll() }),
        qc.invalidateQueries({ queryKey: billingKeys.myStripeSubscriptionAll() }),
        qc.invalidateQueries({ queryKey: billingKeys.currentTierAll() }),
        qc.invalidateQueries({ queryKey: billingKeys.myOrdersAll() }),
        qc.invalidateQueries({ queryKey: billingKeys.myBillingDocumentsAll() }),
        qc.invalidateQueries({ queryKey: billingKeys.myGrantsAll() }),
      ]);
      toast.success(t("profile.planPage.syncOk"));
    } catch (error) {
      console.error("[billing] self sync failed", error);
      toast.error(t("profile.planPage.syncError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={() => void run()}
      disabled={busy}
    >
      <RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} aria-hidden="true" />
      {t("profile.planPage.syncCta")}
    </Button>
  );
}
