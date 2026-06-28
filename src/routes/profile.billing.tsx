import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { fetchMyBillingProfile, upsertMyBillingProfile } from "@/lib/billing/queries";
import type { BillingProfileInput } from "@/lib/billing/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FieldLabel } from "@/components/profile/FieldLabel";
import { toast } from "sonner";

export const Route = createFileRoute("/profile/billing")({
  component: BillingPage,
});

const EMPTY: BillingProfileInput = {
  full_name: "",
  company: "",
  tax_id: "",
  email: "",
  phone: "",
  address_line1: "",
  address_line2: "",
  city: "",
  postal_code: "",
  region: "",
  country_code: "PL",
  is_company: false,
};

function BillingPage() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState<BillingProfileInput>(EMPTY);
  const [busy, setBusy] = useState(false);

  const { data } = useQuery({
    queryKey: ["my-billing"],
    queryFn: fetchMyBillingProfile,
    enabled: !!session,
  });

  useEffect(() => {
    if (data) {
      setForm({
        full_name: data.full_name ?? "",
        company: data.company ?? "",
        tax_id: data.tax_id ?? "",
        email: data.email ?? "",
        phone: data.phone ?? "",
        address_line1: data.address_line1 ?? "",
        address_line2: data.address_line2 ?? "",
        city: data.city ?? "",
        postal_code: data.postal_code ?? "",
        region: data.region ?? "",
        country_code: data.country_code ?? "PL",
        is_company: !!data.is_company,
      });
    }
  }, [data]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await upsertMyBillingProfile(form);
      await qc.invalidateQueries({ queryKey: ["my-billing"] });
      toast.success(t("profile.billing.saved"));
    } catch (err) {
      toast.error(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  };

  const set = <K extends keyof BillingProfileInput>(key: K, value: BillingProfileInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <TooltipProvider>
    <Card>
      <CardHeader>
        <CardTitle>{t("profile.billing.title")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("profile.billing.subtitle")}</p>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 max-w-2xl" onSubmit={save}>
          <div className="flex items-center gap-2">
            <Switch
              id="is_company"
              checked={form.is_company}
              onCheckedChange={(v) => set("is_company", v)}
            />
            <Label htmlFor="is_company" title={t("profile.billing.tip.isCompany")}>{t("profile.billing.isCompany")}</Label>
          </div>

          {form.is_company ? (
            <div className="grid gap-2">
              <FieldLabel htmlFor="company" tip={t("profile.billing.tip.company")}>{t("profile.billing.company")}</FieldLabel>
              <Input id="company" value={form.company ?? ""} onChange={(e) => set("company", e.target.value)} required maxLength={200} />
            </div>
          ) : (
            <div className="grid gap-2">
              <FieldLabel htmlFor="full_name" tip={t("profile.billing.tip.fullName")}>{t("profile.billing.fullName")}</FieldLabel>
              <Input id="full_name" value={form.full_name ?? ""} onChange={(e) => set("full_name", e.target.value)} required maxLength={200} />
            </div>
          )}

          {form.is_company && (
            <div className="grid gap-2">
              <FieldLabel htmlFor="tax_id" tip={t("profile.billing.tip.taxId")}>{t("profile.billing.taxId")}</FieldLabel>
              <Input id="tax_id" value={form.tax_id ?? ""} onChange={(e) => set("tax_id", e.target.value)} maxLength={40} />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <FieldLabel htmlFor="email" tip={t("profile.billing.tip.email")}>{t("profile.billing.email")}</FieldLabel>
              <Input id="email" type="email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} maxLength={200} />
            </div>
            <div className="grid gap-2">
              <FieldLabel htmlFor="phone" tip={t("profile.billing.tip.phone")}>{t("profile.billing.phone")}</FieldLabel>
              <Input id="phone" value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} maxLength={40} />
            </div>
          </div>

          <div className="grid gap-2">
            <FieldLabel htmlFor="address_line1" tip={t("profile.billing.tip.addressLine1")}>{t("profile.billing.addressLine1")}</FieldLabel>
            <Input id="address_line1" value={form.address_line1 ?? ""} onChange={(e) => set("address_line1", e.target.value)} required maxLength={200} />
          </div>
          <div className="grid gap-2">
            <FieldLabel htmlFor="address_line2" tip={t("profile.billing.tip.addressLine2")}>{t("profile.billing.addressLine2")}</FieldLabel>
            <Input id="address_line2" value={form.address_line2 ?? ""} onChange={(e) => set("address_line2", e.target.value)} maxLength={200} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="grid gap-2">
              <FieldLabel htmlFor="postal_code" tip={t("profile.billing.tip.postalCode")}>{t("profile.billing.postalCode")}</FieldLabel>
              <Input id="postal_code" value={form.postal_code ?? ""} onChange={(e) => set("postal_code", e.target.value)} required maxLength={20} />
            </div>
            <div className="grid gap-2">
              <FieldLabel htmlFor="city" tip={t("profile.billing.tip.city")}>{t("profile.billing.city")}</FieldLabel>
              <Input id="city" value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} required maxLength={100} />
            </div>
            <div className="grid gap-2">
              <FieldLabel htmlFor="region" tip={t("profile.billing.tip.region")}>{t("profile.billing.region")}</FieldLabel>
              <Input id="region" value={form.region ?? ""} onChange={(e) => set("region", e.target.value)} maxLength={100} />
            </div>
          </div>

          <div className="grid gap-2">
            <FieldLabel htmlFor="country_code" tip={t("profile.billing.tip.country")}>{t("profile.billing.country")}</FieldLabel>
            <Input id="country_code" value={form.country_code} onChange={(e) => set("country_code", e.target.value.toUpperCase())} maxLength={2} required />
          </div>

          <Button type="submit" disabled={busy} title={t("profile.billing.tip.save")}>{t("profile.billing.save")}</Button>
        </form>
      </CardContent>
    </Card>
    </TooltipProvider>
  );
}
