// Organizm: koszty dzienne jednej kampanii - lista, dzien recznie, wklejony
// raport.
//
// ZAPIS JEST JAWNY I WSADOWY. Recznie dopisany dzien i wklejony raport ida
// jednym RPC (`admin_event_ad_costs_save`, calosc albo nic), a dzien juz
// zapisany jest nadpisywany - dwukrotny import tego samego raportu z Google Ads
// niczego nie dubluje. Bledy wklejki pokazujemy z numerem wiersza, ZANIM cokolwiek
// wyjdzie do bazy; odmowe bazy - toastem z numerem wiersza wsadu.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { AdminFormSection } from "@/components/admin/molecules/AdminFormSection";
import { AdminFormTextRow } from "@/components/admin/molecules/AdminFormTextRow";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Trash2 } from "@/lib/lucide-shim";
import type { AdCampaign, AdCostRowInput, AdCostSource } from "@/lib/events/adsFunnelApi";
import { microsToCents } from "@/lib/events/adsFunnel";
import {
  adCostRowFromDraft,
  parseCostsPaste,
  type AdCostErrorKey,
} from "@/lib/events/adsFunnelDraft";
import { adminAdsFunnelErrorMessage } from "@/lib/events/adminAdsFunnelErrors";
import { formatMoney } from "@/lib/billing/types";
import {
  useAdCampaignCosts,
  useDeleteAdCost,
  useSaveAdCosts,
} from "@/lib/events/useEventAdsFunnel";
import { ensureAdsFunnelI18n } from "@/lib/i18n-admin-event-ads-funnel";

const ROW_ERROR_KEYS: Record<AdCostErrorKey, string> = {
  dayInvalid: "adminEventAdsFunnel.costs.rowErrors.dayInvalid",
  amountInvalid: "adminEventAdsFunnel.costs.rowErrors.amountInvalid",
  currencyInvalid: "adminEventAdsFunnel.costs.rowErrors.currencyInvalid",
  countInvalid: "adminEventAdsFunnel.costs.rowErrors.countInvalid",
  dayDuplicate: "adminEventAdsFunnel.costs.rowErrors.dayDuplicate",
  tooManyRows: "adminEventAdsFunnel.costs.rowErrors.tooManyRows",
  noRows: "adminEventAdsFunnel.costs.rowErrors.noRows",
};

const SOURCE_LABEL_KEYS: Record<AdCostSource, string> = {
  manual: "adminEventAdsFunnel.costSources.manual",
  csv: "adminEventAdsFunnel.costSources.csv",
};

export function AdCampaignCostsDialog({
  eventId,
  campaign,
  defaultCurrency,
  lang,
  onClose,
}: {
  eventId: string;
  /** `null` = okno zamkniete. */
  campaign: AdCampaign | null;
  defaultCurrency: string;
  lang: string;
  onClose: () => void;
}) {
  ensureAdsFunnelI18n();
  const { t } = useTranslation();
  const costsQ = useAdCampaignCosts(eventId, campaign === null ? null : campaign.id);
  const save = useSaveAdCosts(eventId);
  const remove = useDeleteAdCost(eventId);

  const [day, setDay] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [manualError, setManualError] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  const [pasteErrors, setPasteErrors] = useState<string[]>([]);

  useEffect(() => {
    if (campaign === null) return;
    setDay("");
    setAmount("");
    setCurrency(defaultCurrency);
    setManualError(null);
    setPaste("");
    setPasteErrors([]);
  }, [campaign, defaultCurrency]);

  if (campaign === null) return null;
  const campaignId = campaign.id;

  const persist = (source: AdCostSource, rows: AdCostRowInput[], after: () => void) => {
    save.mutate(
      { campaignId, source, rows },
      {
        onSuccess: (count) => {
          toast.success(t("adminEventAdsFunnel.toasts.costsSaved", { count }));
          after();
        },
        onError: (error) => toast.error(adminAdsFunnelErrorMessage(error)),
      },
    );
  };

  const addDay = () => {
    const parsed = adCostRowFromDraft({ day, amount, currency });
    if ("errorKey" in parsed) {
      setManualError(t(ROW_ERROR_KEYS[parsed.errorKey]));
      return;
    }
    setManualError(null);
    persist("manual", [parsed.row], () => {
      setDay("");
      setAmount("");
    });
  };

  const importPaste = () => {
    const parsed = parseCostsPaste(paste, defaultCurrency);
    if (parsed.errors.length > 0) {
      setPasteErrors(
        parsed.errors.map((error) =>
          t("adminEventAdsFunnel.costs.lineError", {
            line: error.line,
            message: t(ROW_ERROR_KEYS[error.errorKey]),
          }),
        ),
      );
      return;
    }
    setPasteErrors([]);
    persist("csv", parsed.rows, () => setPaste(""));
  };

  const deleteDay = (costDay: string) => {
    remove.mutate(
      { campaignId, day: costDay },
      {
        onSuccess: () => toast.success(t("adminEventAdsFunnel.toasts.costDeleted")),
        onError: (error) => toast.error(adminAdsFunnelErrorMessage(error)),
      },
    );
  };

  const costs = costsQ.data ?? [];

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="event-dialog-compact max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t("adminEventAdsFunnel.costs.title", { name: campaign.label })}
          </DialogTitle>
          <DialogDescription>{t("adminEventAdsFunnel.costs.description")}</DialogDescription>
        </DialogHeader>

        <AdminFormSection title={t("adminEventAdsFunnel.costs.manualSection")} columns={3}>
          <AdminFormTextRow
            id="ad-cost-day"
            label={t("adminEventAdsFunnel.costs.day")}
            value={day}
            onValueChange={setDay}
            maxLength={10}
            monospace
            error={manualError}
          />
          <AdminFormTextRow
            id="ad-cost-amount"
            label={t("adminEventAdsFunnel.costs.amount")}
            value={amount}
            onValueChange={setAmount}
            inputMode="decimal"
            maxLength={20}
          />
          <AdminFormTextRow
            id="ad-cost-currency"
            label={t("adminEventAdsFunnel.costs.currency")}
            value={currency}
            onValueChange={setCurrency}
            maxLength={3}
            monospace
          />
        </AdminFormSection>
        <Button size="sm" className="w-fit" onClick={addDay} disabled={save.isPending}>
          {t("adminEventAdsFunnel.costs.addDay")}
        </Button>

        <AdminFormSection
          title={t("adminEventAdsFunnel.costs.pasteSection")}
          hint={t("adminEventAdsFunnel.costs.pasteHint")}
        >
          <AdminFormTextRow
            id="ad-cost-paste"
            label={t("adminEventAdsFunnel.costs.pasteLabel")}
            value={paste}
            onValueChange={setPaste}
            rows={5}
            monospace
            placeholder={t("adminEventAdsFunnel.costs.pastePlaceholder")}
          />
        </AdminFormSection>
        {pasteErrors.length === 0 ? null : (
          <ul role="alert" className="space-y-1 text-sm text-destructive">
            {pasteErrors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
        <Button
          size="sm"
          variant="outline"
          className="w-fit"
          onClick={importPaste}
          disabled={save.isPending || paste.trim() === ""}
        >
          {t("adminEventAdsFunnel.costs.pasteImport")}
        </Button>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{t("adminEventAdsFunnel.costs.listSection")}</h3>
          <AdminCatalogListState
            isLoading={costsQ.isPending}
            loadingLabel={t("adminEventAdsFunnel.loading")}
            errorMessage={costsQ.isError ? adminAdsFunnelErrorMessage(costsQ.error) : null}
            isEmpty={costs.length === 0}
            emptyLabel={t("adminEventAdsFunnel.costs.empty")}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t("adminEventAdsFunnel.costs.day")}</TableHead>
                  <TableHead scope="col" className="text-right">
                    {t("adminEventAdsFunnel.costs.amount")}
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    {t("adminEventAdsFunnel.costs.clicks")}
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    {t("adminEventAdsFunnel.costs.impressions")}
                  </TableHead>
                  <TableHead scope="col">{t("adminEventAdsFunnel.costs.source")}</TableHead>
                  <TableHead scope="col" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {costs.map((cost) => (
                  <TableRow key={cost.day}>
                    <TableCell className="font-mono text-xs">{cost.day}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(microsToCents(cost.costMicros), cost.currency, lang)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{cost.clicks ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {cost.impressions ?? "—"}
                    </TableCell>
                    <TableCell>{t(SOURCE_LABEL_KEYS[cost.source])}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t("adminEventAdsFunnel.costs.deleteDay", { day: cost.day })}
                        onClick={() => deleteDay(cost.day)}
                        disabled={remove.isPending}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </AdminCatalogListState>
        </section>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("adminEventAdsFunnel.costs.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
