// Molekuła: kontakty CRM, które najbliższe przebiegi zanonimizują (30 dni
// wcześniej), z przedłużeniem o 12 miesięcy i obowiązkowym powodem.
//
// Powód: wspólne okno `ReasonDialog` (licznik znaków jak w bazie, wartość
// spoza 3-500 blokuje zapis z komunikatem - nigdy nie jest skracana; AGENTS:
// limit odrzuca, nie przycina). Przedłużenie trafia do dziennika audytu.
import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/i18n/format";
import { DATA_RETENTION_RULES } from "@/lib/privacy/dataRetention";
import type { DataRetentionCrmDueItem } from "@/lib/privacy/dataRetentionParse";
import {
  dataRetentionCrmDueQueryOptions,
  useExtendDataRetentionContact,
} from "@/lib/privacy/dataRetentionQueries";
import { ReasonDialog } from "./ReasonDialog";

const { crmExtensionMonths: MONTHS } = DATA_RETENTION_RULES;

function contactName(item: DataRetentionCrmDueItem): string {
  const full = [item.firstName, item.lastName].filter(Boolean).join(" ").trim();
  return full === "" ? item.email : `${full} (${item.email})`;
}

export function CrmDueList({ tenantId }: { tenantId: string }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const dueQ = useQuery(dataRetentionCrmDueQueryOptions(tenantId));
  const extendM = useExtendDataRetentionContact(tenantId);
  const [target, setTarget] = useState<DataRetentionCrmDueItem | null>(null);
  const days = DATA_RETENTION_RULES.crmNoticeDays;

  const submit = async (reason: string): Promise<boolean> => {
    if (!target) return false;
    const result = await extendM.mutateAsync({ leadId: target.leadId, reason });
    if (result.ok) {
      toast.success(
        t("adminDataRetention.crm.extended", {
          date: formatDate(result.data.extendedUntil, i18n.language),
        }),
      );
      return true;
    }
    toast.error(
      result.error === "not_found"
        ? t("adminDataRetention.crm.notFound")
        : t("adminDataRetention.crm.extendError"),
    );
    return false;
  };

  const data = dueQ.data?.state === "ready" ? dueQ.data.data : null;

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-2">
      <h3 id={`${id}-title`} className="text-sm font-semibold">
        {t("adminDataRetention.crm.title", { days })}
      </h3>
      <p className="text-xs text-muted-foreground">
        {t("adminDataRetention.crm.subtitle", { months: MONTHS })}
      </p>
      {dueQ.isLoading ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t("adminDataRetention.crm.loading")}
        </p>
      ) : dueQ.isError || data === null ? (
        <p role="alert" className="text-xs">
          {t("adminDataRetention.crm.error")}
        </p>
      ) : data.items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("adminDataRetention.crm.empty", { days })}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th scope="col" className="py-1 pr-3 font-medium">
                  {t("adminDataRetention.crm.contact")}
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  {t("adminDataRetention.crm.lastActivity")}
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  {t("adminDataRetention.crm.dueAt")}
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  {t("adminDataRetention.crm.kind")}
                </th>
                <th scope="col" className="py-1 font-medium">
                  <span className="sr-only">{t("adminDataRetention.crm.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.leadId} className="border-t border-border/60">
                  <td className="py-2 pr-3">
                    <span className="break-all">{contactName(item)}</span>
                    {item.company ? (
                      <span className="block text-muted-foreground">{item.company}</span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3">{formatDate(item.lastActivity, i18n.language)}</td>
                  <td className="py-2 pr-3">{formatDate(item.dueAt, i18n.language)}</td>
                  <td className="py-2 pr-3">
                    {item.customer
                      ? t("adminDataRetention.crm.customer")
                      : t("adminDataRetention.crm.lead")}
                  </td>
                  <td className="py-2 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={t("adminDataRetention.crm.extendAria", {
                        name: contactName(item),
                      })}
                      onClick={() => setTarget(item)}
                    >
                      {t("adminDataRetention.crm.extend")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ReasonDialog
        open={target !== null}
        title={t("adminDataRetention.crm.extendTitle", { months: MONTHS })}
        description={`${target ? contactName(target) : ""} - ${t("adminDataRetention.crm.extendBody")}`}
        reasonLabel={t("adminDataRetention.crm.reasonLabel")}
        confirmLabel={t("adminDataRetention.crm.extendSave", { months: MONTHS })}
        pending={extendM.isPending}
        onClose={() => setTarget(null)}
        onConfirm={submit}
      />
    </section>
  );
}
