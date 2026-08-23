// Molekuła: pasek czterech kafli nad listą kuponów.
//
// Liczby przychodzą GOTOWE z `couponListStats` - molekuła niczego nie liczy,
// żeby definicja „wygasłego” mieszkała w jednym miejscu (module reguł),
// a nie drugi raz w widoku.
import { useTranslation } from "react-i18next";
// SŁOWNIK: klucze `adminCoupons.*` mieszkają w nakładce, którą trzeba jawnie
// dociągnąć - bez tego i18next zwraca sam klucz i na ekranie staje napis
// „adminCoupons.code”. Ani parytet, ani typy tego nie widzą (inwariant
// `check:i18n-overlay-imports`), dlatego wołanie stoi w tym pliku.
import { ensureI18n as ensureAdminCouponsI18n } from "@/lib/i18n-admin-coupons";
import { CouponStatCard } from "../atoms/CouponStatCard";
import type { CouponListStats } from "@/lib/billing/couponAdminList";

export function CouponStatsRow({ stats }: { stats: CouponListStats }) {
  ensureAdminCouponsI18n();
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <CouponStatCard label={t("adminCoupons.total")} value={String(stats.total)} />
      <CouponStatCard label={t("adminCoupons.active")} value={String(stats.active)} />
      <CouponStatCard
        label={t("adminCoupons.totalRedemptions")}
        value={String(stats.redemptions)}
      />
      <CouponStatCard label={t("adminCoupons.expired")} value={String(stats.expired)} />
    </div>
  );
}
