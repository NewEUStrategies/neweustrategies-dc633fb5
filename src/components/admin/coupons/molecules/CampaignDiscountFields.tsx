// Molekuła: rodzaj rabatu kampanii i jego wartość (procent ALBO kwota + waluta).
//
// CO BYŁO W TRASIE. `admin.coupons.campaigns.tsx` (dawne 445-493).
//
// DLACZEGO TO JEST DECYZJA. Wybór rodzaju rabatu przełącza CAŁE pole wartości:
// przy „percent" pola kwoty i waluty NIE ISTNIEJĄ w drzewie, a przy „fixed" nie
// istnieje pole procentu. To właśnie ten warunek gwarantuje, że w ładunku
// dokładnie jedno pole rabatu jest niepuste - i to on musi mieć test, a nie
// szerokość kolumn siatki.
//
// PRZENIESIONE ZNAK W ZNAK, RAZEM Z WADAMI:
//   * wartości są LICZBAMI ze stanu zasilanego `Number(e.target.value)`, więc
//     wyczyszczone pole procentu daje 0, a wpis nieliczbowy NaN - i jedno,
//     i drugie idzie do bazy (walidacji zakresu ten formularz NIE MA);
//   * pole waluty przyjmuje dowolne cztery znaki i nie jest wymagane, a kolumna
//     `currency` nie ma po stronie bazy żadnego CHECK-a.
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CampaignDiscountKind } from "@/lib/billing/couponCampaignForm";

export interface CampaignDiscountLabels {
  readonly discountType: string;
  readonly percentOption: string;
  readonly fixedOption: string;
  readonly percent: string;
  readonly amountCents: string;
  readonly currency: string;
}

export function CampaignDiscountFields({
  kind,
  onKind,
  percent,
  onPercent,
  cents,
  onCents,
  currency,
  onCurrency,
  labels,
}: {
  kind: CampaignDiscountKind;
  onKind: (value: CampaignDiscountKind) => void;
  percent: number;
  onPercent: (value: number) => void;
  cents: number;
  onCents: (value: number) => void;
  currency: string;
  onCurrency: (value: string) => void;
  labels: CampaignDiscountLabels;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <Label>{labels.discountType}</Label>
        <Select value={kind} onValueChange={(v) => onKind(v as CampaignDiscountKind)}>
          <SelectTrigger className="h-10 rounded-[6px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="percent">{labels.percentOption}</SelectItem>
            <SelectItem value="fixed">{labels.fixedOption}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {kind === "percent" ? (
        <div>
          <Label htmlFor="campaign-percent">{labels.percent}</Label>
          <Input
            id="campaign-percent"
            type="number"
            min={1}
            max={100}
            value={percent}
            onChange={(e) => onPercent(Number(e.target.value))}
            className="h-10 rounded-[6px]"
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="campaign-cents">{labels.amountCents}</Label>
            <Input
              id="campaign-cents"
              type="number"
              min={1}
              value={cents}
              onChange={(e) => onCents(Number(e.target.value))}
              className="h-10 rounded-[6px]"
            />
          </div>
          <div>
            <Label htmlFor="campaign-currency">{labels.currency}</Label>
            <Input
              id="campaign-currency"
              value={currency}
              onChange={(e) => onCurrency(e.target.value)}
              maxLength={4}
              className="h-10 rounded-[6px]"
            />
          </div>
        </div>
      )}
    </div>
  );
}
