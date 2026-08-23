// Molekuła: subskrypcja nadawana przez kupon - warstwa i długość nadania.
//
// PARA, KTÓRA POWINNA BYĆ NIEROZŁĄCZNA, ROZŁĄCZNA JEST. Pole liczby dni jest
// wyłącznie `disabled={!tierKey}` - powrót do „Brak” NIE czyści stanu, więc
// wpisana wcześniej liczba dni zostaje i wychodzi do bazy jako sierota
// (`grants_tier_key: null` + `grants_duration_days: 30`). Kampanie robią to
// odwrotnie (bramkują dni warstwą). Zachowanie przeniesione bez zmian -
// naprawa i refaktoryzacja nie jadą razem.
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
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import type { LocaleCode } from "@/lib/i18n/pickLocalized";

export interface CouponTierOption {
  key: string;
  name_pl: string;
  name_en: string;
  active: boolean;
}

interface CouponGrantsFieldsProps {
  tiers: CouponTierOption[];
  tierKey: string;
  onTierKey: (key: string) => void;
  durationDays: string;
  onDurationDays: (value: string) => void;
  lang: LocaleCode;
}

export function CouponGrantsFields({
  tiers,
  tierKey,
  onTierKey,
  durationDays,
  onDurationDays,
  lang,
}: CouponGrantsFieldsProps) {
  ensureAdminCouponsI18n();
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/60">
      <div>
        <Label>{t("adminCoupons.grantsSubscriptionOptional")}</Label>
        <Select value={tierKey || "none"} onValueChange={(v) => onTierKey(v === "none" ? "" : v)}>
          <SelectTrigger className="h-10 rounded-[6px]">
            <SelectValue placeholder={t("adminCoupons.none")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("adminCoupons.none")}</SelectItem>
            {tiers.map((tier) => (
              <SelectItem key={tier.key} value={tier.key}>
                {pickLocalized(tier, "name", lang)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>{t("adminCoupons.durationDays")}</Label>
        <Input
          type="number"
          min={1}
          value={durationDays}
          onChange={(e) => onDurationDays(e.target.value)}
          placeholder={t("adminCoupons.unlimited2")}
          disabled={!tierKey}
          className="h-10 rounded-[6px]"
        />
      </div>
    </div>
  );
}
