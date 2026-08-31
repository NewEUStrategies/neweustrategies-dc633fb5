// Organizm: dialog tworzenia kampanii kuponowej.
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
import { DatePickerField } from "@/components/admin/coupons/DatePickerField";

export function CampaignCreateDialog({
  tiers,
  onCreated,
}: {
  tiers: Array<{ key: string; name_pl: string; name_en: string }>;
  onCreated: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prefix, setPrefix] = useState("");
  const [codeLength, setCodeLength] = useState(8);
  const [codeCount, setCodeCount] = useState(100);
  const [kind, setKind] = useState<"percent" | "fixed">("percent");
  const [percent, setPercent] = useState(20);
  const [cents, setCents] = useState(2000);
  const [currency, setCurrency] = useState("PLN");
  const [validUntil, setValidUntil] = useState<Date | undefined>(undefined);
  const [tierKey, setTierKey] = useState("");
  const [durationDays, setDurationDays] = useState("30");
  const [segment, setSegment] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      toast.error(t("adminCoupons.enterName"));
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("b2b_coupon_campaigns").insert({
      name: name.trim(),
      description: description.trim() || null,
      prefix: prefix.trim(),
      code_length: codeLength,
      code_count: codeCount,
      discount_kind: kind,
      discount_percent: kind === "percent" ? percent : null,
      discount_cents: kind === "fixed" ? cents : null,
      currency: kind === "fixed" ? currency.toUpperCase() : null,
      valid_until: validUntil ? validUntil.toISOString() : null,
      grants_tier_key: tierKey || null,
      grants_duration_days: durationDays && tierKey ? Number(durationDays) : null,
      newsletter_segment: segment.trim() || null,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("adminCoupons.campaignCreatedDraft"));
    onCreated();
  };

  return (
    <DialogContent className="max-w-xl">
      <DialogHeader>
        <DialogTitle>{t("adminCoupons.newCouponCampaign")}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>{t("adminCoupons.name")}</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-10 rounded-[6px]"
            placeholder="Q1 2026 - VIP subscribers"
          />
        </div>
        <div>
          <Label>{t("adminCoupons.descriptionOptional")}</Label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label>{t("adminCoupons.prefix")}</Label>
            <Input
              value={prefix}
              onChange={(e) => setPrefix(e.target.value.toUpperCase())}
              placeholder="NES-"
              className="h-10 rounded-[6px] uppercase"
            />
          </div>
          <div>
            <Label>{t("adminCoupons.codeLength")}</Label>
            <Input
              type="number"
              min={4}
              max={24}
              value={codeLength}
              onChange={(e) => setCodeLength(Number(e.target.value))}
              className="h-10 rounded-[6px]"
            />
          </div>
          <div>
            <Label>{t("adminCoupons.codeCount")}</Label>
            <Input
              type="number"
              min={1}
              max={10000}
              value={codeCount}
              onChange={(e) => setCodeCount(Number(e.target.value))}
              className="h-10 rounded-[6px]"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{t("adminCoupons.discountType")}</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as "percent" | "fixed")}>
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
                onChange={(e) => setPercent(Number(e.target.value))}
                className="h-10 rounded-[6px]"
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>{t("adminCoupons.amountCents2")}</Label>
                <Input
                  type="number"
                  min={1}
                  value={cents}
                  onChange={(e) => setCents(Number(e.target.value))}
                  className="h-10 rounded-[6px]"
                />
              </div>
              <div>
                <Label>{t("adminCoupons.currency")}</Label>
                <Input
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  maxLength={4}
                  className="h-10 rounded-[6px]"
                />
              </div>
            </div>
          )}
        </div>

        <DatePickerField
          value={validUntil}
          onChange={setValidUntil}
          label={t("adminCoupons.validUntil2")}
        />

        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/60">
          <div>
            <Label>{t("adminCoupons.grantsSubscription")}</Label>
            <Select
              value={tierKey || "none"}
              onValueChange={(v) => setTierKey(v === "none" ? "" : v)}
            >
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
              onChange={(e) => setDurationDays(e.target.value)}
              disabled={!tierKey}
              className="h-10 rounded-[6px]"
            />
          </div>
        </div>

        <div>
          <Label>{t("adminCoupons.newsletterSegmentTag")}</Label>
          <Input
            value={segment}
            onChange={(e) => setSegment(e.target.value)}
            placeholder="vip"
            className="h-10 rounded-[6px]"
          />
        </div>
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={busy} className="h-10 rounded-[6px]">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("adminCoupons.createCampaign")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
