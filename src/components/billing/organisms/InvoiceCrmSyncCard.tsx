// Most między danymi do faktury a kartoteką firmy w CRM.
//
// Kierunek zawsze wybiera człowiek: „pobierz z CRM" albo „zapisz w CRM".
// Automatyczne nadpisanie w tle kończyło się fakturami z adresem, którego
// nabywca nigdy nie zatwierdził.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, ArrowDownToLine, ArrowUpFromLine, Loader2 } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { billingKeys } from "@/lib/billing/keys";
import {
  fetchMyCrmCompany,
  importMyCrmCompany,
  pushMyBillingToCrm,
} from "@/lib/billing/invoices.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Direction = "pull" | "push";

export function InvoiceCrmSyncCard() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<Direction | null>(null);

  const companyQuery = useQuery({
    queryKey: ["my-crm-company", session?.user?.id ?? "anon"],
    queryFn: () => fetchMyCrmCompany(),
    enabled: !!session,
  });
  const company = companyQuery.data?.ok ? companyQuery.data.company : null;

  const run = async (direction: Direction) => {
    setBusy(direction);
    try {
      const result =
        direction === "pull" ? await importMyCrmCompany() : await pushMyBillingToCrm();
      if (!result.ok) {
        toast.error(t(`invoices.crm.errors.${result.error}`, t("invoices.crm.errors.generic")));
        return;
      }
      toast.success(t(direction === "pull" ? "invoices.crm.pulled" : "invoices.crm.pushed"));
      await Promise.all([
        companyQuery.refetch(),
        // Ten sam klucz co formularz danych do faktury (BillingProfileForm).
        queryClient.invalidateQueries({ queryKey: ["my-billing"] }),
        queryClient.invalidateQueries({
          queryKey: billingKeys.myBillingDocuments(session?.user?.id),
        }),
      ]);
    } catch {
      toast.error(t("invoices.crm.errors.generic"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="rounded-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4 text-primary" aria-hidden="true" />
          {t("invoices.crm.title")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t("invoices.crm.hint")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("invoices.crm.companyLabel")}
            </dt>
            <dd className="font-medium">{company?.name ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("invoices.crm.taxIdLabel")}
            </dt>
            <dd className="font-medium">{company?.taxId ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("invoices.crm.addressLabel")}
            </dt>
            <dd className="font-medium">
              {[company?.addressLine1, company?.postalCode, company?.city]
                .filter(Boolean)
                .join(", ") || "-"}
            </dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="rounded-md"
            disabled={busy !== null}
            onClick={() => void run("pull")}
          >
            {busy === "pull" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <ArrowDownToLine className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {t("invoices.crm.pull")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="rounded-md"
            disabled={busy !== null}
            onClick={() => void run("push")}
          >
            {busy === "push" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <ArrowUpFromLine className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {t("invoices.crm.push")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("invoices.crm.editHint")}</p>
      </CardContent>
    </Card>
  );
}
