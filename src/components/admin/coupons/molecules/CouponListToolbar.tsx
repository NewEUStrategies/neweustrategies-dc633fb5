// Molekuła: pasek narzędzi listy - szukanie i filtr statusu.
//
// Cztery wartości filtra są ROZŁĄCZNE, a „wygasłe” IGNORUJE flagę aktywności:
// kupon nieaktywny i przeterminowany trafia do „wygasłych”, nie do
// „nieaktywnych”. Ta reguła mieszka w `filterCoupons`; tutaj jest tylko
// wybór wartości i miejsce (`children`) na przycisk otwierający dialog.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
// SŁOWNIK: klucze `adminCoupons.*` mieszkają w nakładce, którą trzeba jawnie
// dociągnąć - bez tego i18next zwraca sam klucz i na ekranie staje napis
// „adminCoupons.code”. Ani parytet, ani typy tego nie widzą (inwariant
// `check:i18n-overlay-imports`), dlatego wołanie stoi w tym pliku.
import { ensureI18n as ensureAdminCouponsI18n } from "@/lib/i18n-admin-coupons";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CouponListStatus } from "@/lib/billing/couponAdminList";

interface CouponListToolbarProps {
  search: string;
  onSearch: (value: string) => void;
  status: CouponListStatus;
  onStatus: (value: CouponListStatus) => void;
  children?: ReactNode;
}

export function CouponListToolbar({
  search,
  onSearch,
  status,
  onStatus,
  children,
}: CouponListToolbarProps) {
  ensureAdminCouponsI18n();
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={t("adminCoupons.searchCodeName")}
          className="h-10 w-56 rounded-[6px]"
        />
        <Select value={status} onValueChange={(v) => onStatus(v as CouponListStatus)}>
          <SelectTrigger className="h-10 w-40 rounded-[6px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("adminCoupons.all")}</SelectItem>
            <SelectItem value="active">{t("adminCoupons.active")}</SelectItem>
            <SelectItem value="inactive">{t("adminCoupons.inactive")}</SelectItem>
            <SelectItem value="expired">{t("adminCoupons.expired")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {children}
    </div>
  );
}
