// Panel warstw członkostwa: edycja katalogu warstw (nazwy, benefity, ranga)
// oraz mapowania plan sprzedażowy -> warstwa (access_plans.tier_key).
// Benefity edytowane jako pary linii PL/EN (indeks = para) - celowo bez
// edytora JSON; features (bramki maszynowe) jako surowy JSON dla adminów.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BadgeCheck, Crown, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchActivePlans } from "@/lib/billing/queries";
import { planName } from "@/lib/billing/types";
import { parseTierBenefits, type MembershipTierRow } from "@/lib/billing/tiers";
import type { Json } from "@/integrations/supabase/types";

export const Route = createFileRoute("/admin/membership")({
  component: AdminMembershipPage,
});

interface TierDraft {
  name_pl: string;
  name_en: string;
  description_pl: string;
  description_en: string;
  rank: number;
  benefits_pl: string;
  benefits_en: string;
  features: string;
  active: boolean;
  is_default: boolean;
}

function draftFromTier(tier: MembershipTierRow): TierDraft {
  const benefits = parseTierBenefits(tier.benefits);
  return {
    name_pl: tier.name_pl,
    name_en: tier.name_en,
    description_pl: tier.description_pl ?? "",
    description_en: tier.description_en ?? "",
    rank: tier.rank,
    benefits_pl: benefits.map((b) => b.pl).join("\n"),
    benefits_en: benefits.map((b) => b.en).join("\n"),
    features: JSON.stringify(tier.features ?? {}, null, 0),
    active: tier.active,
    is_default: tier.is_default,
  };
}

function benefitsFromDraft(draft: TierDraft): Json {
  const pl = draft.benefits_pl.split("\n").map((s) => s.trim());
  const en = draft.benefits_en.split("\n").map((s) => s.trim());
  const len = Math.max(pl.length, en.length);
  const out: { pl: string; en: string }[] = [];
  for (let i = 0; i < len; i++) {
    const p = pl[i] ?? "";
    const e = en[i] ?? "";
    if (p || e) out.push({ pl: p || e, en: e || p });
  }
  return out as unknown as Json;
}

function AdminMembershipPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const qc = useQueryClient();

  const tiersQ = useQuery({
    queryKey: ["admin", "membership-tiers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("membership_tiers")
        .select("*")
        .order("rank", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
  const plansQ = useQuery({ queryKey: ["admin", "plans-active"], queryFn: fetchActivePlans });

  const [drafts, setDrafts] = useState<Record<string, TierDraft>>({});
  const tierOptions = useMemo(
    () => (tiersQ.data ?? []).filter((tier) => tier.active),
    [tiersQ.data],
  );

  const saveTier = useMutation({
    mutationFn: async ({ id, draft }: { id: string; draft: TierDraft }) => {
      let features: Json;
      try {
        features = JSON.parse(draft.features || "{}") as Json;
      } catch {
        throw new Error(
          t("admin.membership.badFeatures", {
            defaultValue:
              lang === "pl"
                ? "Pole features nie jest poprawnym JSON-em"
                : "Features is not valid JSON",
          }),
        );
      }
      const { error } = await supabase
        .from("membership_tiers")
        .update({
          name_pl: draft.name_pl.trim(),
          name_en: draft.name_en.trim(),
          description_pl: draft.description_pl.trim() || null,
          description_en: draft.description_en.trim() || null,
          rank: draft.rank,
          benefits: benefitsFromDraft(draft),
          features,
          active: draft.active,
          is_default: draft.is_default,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(
        t("admin.membership.saved", {
          defaultValue: lang === "pl" ? "Zapisano warstwę" : "Tier saved",
        }),
      );
      void qc.invalidateQueries({ queryKey: ["admin", "membership-tiers"] });
      void qc.invalidateQueries({ queryKey: ["membership-tiers"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const savePlanTier = useMutation({
    mutationFn: async ({ planId, tierKey }: { planId: string; tierKey: string | null }) => {
      const { error } = await supabase
        .from("access_plans")
        .update({ tier_key: tierKey })
        .eq("id", planId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(
        t("admin.membership.planSaved", {
          defaultValue: lang === "pl" ? "Zapisano mapowanie planu" : "Plan mapping saved",
        }),
      );
      void qc.invalidateQueries({ queryKey: ["admin", "plans-active"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-8 p-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Crown className="h-6 w-6" aria-hidden="true" />
          {t("admin.membership.title", {
            defaultValue: lang === "pl" ? "Warstwy członkostwa" : "Membership tiers",
          })}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("admin.membership.subtitle", {
            defaultValue:
              lang === "pl"
                ? "Warstwa decyduje o dostępie do funkcji społeczności (wydarzenia dla członków, briefingi Pro). Ranga: 0 = czytelnik, wyższa = szerszy dostęp."
                : "The tier gates community features (member events, Pro briefings). Rank: 0 = reader, higher = more access.",
          })}
        </p>
      </header>

      <section className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {(tiersQ.data ?? []).map((tier) => {
          const draft = drafts[tier.id] ?? draftFromTier(tier);
          const set = (patch: Partial<TierDraft>) =>
            setDrafts((d) => ({ ...d, [tier.id]: { ...draft, ...patch } }));
          return (
            <Card key={tier.id}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    <BadgeCheck className="h-4 w-4 text-primary" aria-hidden="true" />
                    {tier.key}
                    <span className="text-xs font-normal text-muted-foreground">
                      ({lang === "pl" ? "ranga" : "rank"} {tier.rank})
                    </span>
                  </span>
                  {tier.is_default && (
                    <span className="rounded bg-muted px-2 py-0.5 text-xs">
                      {lang === "pl" ? "domyślna" : "default"}
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Nazwa PL</Label>
                    <Input
                      value={draft.name_pl}
                      onChange={(e) => set({ name_pl: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Name EN</Label>
                    <Input
                      value={draft.name_en}
                      onChange={(e) => set({ name_en: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Opis PL</Label>
                    <Textarea
                      rows={2}
                      value={draft.description_pl}
                      onChange={(e) => set({ description_pl: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Description EN</Label>
                    <Textarea
                      rows={2}
                      value={draft.description_en}
                      onChange={(e) => set({ description_en: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">
                      {lang === "pl" ? "Benefity PL (linia = punkt)" : "Benefits PL (line = item)"}
                    </Label>
                    <Textarea
                      rows={4}
                      value={draft.benefits_pl}
                      onChange={(e) => set({ benefits_pl: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">
                      {lang === "pl" ? "Benefity EN (te same wiersze)" : "Benefits EN (same rows)"}
                    </Label>
                    <Textarea
                      rows={4}
                      value={draft.benefits_en}
                      onChange={(e) => set({ benefits_en: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 items-end gap-2">
                  <div>
                    <Label className="text-xs">{lang === "pl" ? "Ranga" : "Rank"}</Label>
                    <Input
                      type="number"
                      min={0}
                      value={draft.rank}
                      onChange={(e) => set({ rank: Number(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="flex items-center gap-2 pb-2">
                    <Switch checked={draft.active} onCheckedChange={(v) => set({ active: v })} />
                    <span className="text-xs">{lang === "pl" ? "Aktywna" : "Active"}</span>
                  </div>
                  <div className="flex items-center gap-2 pb-2">
                    <Switch
                      checked={draft.is_default}
                      onCheckedChange={(v) => set({ is_default: v })}
                    />
                    <span className="text-xs">{lang === "pl" ? "Domyślna" : "Default"}</span>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">features (JSON)</Label>
                  <Input
                    value={draft.features}
                    onChange={(e) => set({ features: e.target.value })}
                    className="font-mono text-xs"
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {lang === "pl"
                      ? "Flagi egzekwowane w bazie: qa_priority (pytania warstwy na górze /qa), pro_briefings (wstęp na wydarzenia kind=briefing dla członków)."
                      : "Flags enforced in the database: qa_priority (tier's questions ranked first on /qa), pro_briefings (grants entry to members-only kind=briefing events)."}
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={saveTier.isPending}
                  onClick={() => saveTier.mutate({ id: tier.id, draft })}
                >
                  <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {lang === "pl" ? "Zapisz" : "Save"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section>
        <h2 className="text-lg font-semibold">
          {t("admin.membership.plansHeading", {
            defaultValue: lang === "pl" ? "Mapowanie planów na warstwy" : "Plan-to-tier mapping",
          })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("admin.membership.plansHint", {
            defaultValue:
              lang === "pl"
                ? "Aktywna subskrypcja planu nadaje wskazaną warstwę. Plan bez warstwy daje tylko dostęp do treści (paywall)."
                : "An active subscription grants the mapped tier. A plan without a tier only unlocks content (paywall).",
          })}
        </p>
        <div className="mt-3 space-y-2">
          {(plansQ.data ?? []).map((plan) => (
            <div
              key={plan.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{planName(plan, lang)}</div>
                <div className="text-xs text-muted-foreground">
                  {(plan.price_cents / 100).toFixed(2)} {plan.currency} / {plan.interval}
                </div>
              </div>
              <Select
                value={plan.tier_key ?? "none"}
                onValueChange={(v) =>
                  savePlanTier.mutate({ planId: plan.id, tierKey: v === "none" ? null : v })
                }
                disabled={savePlanTier.isPending}
              >
                <SelectTrigger className="w-44 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    {lang === "pl" ? "— bez warstwy —" : "— no tier —"}
                  </SelectItem>
                  {tierOptions.map((tier) => (
                    <SelectItem key={tier.key} value={tier.key}>
                      {tier.key} ({lang === "pl" ? tier.name_pl : tier.name_en})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
