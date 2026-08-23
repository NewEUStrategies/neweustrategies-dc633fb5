// Organizm „Nowy kupon B2B” - SKLEJENIE formularza z regułami i zapisem.
//
// TU LEŻĄ PIENIĄDZE. Ten dialog jest jedynym miejscem w panelu, które tworzy
// rabat, i jedynym, które potrafi powiedzieć redaktorowi po polsku, co jest
// nie tak z wpisaną wartością. Baza ma własne CHECK-i (`discount_percent
// BETWEEN 1 AND 100`, `discount_cents > 0`, XOR `b2b_coupons_discount_shape`),
// więc panel jest DRUGĄ linią - ale to on decyduje, czy operator dostanie
// zdanie po polsku, czy surowy komunikat Postgresa po angielsku.
//
// CO ORGANIZM WNOSI PONAD MOLEKUŁY.
//   1. WOŁA REGUŁY, nie przepisuje ich: `validateCouponForm` przed zapisem,
//      `buildCouponInsert` na ładunek. Zmiana reguły ma być zmianą w jednym
//      module, nie w JSX-ie.
//   2. DECYDUJE O SKUTKACH ODMOWY: dialog ZOSTAJE otwarty z wpisaną treścią,
//      komunikat idzie prosto z bazy, a przycisk wraca do stanu aktywnego.
//   3. ZAPIS IDZIE PROSTO DO TABELI `b2b_coupons` - żadnego RPC, żadnej
//      funkcji serwerowej. Jedynym strażnikiem po drodze są RLS i CHECK-i.
//
// PRZENIESIONE ZNAK W ZNAK, RAZEM Z WADAMI: `setBusy(true)` stoi PRZED
// budową ładunku, a `setBusy(false)` po zapisie, więc wyjątek z `toISOString()`
// (data nieparsowalna) zostawia przycisk wyłączony do przeładowania strony.
import { useState } from "react";
import { useTranslation } from "react-i18next";
// SŁOWNIK: klucze `adminCoupons.*` mieszkają w nakładce, którą trzeba jawnie
// dociągnąć - bez tego i18next zwraca sam klucz i na ekranie staje napis
// „adminCoupons.code”. Ani parytet, ani typy tego nie widzą (inwariant
// `check:i18n-overlay-imports`), dlatego wołanie stoi w tym pliku.
import { ensureI18n as ensureAdminCouponsI18n } from "@/lib/i18n-admin-coupons";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DatePickerField } from "@/components/admin/coupons/DatePickerField";
import { CouponDiscountFields } from "../molecules/CouponDiscountFields";
import { CouponGrantsFields, type CouponTierOption } from "../molecules/CouponGrantsFields";
import {
  CouponPlanRestrictionList,
  type CouponPlanOption,
} from "../molecules/CouponPlanRestrictionList";
import { buildCouponInsert, validateCouponForm } from "@/lib/billing/couponAdminForm";
import type { CouponDiscountKind } from "@/lib/billing/coupons";

interface CouponCreateDialogProps {
  plans: CouponPlanOption[];
  tiers: CouponTierOption[];
  onCreated: () => void;
}

export function CouponCreateDialog({ plans, tiers, onCreated }: CouponCreateDialogProps) {
  ensureAdminCouponsI18n();
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<CouponDiscountKind>("percent");
  const [percent, setPercent] = useState<number>(10);
  const [cents, setCents] = useState<number>(1000);
  const [currency, setCurrency] = useState("PLN");
  const [maxRedemptions, setMaxRedemptions] = useState<string>("");
  const [validFrom, setValidFrom] = useState<Date | undefined>(undefined);
  const [validUntil, setValidUntil] = useState<Date | undefined>(undefined);
  const [planIds, setPlanIds] = useState<string[]>([]);
  const [grantsTierKey, setGrantsTierKey] = useState<string>("");
  const [grantsDurationDays, setGrantsDurationDays] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const form = {
      code,
      name,
      description,
      kind,
      percent,
      cents,
      currency,
      maxRedemptions,
      validFrom,
      validUntil,
      planIds,
      grantsTierKey,
      grantsDurationDays,
    };
    const verdict = validateCouponForm(form);
    if (!verdict.ok) {
      toast.error(t(verdict.errorKey));
      return;
    }
    setBusy(true);
    const payload = buildCouponInsert(form);
    const { error } = await supabase.from("b2b_coupons").insert(payload);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("adminCoupons.couponCreated"));
    onCreated();
  };

  return (
    <DialogContent className="max-w-xl">
      <DialogHeader>
        <DialogTitle>{t("adminCoupons.newB2bCoupon")}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{t("adminCoupons.code")}</Label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="NES-B2B-10"
              className="uppercase h-10 rounded-[6px]"
            />
          </div>
          <div>
            <Label>{t("adminCoupons.nameOptional")}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-10 rounded-[6px]"
            />
          </div>
        </div>

        <div>
          <Label>{t("adminCoupons.internalDescription")}</Label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </div>

        <CouponDiscountFields
          kind={kind}
          onKind={setKind}
          percent={percent}
          onPercent={setPercent}
          cents={cents}
          onCents={setCents}
          currency={currency}
          onCurrency={setCurrency}
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{t("adminCoupons.maxRedemptions")}</Label>
            <Input
              type="number"
              min={1}
              value={maxRedemptions}
              onChange={(e) => setMaxRedemptions(e.target.value)}
              placeholder={t("adminCoupons.unlimited")}
              className="h-10 rounded-[6px]"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <DatePickerField
              value={validFrom}
              onChange={setValidFrom}
              label={t("adminCoupons.valid")}
            />
            <DatePickerField
              value={validUntil}
              onChange={setValidUntil}
              label={t("adminCoupons.validUntil")}
            />
          </div>
        </div>

        <CouponGrantsFields
          tiers={tiers}
          tierKey={grantsTierKey}
          onTierKey={setGrantsTierKey}
          durationDays={grantsDurationDays}
          onDurationDays={setGrantsDurationDays}
          lang={lang}
        />

        <CouponPlanRestrictionList
          plans={plans}
          selected={planIds}
          onToggle={(id, checked) =>
            setPlanIds((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)))
          }
          lang={lang}
        />
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={busy} className="h-10 rounded-[6px]">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("adminCoupons.createCoupon")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
