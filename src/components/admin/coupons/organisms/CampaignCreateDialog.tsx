// Organizm: okno zakładania kampanii kuponowej.
//
// CO BYŁO W TRASIE. `admin.coupons.campaigns.tsx` (dawne 337-551) - trzynaście
// kawałków stanu, walidacja, budowa ładunku, insert i obsługa odmowy w jednym
// komponencie na dole pliku trasy.
//
// CO ZOSTAŁO, A CO WYSZŁO. Reguły (bramka zapisu i ładunek) wyszły do
// `@/lib/billing/couponCampaignForm` - tam mają tabelaryczny test bez montowania
// czegokolwiek. Pola wyszły do trzech molekuł. Tutaj zostaje DOKŁADNIE to,
// czego nie da się dowieść bez renderu: że okno używa tych reguł, że odmowa
// bazy nie zamyka okna ani nie czyści pól, i że przycisk jest zablokowany na
// czas zapisu.
//
// PRZENIESIONE ZNAK W ZNAK, RAZEM Z WADAMI:
//   * odmowa bazy pokazuje SUROWY komunikat Postgresa (`error.message`),
//     nie klucz i18n - operator dostaje angielskie zdanie o CHECK-u;
//   * `busy` wraca do `false` PRZED sprawdzeniem błędu, więc po odmowie
//     przycisk znów jest aktywny (to akurat jest poprawne) - ale gdyby budowa
//     ładunku rzuciła, `busy` zostałoby na zawsze `true`.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { DatePickerField } from "@/components/admin/coupons/DatePickerField";
import { CampaignCodeShapeFields } from "@/components/admin/coupons/molecules/CampaignCodeShapeFields";
import { CampaignDiscountFields } from "@/components/admin/coupons/molecules/CampaignDiscountFields";
import { CampaignGrantsFields } from "@/components/admin/coupons/molecules/CampaignGrantsFields";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import {
  buildCampaignInsert,
  validateCampaignForm,
  type CampaignDiscountKind,
} from "@/lib/billing/couponCampaignForm";

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
  const [kind, setKind] = useState<CampaignDiscountKind>("percent");
  const [percent, setPercent] = useState(20);
  const [cents, setCents] = useState(2000);
  const [currency, setCurrency] = useState("PLN");
  const [validUntil, setValidUntil] = useState<Date | undefined>(undefined);
  const [tierKey, setTierKey] = useState("");
  const [durationDays, setDurationDays] = useState("30");
  const [segment, setSegment] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const form = {
      name,
      description,
      prefix,
      codeLength,
      codeCount,
      kind,
      percent,
      cents,
      currency,
      validUntil,
      tierKey,
      durationDays,
      segment,
    };
    const check = validateCampaignForm(form);
    if (!check.ok) {
      toast.error(t(check.errorKey));
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("b2b_coupon_campaigns").insert(buildCampaignInsert(form));
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
          <Label htmlFor="campaign-name">{t("adminCoupons.name")}</Label>
          <Input
            id="campaign-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-10 rounded-[6px]"
            placeholder="Q1 2026 - VIP subscribers"
          />
        </div>
        <div>
          <Label htmlFor="campaign-description">{t("adminCoupons.descriptionOptional")}</Label>
          <Textarea
            id="campaign-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
        </div>
        <CampaignCodeShapeFields
          prefix={prefix}
          onPrefix={setPrefix}
          codeLength={codeLength}
          onCodeLength={setCodeLength}
          codeCount={codeCount}
          onCodeCount={setCodeCount}
          labels={{
            prefix: t("adminCoupons.prefix"),
            codeLength: t("adminCoupons.codeLength"),
            codeCount: t("adminCoupons.codeCount"),
          }}
        />

        <CampaignDiscountFields
          kind={kind}
          onKind={setKind}
          percent={percent}
          onPercent={setPercent}
          cents={cents}
          onCents={setCents}
          currency={currency}
          onCurrency={setCurrency}
          labels={{
            discountType: t("adminCoupons.discountType"),
            percentOption: "%",
            fixedOption: t("adminCoupons.fixed"),
            percent: t("adminCoupons.percent"),
            amountCents: t("adminCoupons.amountCents2"),
            currency: t("adminCoupons.currency"),
          }}
        />

        <DatePickerField
          value={validUntil}
          onChange={setValidUntil}
          label={t("adminCoupons.validUntil2")}
        />

        <CampaignGrantsFields
          tiers={tiers.map((tier) => ({ key: tier.key, label: pickLocalized(tier, "name", lang) }))}
          tierKey={tierKey}
          onTierKey={setTierKey}
          durationDays={durationDays}
          onDurationDays={setDurationDays}
          labels={{
            grantsSubscription: t("adminCoupons.grantsSubscription"),
            none: t("adminCoupons.none"),
            durationDays: t("adminCoupons.durationDays"),
          }}
        />

        <div>
          <Label htmlFor="campaign-segment">{t("adminCoupons.newsletterSegmentTag")}</Label>
          <Input
            id="campaign-segment"
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
