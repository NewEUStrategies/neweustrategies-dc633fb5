// Molekuła: kontakty CRM, które najbliższe przebiegi zanonimizują (30 dni
// wcześniej), z przedłużeniem o 12 miesięcy i obowiązkowym powodem.
//
// Powód: licznik znaków jak w bazie (punkty kodowe), wartość spoza 3-500
// blokuje zapis z komunikatem - nigdy nie jest skracana (AGENTS: limit
// odrzuca, nie przycina). Przedłużenie trafia do dziennika audytu.
import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/i18n/format";
import { DATA_RETENTION_RULES, normalizeExtensionReason } from "@/lib/privacy/dataRetention";
import type { DataRetentionCrmDueItem } from "@/lib/privacy/dataRetentionParse";
import {
  dataRetentionCrmDueQueryOptions,
  useExtendDataRetentionContact,
} from "@/lib/privacy/dataRetentionQueries";

const {
  crmExtensionMonths: MONTHS,
  crmExtensionReasonMin: MIN,
  crmExtensionReasonMax: MAX,
} = DATA_RETENTION_RULES;

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
  const [reason, setReason] = useState("");
  const length = [...reason.trim()].length;
  const valid = normalizeExtensionReason(reason) !== null;
  const days = DATA_RETENTION_RULES.crmNoticeDays;

  const close = () => {
    setTarget(null);
    setReason("");
  };

  const submit = async () => {
    if (!target || !valid) return;
    const result = await extendM.mutateAsync({ leadId: target.leadId, reason });
    if (result.ok) {
      toast.success(
        t("adminDataRetention.crm.extended", {
          date: formatDate(result.data.extendedUntil, i18n.language),
        }),
      );
      close();
      return;
    }
    toast.error(
      result.error === "not_found"
        ? t("adminDataRetention.crm.notFound")
        : t("adminDataRetention.crm.extendError"),
    );
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

      <Dialog open={target !== null} onOpenChange={(open) => (open ? undefined : close())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("adminDataRetention.crm.extendTitle", { months: MONTHS })}</DialogTitle>
            <DialogDescription>
              {target ? contactName(target) : ""} - {t("adminDataRetention.crm.extendBody")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor={`${id}-reason`}>{t("adminDataRetention.crm.reasonLabel")}</Label>
            <Textarea
              id={`${id}-reason`}
              value={reason}
              rows={3}
              aria-invalid={reason !== "" && !valid ? true : undefined}
              aria-describedby={`${id}-reason-hint`}
              onChange={(event) => setReason(event.target.value)}
            />
            <p id={`${id}-reason-hint`} className="text-xs text-muted-foreground">
              {reason !== "" && !valid
                ? t("adminDataRetention.crm.reasonInvalid", { min: MIN, max: MAX })
                : t("adminDataRetention.crm.reasonHint", { min: MIN, max: MAX })}{" "}
              {t("adminDataRetention.crm.reasonCount", { count: length, max: MAX })}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              {t("adminDataRetention.toggle.cancel")}
            </Button>
            <Button disabled={!valid || extendM.isPending} onClick={() => void submit()}>
              {t("adminDataRetention.crm.extendSave", { months: MONTHS })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
