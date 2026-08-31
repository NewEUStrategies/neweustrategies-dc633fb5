// Organizm: dialog tworzenia kuponu B2B.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-coupons";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePickerField } from "@/components/admin/coupons/DatePickerField";
import type { CouponDiscountKind } from "@/lib/billing/coupons";
import { normalizeCouponCode } from "@/lib/billing/coupons";

export interface CreateDialogProps {
  plans: Array<{ id: string; name_pl: string | null; name_en: string | null; active: boolean }>;
  tiers: Array<{ key: string; name_pl: string; name_en: string; active: boolean }>;
  onCreated: () => void;
}

export function CouponCreateDialog({ plans, tiers, onCreated }: CreateDialogProps) {
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
    const norm = normalizeCouponCode(code);
    if (!norm) {
      toast.error(t("adminCoupons.enterCode"));
      return;
    }
    if (kind === "percent" && (percent < 1 || percent > 100)) {
      toast.error(t("adminCoupons.percent1100"));
      return;
    }
    if (kind === "fixed" && cents <= 0) {
      toast.error(t("adminCoupons.amount0"));
      return;
    }
    setBusy(true);
    const payload = {
      code: norm,
      name: name.trim() || null,
      description: description.trim() || null,
      discount_kind: kind,
      discount_percent: kind === "percent" ? percent : null,
      discount_cents: kind === "fixed" ? cents : null,
      currency: kind === "fixed" ? currency.toUpperCase() : null,
      max_redemptions: maxRedemptions ? Number(maxRedemptions) : null,
      valid_from: validFrom ? validFrom.toISOString() : null,
      valid_until: validUntil ? validUntil.toISOString() : null,
      plan_ids: planIds,
      grants_tier_key: grantsTierKey || null,
      grants_duration_days: grantsDurationDays ? Number(grantsDurationDays) : null,
    };
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
            <Label htmlFor="coupon-code">{t("adminCoupons.code")}</Label>
            <Input
              id="coupon-code"
              value={code}
              // Normalizacja JUZ W POLU, nie dopiero przy zapisie: klasa
              // `uppercase` zmienia wylacznie obraz, wiec zaznaczenie i schowek
              // oddawaly „nes-b2b-10" tam, gdzie na ekranie stalo „NES-B2B-10".
              // Roznica ujawniala sie dopiero przy kasie, po wyslaniu kodu
              // partnerowi.
              onChange={(e) => setCode(normalizeCouponCode(e.target.value))}
              placeholder="NES-B2B-10"
              className="uppercase h-10 rounded-[6px]"
            />
          </div>
          <div>
            <Label htmlFor="coupon-name">{t("adminCoupons.nameOptional")}</Label>
            <Input
              id="coupon-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-10 rounded-[6px]"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="coupon-description">{t("adminCoupons.internalDescription")}</Label>
          <Textarea
            id="coupon-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="coupon-discount-kind">{t("adminCoupons.discountType")}</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as CouponDiscountKind)}>
              <SelectTrigger id="coupon-discount-kind" className="h-10 rounded-[6px]">
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
              <Label htmlFor="coupon-percent">{t("adminCoupons.percent")}</Label>
              <Input
                id="coupon-percent"
                type="number"
                min={1}
                max={100}
                value={percent}
                onChange={(e) => setPercent(Number(e.target.value))}
                className="h-10 rounded-[6px]"
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="coupon-cents">{t("adminCoupons.amountCents")}</Label>
                <Input
                  id="coupon-cents"
                  type="number"
                  min={1}
                  value={cents}
                  onChange={(e) => setCents(Number(e.target.value))}
                  className="h-10 rounded-[6px]"
                />
              </div>
              <div>
                <Label htmlFor="coupon-currency">{t("adminCoupons.currency")}</Label>
                <Input
                  id="coupon-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  maxLength={4}
                  className="h-10 rounded-[6px]"
                />
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="coupon-max-redemptions">{t("adminCoupons.maxRedemptions")}</Label>
            <Input
              id="coupon-max-redemptions"
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

        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/60">
          <div>
            <Label htmlFor="coupon-grants-tier">
              {t("adminCoupons.grantsSubscriptionOptional")}
            </Label>
            <Select
              value={grantsTierKey || "none"}
              onValueChange={(v) => setGrantsTierKey(v === "none" ? "" : v)}
            >
              <SelectTrigger id="coupon-grants-tier" className="h-10 rounded-[6px]">
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
            <Label htmlFor="coupon-duration-days">{t("adminCoupons.durationDays")}</Label>
            <Input
              id="coupon-duration-days"
              type="number"
              min={1}
              value={grantsDurationDays}
              onChange={(e) => setGrantsDurationDays(e.target.value)}
              placeholder={t("adminCoupons.unlimited2")}
              disabled={!grantsTierKey}
              className="h-10 rounded-[6px]"
            />
          </div>
        </div>

        <div>
          <Label>{t("adminCoupons.restrictPlansOptional")}</Label>
          <div className="rounded-[6px] border border-border/60 p-2 max-h-40 overflow-y-auto space-y-1">
            {plans.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("adminCoupons.plansAvailable")}</p>
            )}
            {plans.map((p) => {
              const on = planIds.includes(p.id);
              return (
                <label
                  key={p.id}
                  className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/40 rounded px-1.5 py-1"
                >
                  <Checkbox
                    checked={on}
                    onCheckedChange={(v) =>
                      setPlanIds((prev) => (v ? [...prev, p.id] : prev.filter((id) => id !== p.id)))
                    }
                  />
                  <span className={p.active ? "" : "text-muted-foreground line-through"}>
                    {pickLocalized(p, "name", lang)}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={busy} className="h-10 rounded-[6px]">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("adminCoupons.createCoupon")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
