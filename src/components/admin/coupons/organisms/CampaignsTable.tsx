// Organizm: lista kampanii kuponowych.
//
// CO BYŁO W TRASIE. `admin.coupons.campaigns.tsx` (dawne 214-332) - karta,
// trzy stany zawartości i siedmiokolumnowa tabela w jednym ciągu JSX-a.
//
// CO TU JEST RYZYKIEM. Trzy komórki niosą liczby, po których operator decyduje
// o masowej wysyłce: rabat (który przy uszkodzonym wierszu potrafi napisać
// „null%" albo „0.00"), licznik wygenerowanych kodów i status. Każda z nich ma
// własny atom z własnym testem, a organizm dowodzi wyłącznie SKLEJENIA:
// że wiersz dostaje swoje dane i że akcje wołają zdarzenia z ID właściwego
// wiersza.
//
// PRZENIESIONE ZNAK W ZNAK, RAZEM Z WADĄ. Stan „nie ma kampanii" i stan
// „odczyt się nie udał" są NIEROZRÓŻNIALNE: obie ścieżki pokazują ten sam
// napis, bo trasa nie ma gałęzi `isError`. Świadomie NIE dodaję tu propa
// `failed` - nowy komunikat byłby zmianą zachowania produkcyjnego, a nie
// ekstrakcją. Defekt jest zgłoszony przez `it.fails` w teście trasy.
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CampaignDiscountCell } from "@/components/admin/coupons/atoms/CampaignDiscountCell";
import { CampaignStatusBadge } from "@/components/admin/coupons/atoms/CampaignStatusBadge";
import { CampaignTierBadge } from "@/components/admin/coupons/atoms/CampaignTierBadge";
import {
  CampaignRowActions,
  type CampaignRowActionLabels,
} from "@/components/admin/coupons/molecules/CampaignRowActions";
import type { CampaignDiscountKind, CampaignStatus } from "@/lib/billing/couponCampaignForm";

/** Wiersz listy kampanii - kolumny czytane wprost z `b2b_coupon_campaigns`. */
export interface CampaignTableRow {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly code_count: number;
  readonly generated_count: number;
  readonly discount_kind: CampaignDiscountKind;
  readonly discount_percent: number | null;
  readonly discount_cents: number | null;
  readonly currency: string | null;
  readonly grants_tier_key: string | null;
  readonly grants_duration_days: number | null;
  readonly newsletter_segment: string | null;
  readonly status: CampaignStatus;
}

export interface CampaignsTableLabels extends CampaignRowActionLabels {
  readonly title: string;
  readonly loading: string;
  readonly empty: string;
  readonly name: string;
  readonly discount: string;
  readonly codes: string;
  readonly subscription: string;
  readonly segment: string;
  readonly status: string;
  readonly actions: string;
  /** Napis plakietki statusu - wołający decyduje, czy tłumaczy enum. */
  statusLabel: (status: CampaignStatus) => string;
}

// Generyczny po wierszu, bo trasa czyta z bazy WIĘCEJ kolumn, niż tabela
// rysuje (m.in. `valid_until` i `newsletter_segment` potrzebne do szkicu
// newslettera). Bez tego zdarzenia oddawałyby okrojony wiersz i wołający
// musiałby go rzutować z powrotem - czyli tracić dokładnie tę kontrolę typu,
// dla której ekstrakcja się odbywa.
export function CampaignsTable<Row extends CampaignTableRow>({
  rows,
  loading,
  labels,
  generating,
  sending,
  onGenerate,
  onExport,
  onSend,
  onArchive,
}: {
  rows: readonly Row[];
  loading: boolean;
  labels: CampaignsTableLabels;
  generating: boolean;
  sending: boolean;
  onGenerate: (row: Row) => void;
  onExport: (row: Row) => void;
  onSend: (row: Row) => void;
  onArchive: (row: Row) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{labels.title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" />
            {labels.loading}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6">{labels.empty}</p>
        ) : (
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground uppercase">
                <tr className="border-b border-border/60">
                  <th className="text-left py-2 pr-3">{labels.name}</th>
                  <th className="text-left py-2 pr-3">{labels.discount}</th>
                  <th className="text-left py-2 pr-3">{labels.codes}</th>
                  <th className="text-left py-2 pr-3">{labels.subscription}</th>
                  <th className="text-left py-2 pr-3">{labels.segment}</th>
                  <th className="text-left py-2 pr-3">{labels.status}</th>
                  <th className="text-right py-2">{labels.actions}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="border-b border-border/40">
                    <td className="py-3 pr-3">
                      <div className="font-medium">{c.name}</div>
                      {c.prefix && (
                        <div className="text-xs text-muted-foreground font-mono">{c.prefix}***</div>
                      )}
                    </td>
                    <td className="py-3 pr-3">
                      <CampaignDiscountCell
                        kind={c.discount_kind}
                        percent={c.discount_percent}
                        cents={c.discount_cents}
                        currency={c.currency}
                      />
                    </td>
                    <td className="py-3 pr-3">
                      {c.generated_count} / {c.code_count}
                    </td>
                    <td className="py-3 pr-3 text-xs">
                      <CampaignTierBadge
                        tierKey={c.grants_tier_key}
                        durationDays={c.grants_duration_days}
                      />
                    </td>
                    <td className="py-3 pr-3 text-xs">
                      {c.newsletter_segment ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-3 pr-3">
                      <CampaignStatusBadge status={c.status} label={labels.statusLabel(c.status)} />
                    </td>
                    <td className="py-3 text-right">
                      <CampaignRowActions
                        status={c.status}
                        generating={generating}
                        sending={sending}
                        onGenerate={() => onGenerate(c)}
                        onExport={() => onExport(c)}
                        onSend={() => onSend(c)}
                        onArchive={() => onArchive(c)}
                        labels={labels}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
