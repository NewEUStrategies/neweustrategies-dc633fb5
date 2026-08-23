// Molekuła: rodzaj rabatu i jego wartość (procent ALBO kwota + waluta).
//
// DLACZEGO TO JEDNA MOLEKUŁA. Rodzaj rabatu decyduje o tym, KTÓRE pole
// w ogóle istnieje w formularzu - a to samo rozgałęzienie decyduje potem
// o kształcie ładunku (`discount_percent` XOR `discount_cents`, `currency`
// tylko przy kwocie). Rozdzielenie tego na dwie kontrolki dawało dwa miejsca,
// w których trzeba pamiętać o tej samej regule.
//
// PRZENIESIONE ZNAK W ZNAK: `Number(e.target.value)` zostaje w `onChange`,
// więc wartość nieliczbowa wchodzi do stanu jako `NaN` (a pole opróżnione -
// jako `0`). Molekuła tego nie zaciska; robi to dopiero test jako zgłoszenie.
import { useTranslation } from "react-i18next";
// SŁOWNIK: klucze `adminCoupons.*` mieszkają w nakładce, którą trzeba jawnie
// dociągnąć - bez tego i18next zwraca sam klucz i na ekranie staje napis
// „adminCoupons.code”. Ani parytet, ani typy tego nie widzą (inwariant
// `check:i18n-overlay-imports`), dlatego wołanie stoi w tym pliku.
import { ensureI18n as ensureAdminCouponsI18n } from "@/lib/i18n-admin-coupons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CouponDiscountKind } from "@/lib/billing/coupons";

interface CouponDiscountFieldsProps {
  kind: CouponDiscountKind;
  onKind: (kind: CouponDiscountKind) => void;
  percent: number;
  onPercent: (percent: number) => void;
  cents: number;
  onCents: (cents: number) => void;
  currency: string;
  onCurrency: (currency: string) => void;
}

export function CouponDiscountFields({
  kind,
  onKind,
  percent,
  onPercent,
  cents,
  onCents,
  currency,
  onCurrency,
}: CouponDiscountFieldsProps) {
  ensureAdminCouponsI18n();
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <Label>{t("adminCoupons.discountType")}</Label>
        <Select value={kind} onValueChange={(v) => onKind(v as CouponDiscountKind)}>
          <SelectTrigger className="h-10 rounded-[6px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="percent">%</SelectItem>
            <SelectItem value="fixed">{t("adminCoupons.fixed")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {kind === "percent" ? (
        <div>
          <Label>{t("adminCoupons.percent")}</Label>
          <Input
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
            <Label>{t("adminCoupons.amountCents")}</Label>
            <Input
              type="number"
              min={1}
              value={cents}
              onChange={(e) => onCents(Number(e.target.value))}
              className="h-10 rounded-[6px]"
            />
          </div>
          <div>
            <Label>{t("adminCoupons.currency")}</Label>
            <Input
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
