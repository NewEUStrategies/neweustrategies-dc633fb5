// Panel Cennika 2.0 - PREZENTACJA oferty na /pricing w trzech zakładkach:
//   Segmenty            katalog odbiorców (pricing_audiences): nazwy, tagline,
//                       ikona, kolejność, aktywność, CRUD,
//   Warstwy i benefity  marketing warstw per segment (membership_tiers):
//                       przypisanie do segmentu, badge, wyróżnienie-kotwica,
//                       link kontaktowy i benefity NYT/FT (wspólny edytor
//                       z panelem Członkostwo - zero rozjazdów formatu),
//   FAQ                 pytania cennika (pricing_faq_items), globalne lub
//                       per segment, z kolejnością i aktywnością.
// Rangi, features (bramki) i mapowanie planów pozostają w /admin/membership.
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  BadgePercent,
  Crown,
  HeartHandshake,
  LayoutDashboard,
  Lock,
  Megaphone,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { ensureI18n as ensureAdminPricingI18n } from "@/lib/i18n-admin-pricing";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TierBenefitsEditor } from "@/components/admin/pricing/TierBenefitsEditor";
import {
  parseTierBenefits,
  serializeTierBenefits,
  type MembershipTierRow,
  type TierBenefit,
} from "@/lib/billing/tiers";
import type { PricingAudienceRow, PricingFaqItemRow } from "@/lib/pricing/queries";
import type {
  RetentionFeedbackRow,
  RetentionReasonRow,
  RetentionSettingsRow,
} from "@/lib/retention/queries";
import { sortTiers } from "@/lib/pricing/selectors";
import { audienceIcon } from "@/components/pricing/audienceMeta";

export const Route = createFileRoute("/admin/pricing")({
  component: AdminPricingPage,
});

const AUDIENCE_KEY_RE = /^[a-z0-9_-]{2,32}$/;
const ICON_OPTIONS = [
  "user",
  "users",
  "building-2",
  "graduation-cap",
  "landmark",
  "sparkles",
] as const;

type AudienceUpdate = Database["public"]["Tables"]["pricing_audiences"]["Update"];
type FaqUpdate = Database["public"]["Tables"]["pricing_faq_items"]["Update"];

/** Renumeracja sort_order po przesunięciu - aktualizuje tylko zmienione wiersze. */
async function persistOrder(
  table: "pricing_audiences" | "pricing_faq_items" | "retention_reasons",
  rows: { id: string; sort_order: number }[],
  moved: { fromIndex: number; toIndex: number },
): Promise<void> {
  const next = rows.slice();
  const [row] = next.splice(moved.fromIndex, 1);
  next.splice(moved.toIndex, 0, row);
  for (let i = 0; i < next.length; i += 1) {
    const target = i * 10;
    if (next[i].sort_order === target) continue;
    const { error } = await supabase
      .from(table)
      .update({ sort_order: target })
      .eq("id", next[i].id);
    if (error) throw error;
  }
}

function AdminPricingPage() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureAdminPricingI18n();
  const { t } = useTranslation();
  const ta = (k: string, opts?: Record<string, unknown>) => t(`adminPricing.${k}`, opts);

  const audiencesQ = useQuery({
    queryKey: ["admin", "pricing-audiences"],
    queryFn: async (): Promise<PricingAudienceRow[]> => {
      const { data, error } = await supabase
        .from("pricing_audiences")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
  const tiersQ = useQuery({
    queryKey: ["admin", "membership-tiers"],
    queryFn: async (): Promise<MembershipTierRow[]> => {
      const { data, error } = await supabase
        .from("membership_tiers")
        .select("*")
        .order("rank", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
  const faqQ = useQuery({
    queryKey: ["admin", "pricing-faq"],
    queryFn: async (): Promise<PricingFaqItemRow[]> => {
      const { data, error } = await supabase
        .from("pricing_faq_items")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const audiences = audiencesQ.data ?? [];
  const tiers = tiersQ.data ?? [];
  const faqItems = faqQ.data ?? [];

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <BadgePercent className="h-6 w-6" aria-hidden="true" />
          {ta("title")}
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{ta("subtitle")}</p>
        {/* Cennik spina moduły monetyzacji - szybkie skoki do powiązanych paneli. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{ta("related.heading")}</span>
          <Button asChild size="sm" variant="outline" className="h-7">
            <Link to="/admin/coupons">
              <Megaphone className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {ta("related.coupons")}
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="h-7">
            <Link to="/admin/membership">
              <Crown className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {ta("related.membership")}
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="h-7">
            <Link to="/admin/paywall">
              <Lock className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {ta("related.paywall")}
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="h-7">
            <Link to="/admin/monetization">
              <LayoutDashboard className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {ta("related.dashboard")}
            </Link>
          </Button>
        </div>
      </header>

      <Tabs defaultValue="audiences">
        <TabsList>
          <TabsTrigger value="audiences">{ta("tabs.audiences")}</TabsTrigger>
          <TabsTrigger value="tiers">{ta("tabs.tiers")}</TabsTrigger>
          <TabsTrigger value="faq">{ta("tabs.faq")}</TabsTrigger>
          <TabsTrigger value="retention">{ta("tabs.retention")}</TabsTrigger>
        </TabsList>
        <TabsContent value="audiences" className="mt-4">
          <AudiencesTab audiences={audiences} tiers={tiers} />
        </TabsContent>
        <TabsContent value="tiers" className="mt-4">
          <TiersTab audiences={audiences} tiers={tiers} />
        </TabsContent>
        <TabsContent value="faq" className="mt-4">
          <FaqTab audiences={audiences} items={faqItems} />
        </TabsContent>
        <TabsContent value="retention" className="mt-4">
          <RetentionTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Zakładka: Segmenty odbiorców.
// ---------------------------------------------------------------------------
interface AudienceDraft {
  name_pl: string;
  name_en: string;
  tagline_pl: string;
  tagline_en: string;
  trust_pl: string;
  trust_en: string;
  icon: string;
  active: boolean;
}

function draftFromAudience(row: PricingAudienceRow): AudienceDraft {
  return {
    name_pl: row.name_pl,
    name_en: row.name_en,
    tagline_pl: row.tagline_pl ?? "",
    tagline_en: row.tagline_en ?? "",
    trust_pl: row.trust_pl ?? "",
    trust_en: row.trust_en ?? "",
    icon: row.icon,
    active: row.active,
  };
}

function AudiencesTab({
  audiences,
  tiers,
}: {
  audiences: PricingAudienceRow[];
  tiers: MembershipTierRow[];
}) {
  const { t } = useTranslation();
  const ta = (k: string, opts?: Record<string, unknown>) => t(`adminPricing.${k}`, opts);
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, AudienceDraft>>({});

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["admin", "pricing-audiences"] });
    void qc.invalidateQueries({ queryKey: ["pricing-audiences"] });
  };

  const tiersPerAudience = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tier of tiers) {
      if (!tier.audience_key) continue;
      counts.set(tier.audience_key, (counts.get(tier.audience_key) ?? 0) + 1);
    }
    return counts;
  }, [tiers]);

  const saveAudience = useMutation({
    mutationFn: async ({ id, draft }: { id: string; draft: AudienceDraft }) => {
      const patch: AudienceUpdate = {
        name_pl: draft.name_pl.trim(),
        name_en: draft.name_en.trim(),
        tagline_pl: draft.tagline_pl.trim() || null,
        tagline_en: draft.tagline_en.trim() || null,
        trust_pl: draft.trust_pl.trim() || null,
        trust_en: draft.trust_en.trim() || null,
        icon: draft.icon,
        active: draft.active,
      };
      const { error } = await supabase.from("pricing_audiences").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(ta("toast.audienceSaved"));
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createAudience = useMutation({
    mutationFn: async (input: { key: string; name_pl: string; name_en: string }) => {
      const tenantId = audiences[0]?.tenant_id ?? tiers[0]?.tenant_id;
      if (!tenantId) throw new Error(ta("toast.noTenant"));
      const maxSort = audiences.reduce((max, a) => Math.max(max, a.sort_order), 0);
      const { error } = await supabase.from("pricing_audiences").insert({
        tenant_id: tenantId,
        key: input.key,
        name_pl: input.name_pl.trim(),
        name_en: input.name_en.trim(),
        sort_order: maxSort + 10,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(ta("toast.audienceCreated"));
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteAudience = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("pricing_audiences").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(ta("toast.audienceDeleted"));
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const reorder = useMutation({
    mutationFn: async (moved: { fromIndex: number; toIndex: number }) =>
      persistOrder(
        "pricing_audiences",
        audiences.map((a) => ({ id: a.id, sort_order: a.sort_order })),
        moved,
      ),
    onSuccess: () => {
      toast.success(ta("toast.reordered"));
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <NewAudienceDialog
          existingKeys={audiences.map((a) => a.key)}
          onCreate={(v) => createAudience.mutate(v)}
          isPending={createAudience.isPending}
        />
      </div>
      {audiences.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-sm text-muted-foreground">
          {ta("audiences.empty")}
        </p>
      ) : (
        audiences.map((audience, index) => {
          const draft = drafts[audience.id] ?? draftFromAudience(audience);
          const set = (patch: Partial<AudienceDraft>) =>
            setDrafts((d) => ({ ...d, [audience.id]: { ...draft, ...patch } }));
          const Icon = audienceIcon(draft.icon);
          const assigned = tiersPerAudience.get(audience.key) ?? 0;
          return (
            <Card key={audience.id}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span className="truncate font-mono text-sm">{audience.key}</span>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal">
                      {ta("audiences.tiersCount", { count: assigned })}
                    </span>
                  </span>
                  <span className="flex items-center gap-0.5">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => reorder.mutate({ fromIndex: index, toIndex: index - 1 })}
                      disabled={index === 0 || reorder.isPending}
                      title={ta("audiences.moveUp")}
                    >
                      <ArrowUp className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => reorder.mutate({ fromIndex: index, toIndex: index + 1 })}
                      disabled={index === audiences.length - 1 || reorder.isPending}
                      title={ta("audiences.moveDown")}
                    >
                      <ArrowDown className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        if (assigned > 0) {
                          toast.error(ta("audiences.deleteBlocked"));
                          return;
                        }
                        if (confirm(ta("audiences.deleteConfirm", { key: audience.key }))) {
                          deleteAudience.mutate(audience.id);
                        }
                      }}
                      disabled={deleteAudience.isPending}
                      title={ta("audiences.deleteTitle")}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">{ta("audiences.namePl")}</Label>
                    <Input
                      value={draft.name_pl}
                      onChange={(e) => set({ name_pl: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">{ta("audiences.nameEn")}</Label>
                    <Input
                      value={draft.name_en}
                      onChange={(e) => set({ name_en: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">{ta("audiences.taglinePl")}</Label>
                    <Textarea
                      rows={2}
                      value={draft.tagline_pl}
                      onChange={(e) => set({ tagline_pl: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">{ta("audiences.taglineEn")}</Label>
                    <Textarea
                      rows={2}
                      value={draft.tagline_en}
                      onChange={(e) => set({ tagline_en: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">{ta("audiences.trustPl")}</Label>
                    <Input
                      value={draft.trust_pl}
                      onChange={(e) => set({ trust_pl: e.target.value })}
                      placeholder="Faktura · Umowa roczna · Wdrożenie z opiekunem"
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {ta("audiences.trustHint")}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs">{ta("audiences.trustEn")}</Label>
                    <Input
                      value={draft.trust_en}
                      onChange={(e) => set({ trust_en: e.target.value })}
                      placeholder="Invoice · Annual agreement · Guided onboarding"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-3">
                  <div>
                    <Label className="text-xs">{ta("audiences.icon")}</Label>
                    <Select value={draft.icon} onValueChange={(v) => set({ icon: v })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ICON_OPTIONS.map((slug) => (
                          <SelectItem key={slug} value={slug}>
                            {ta(`icons.${slug}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2 pb-2">
                    <Switch checked={draft.active} onCheckedChange={(v) => set({ active: v })} />
                    <span className="text-xs">{ta("audiences.active")}</span>
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <Button
                      size="sm"
                      className="w-full"
                      disabled={
                        saveAudience.isPending || !draft.name_pl.trim() || !draft.name_en.trim()
                      }
                      onClick={() => saveAudience.mutate({ id: audience.id, draft })}
                    >
                      <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
                      {ta("audiences.save")}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

function NewAudienceDialog({
  existingKeys,
  onCreate,
  isPending,
}: {
  existingKeys: string[];
  onCreate: (v: { key: string; name_pl: string; name_en: string }) => void;
  isPending: boolean;
}) {
  const { t } = useTranslation();
  const ta = (k: string) => t(`adminPricing.${k}`);
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [namePl, setNamePl] = useState("");
  const [nameEn, setNameEn] = useState("");

  const keyOk = AUDIENCE_KEY_RE.test(key) && !existingKeys.includes(key);
  const canSubmit = keyOk && namePl.trim().length > 0 && nameEn.trim().length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onCreate({ key, name_pl: namePl, name_en: nameEn });
    setOpen(false);
    setKey("");
    setNamePl("");
    setNameEn("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {ta("audiences.new")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{ta("audiences.new")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">{ta("audiences.key")}</Label>
            <Input
              value={key}
              onChange={(e) => setKey(e.target.value.toLowerCase())}
              placeholder="media"
              className="font-mono"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">{ta("audiences.keyHint")}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">{ta("audiences.namePl")}</Label>
              <Input value={namePl} onChange={(e) => setNamePl(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">{ta("audiences.nameEn")}</Label>
              <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {ta("audiences.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSubmit || isPending}>
            {ta("audiences.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Zakładka: marketing warstw per segment.
// ---------------------------------------------------------------------------
interface TierMarketingDraft {
  audience_key: string;
  badge_pl: string;
  badge_en: string;
  highlight: boolean;
  contact_url: string;
  cta_mode: string;
  per_seat: boolean;
  price_note_pl: string;
  price_note_en: string;
  benefits: TierBenefit[];
}

const NO_AUDIENCE = "none";
const CTA_MODES = ["auto", "contact", "none"] as const;

function draftFromTier(tier: MembershipTierRow): TierMarketingDraft {
  return {
    audience_key: tier.audience_key ?? NO_AUDIENCE,
    badge_pl: tier.badge_pl ?? "",
    badge_en: tier.badge_en ?? "",
    highlight: tier.highlight,
    contact_url: tier.contact_url ?? "",
    cta_mode: CTA_MODES.includes(tier.cta_mode as (typeof CTA_MODES)[number])
      ? tier.cta_mode
      : "auto",
    per_seat: tier.per_seat,
    price_note_pl: tier.price_note_pl ?? "",
    price_note_en: tier.price_note_en ?? "",
    benefits: parseTierBenefits(tier.benefits),
  };
}

function TiersTab({
  audiences,
  tiers,
}: {
  audiences: PricingAudienceRow[];
  tiers: MembershipTierRow[];
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const ta = (k: string, opts?: Record<string, unknown>) => t(`adminPricing.${k}`, opts);
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, TierMarketingDraft>>({});

  const saveTier = useMutation({
    mutationFn: async ({ id, draft }: { id: string; draft: TierMarketingDraft }) => {
      const { error } = await supabase
        .from("membership_tiers")
        .update({
          audience_key: draft.audience_key === NO_AUDIENCE ? null : draft.audience_key,
          badge_pl: draft.badge_pl.trim() || null,
          badge_en: draft.badge_en.trim() || null,
          highlight: draft.highlight,
          contact_url: draft.contact_url.trim() || null,
          cta_mode: draft.cta_mode,
          per_seat: draft.per_seat,
          price_note_pl: draft.price_note_pl.trim() || null,
          price_note_en: draft.price_note_en.trim() || null,
          benefits: serializeTierBenefits(draft.benefits),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(ta("toast.tierSaved"));
      void qc.invalidateQueries({ queryKey: ["admin", "membership-tiers"] });
      void qc.invalidateQueries({ queryKey: ["membership-tiers"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const knownKeys = useMemo(() => new Set(audiences.map((a) => a.key)), [audiences]);
  const groups = useMemo(() => {
    const byAudience = new Map<string, MembershipTierRow[]>();
    const unassigned: MembershipTierRow[] = [];
    for (const tier of sortTiers(tiers)) {
      if (tier.audience_key && knownKeys.has(tier.audience_key)) {
        const list = byAudience.get(tier.audience_key);
        if (list) list.push(tier);
        else byAudience.set(tier.audience_key, [tier]);
      } else {
        unassigned.push(tier);
      }
    }
    return { byAudience, unassigned };
  }, [tiers, knownKeys]);

  const renderTierCard = (tier: MembershipTierRow) => {
    const draft = drafts[tier.id] ?? draftFromTier(tier);
    const set = (patch: Partial<TierMarketingDraft>) =>
      setDrafts((d) => ({ ...d, [tier.id]: { ...draft, ...patch } }));
    return (
      <Card key={tier.id}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-mono text-sm">{tier.key}</span>
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal">
                {ta("tiers.rankBadge")} {tier.rank}
              </span>
              <span className="truncate text-sm font-normal text-muted-foreground">
                {lang === "en" ? tier.name_en : tier.name_pl}
              </span>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div>
              <Label className="text-xs">{ta("tiers.audience")}</Label>
              <Select value={draft.audience_key} onValueChange={(v) => set({ audience_key: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_AUDIENCE}>{ta("tiers.none")}</SelectItem>
                  {audiences.map((audience) => (
                    <SelectItem key={audience.key} value={audience.key}>
                      {audience.key} ({lang === "en" ? audience.name_en : audience.name_pl})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{ta("tiers.badgePl")}</Label>
              <Input
                value={draft.badge_pl}
                onChange={(e) => set({ badge_pl: e.target.value })}
                placeholder="Najpopularniejszy"
              />
            </div>
            <div>
              <Label className="text-xs">{ta("tiers.badgeEn")}</Label>
              <Input
                value={draft.badge_en}
                onChange={(e) => set({ badge_en: e.target.value })}
                placeholder="Most popular"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-2">
            <div className="flex items-center gap-2 pb-2">
              <Switch checked={draft.highlight} onCheckedChange={(v) => set({ highlight: v })} />
              <span className="text-xs">{ta("tiers.highlight")}</span>
              <span className="text-[11px] text-muted-foreground">{ta("tiers.highlightHint")}</span>
            </div>
            <div>
              <Label className="text-xs">{ta("tiers.contactUrl")}</Label>
              <Input
                value={draft.contact_url}
                onChange={(e) => set({ contact_url: e.target.value })}
                placeholder="/kontakt lub mailto:..."
              />
              <p className="mt-1 text-[11px] text-muted-foreground">{ta("tiers.contactUrlHint")}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-3">
            <div>
              <Label className="text-xs">{ta("tiers.ctaMode")}</Label>
              <Select value={draft.cta_mode} onValueChange={(v) => set({ cta_mode: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CTA_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {ta(`tiers.ctaModes.${mode}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] text-muted-foreground">{ta("tiers.ctaModeHint")}</p>
            </div>
            <div className="flex items-center gap-2 pb-2">
              <Switch checked={draft.per_seat} onCheckedChange={(v) => set({ per_seat: v })} />
              <span className="text-xs">{ta("tiers.perSeat")}</span>
              <span className="text-[11px] text-muted-foreground">{ta("tiers.perSeatHint")}</span>
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              <div>
                <Label className="text-xs">{ta("tiers.priceNotePl")}</Label>
                <Input
                  value={draft.price_note_pl}
                  onChange={(e) => set({ price_note_pl: e.target.value })}
                  placeholder="2-20 miejsc"
                />
              </div>
              <div>
                <Label className="text-xs">{ta("tiers.priceNoteEn")}</Label>
                <Input
                  value={draft.price_note_en}
                  onChange={(e) => set({ price_note_en: e.target.value })}
                  placeholder="2-20 seats"
                />
              </div>
            </div>
          </div>
          <TierBenefitsEditor value={draft.benefits} onChange={(benefits) => set({ benefits })} />
          <div className="pt-1">
            <Button
              size="sm"
              className="w-full"
              disabled={saveTier.isPending}
              onClick={() => saveTier.mutate({ id: tier.id, draft })}
            >
              <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {ta("tiers.save")}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
        <p className="text-xs text-muted-foreground">{ta("tiers.coreHint")}</p>
        <Button asChild size="sm" variant="outline">
          <Link to="/admin/membership">
            <Crown className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {ta("tiers.openMembership")}
          </Link>
        </Button>
      </div>

      {audiences.map((audience) => {
        const list = groups.byAudience.get(audience.key) ?? [];
        if (list.length === 0) return null;
        const Icon = audienceIcon(audience.icon);
        return (
          <section key={audience.key}>
            <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
              <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
              {lang === "en" ? audience.name_en : audience.name_pl}
              <span className="font-mono text-xs font-normal text-muted-foreground">
                {audience.key}
              </span>
            </h2>
            <div className="grid gap-4 lg:grid-cols-2">{list.map(renderTierCard)}</div>
          </section>
        );
      })}

      {groups.unassigned.length > 0 && (
        <section>
          <h2 className="mb-1 text-lg font-semibold">{ta("tiers.unassigned")}</h2>
          <p className="mb-3 text-xs text-muted-foreground">{ta("tiers.unassignedHint")}</p>
          <div className="grid gap-4 lg:grid-cols-2">{groups.unassigned.map(renderTierCard)}</div>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Zakładka: FAQ cennika.
// ---------------------------------------------------------------------------
interface FaqDraft {
  question_pl: string;
  question_en: string;
  answer_pl: string;
  answer_en: string;
  audience_key: string;
  active: boolean;
}

const GLOBAL_FAQ = "global";

function draftFromFaq(row: PricingFaqItemRow): FaqDraft {
  return {
    question_pl: row.question_pl,
    question_en: row.question_en,
    answer_pl: row.answer_pl,
    answer_en: row.answer_en,
    audience_key: row.audience_key ?? GLOBAL_FAQ,
    active: row.active,
  };
}

const EMPTY_FAQ_DRAFT: FaqDraft = {
  question_pl: "",
  question_en: "",
  answer_pl: "",
  answer_en: "",
  audience_key: GLOBAL_FAQ,
  active: true,
};

function faqDraftValid(draft: FaqDraft): boolean {
  return (
    draft.question_pl.trim().length > 0 &&
    draft.question_en.trim().length > 0 &&
    draft.answer_pl.trim().length > 0 &&
    draft.answer_en.trim().length > 0
  );
}

function FaqTab({
  audiences,
  items,
}: {
  audiences: PricingAudienceRow[];
  items: PricingFaqItemRow[];
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const ta = (k: string, opts?: Record<string, unknown>) => t(`adminPricing.${k}`, opts);
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, FaqDraft>>({});
  const [newDraft, setNewDraft] = useState<FaqDraft>(EMPTY_FAQ_DRAFT);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["admin", "pricing-faq"] });
    void qc.invalidateQueries({ queryKey: ["pricing-faq"] });
  };

  const addFaq = useMutation({
    mutationFn: async (draft: FaqDraft) => {
      const tenantId = items[0]?.tenant_id ?? audiences[0]?.tenant_id;
      if (!tenantId) throw new Error(ta("toast.noTenant"));
      const maxSort = items.reduce((max, item) => Math.max(max, item.sort_order), 0);
      const { error } = await supabase.from("pricing_faq_items").insert({
        tenant_id: tenantId,
        audience_key: draft.audience_key === GLOBAL_FAQ ? null : draft.audience_key,
        question_pl: draft.question_pl.trim(),
        question_en: draft.question_en.trim(),
        answer_pl: draft.answer_pl.trim(),
        answer_en: draft.answer_en.trim(),
        sort_order: maxSort + 10,
        active: draft.active,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(ta("toast.faqAdded"));
      setNewDraft(EMPTY_FAQ_DRAFT);
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const saveFaq = useMutation({
    mutationFn: async ({ id, draft }: { id: string; draft: FaqDraft }) => {
      const patch: FaqUpdate = {
        audience_key: draft.audience_key === GLOBAL_FAQ ? null : draft.audience_key,
        question_pl: draft.question_pl.trim(),
        question_en: draft.question_en.trim(),
        answer_pl: draft.answer_pl.trim(),
        answer_en: draft.answer_en.trim(),
        active: draft.active,
      };
      const { error } = await supabase.from("pricing_faq_items").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(ta("toast.faqSaved"));
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteFaq = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("pricing_faq_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(ta("toast.faqDeleted"));
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const reorder = useMutation({
    mutationFn: async (moved: { fromIndex: number; toIndex: number }) =>
      persistOrder(
        "pricing_faq_items",
        items.map((item) => ({ id: item.id, sort_order: item.sort_order })),
        moved,
      ),
    onSuccess: () => {
      toast.success(ta("toast.reordered"));
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const audienceSelect = (value: string, onChange: (v: string) => void) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={GLOBAL_FAQ}>{ta("faq.global")}</SelectItem>
        {audiences.map((audience) => (
          <SelectItem key={audience.key} value={audience.key}>
            {audience.key} ({lang === "en" ? audience.name_en : audience.name_pl})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const faqFields = (draft: FaqDraft, set: (patch: Partial<FaqDraft>) => void) => (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <div>
        <Label className="text-xs">{ta("faq.questionPl")}</Label>
        <Input value={draft.question_pl} onChange={(e) => set({ question_pl: e.target.value })} />
      </div>
      <div>
        <Label className="text-xs">{ta("faq.questionEn")}</Label>
        <Input value={draft.question_en} onChange={(e) => set({ question_en: e.target.value })} />
      </div>
      <div>
        <Label className="text-xs">{ta("faq.answerPl")}</Label>
        <Textarea
          rows={3}
          value={draft.answer_pl}
          onChange={(e) => set({ answer_pl: e.target.value })}
        />
      </div>
      <div>
        <Label className="text-xs">{ta("faq.answerEn")}</Label>
        <Textarea
          rows={3}
          value={draft.answer_en}
          onChange={(e) => set({ answer_en: e.target.value })}
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{ta("faq.newHeading")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {faqFields(newDraft, (patch) => setNewDraft((d) => ({ ...d, ...patch })))}
          <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-3">
            <div>
              <Label className="text-xs">{ta("faq.audience")}</Label>
              {audienceSelect(newDraft.audience_key, (v) =>
                setNewDraft((d) => ({ ...d, audience_key: v })),
              )}
            </div>
            <div className="sm:col-span-2">
              <Button
                size="sm"
                disabled={addFaq.isPending || !faqDraftValid(newDraft)}
                onClick={() => addFaq.mutate(newDraft)}
              >
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {ta("faq.add")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-sm text-muted-foreground">
          {ta("faq.empty")}
        </p>
      ) : (
        items.map((item, index) => {
          const draft = drafts[item.id] ?? draftFromFaq(item);
          const set = (patch: Partial<FaqDraft>) =>
            setDrafts((d) => ({ ...d, [item.id]: { ...draft, ...patch } }));
          return (
            <Card key={item.id}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <span className="min-w-0 truncate text-sm font-medium">
                    {lang === "en" ? draft.question_en : draft.question_pl}
                  </span>
                  <span className="flex items-center gap-0.5">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => reorder.mutate({ fromIndex: index, toIndex: index - 1 })}
                      disabled={index === 0 || reorder.isPending}
                      title={ta("faq.moveUp")}
                    >
                      <ArrowUp className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => reorder.mutate({ fromIndex: index, toIndex: index + 1 })}
                      disabled={index === items.length - 1 || reorder.isPending}
                      title={ta("faq.moveDown")}
                    >
                      <ArrowDown className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        if (confirm(ta("faq.deleteConfirm"))) deleteFaq.mutate(item.id);
                      }}
                      disabled={deleteFaq.isPending}
                      title={ta("faq.deleteTitle")}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {faqFields(draft, set)}
                <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-3">
                  <div>
                    <Label className="text-xs">{ta("faq.audience")}</Label>
                    {audienceSelect(draft.audience_key, (v) => set({ audience_key: v }))}
                  </div>
                  <div className="flex items-center gap-2 pb-2">
                    <Switch checked={draft.active} onCheckedChange={(v) => set({ active: v })} />
                    <span className="text-xs">{ta("faq.active")}</span>
                  </div>
                  <div>
                    <Button
                      size="sm"
                      className="w-full"
                      disabled={saveFaq.isPending || !faqDraftValid(draft)}
                      onClick={() => saveFaq.mutate({ id: item.id, draft })}
                    >
                      <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
                      {ta("faq.save")}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Zakładka: retencja odchodzących - ustawienia kontrofertki (procent, liczba
// płatności, ważność kodu), katalog powodów rezygnacji i przegląd odpowiedzi.
// Kupony retencyjne lądują w module Kuponów B2B (metadata.source='retention').
// ---------------------------------------------------------------------------
interface RetentionSettingsDraft {
  enabled: boolean;
  discount_pct: string;
  discount_periods: string;
  coupon_valid_days: string;
}

function settingsDraftFromRow(row: RetentionSettingsRow | null): RetentionSettingsDraft {
  return {
    enabled: row?.enabled ?? true,
    discount_pct: String(row?.discount_pct ?? 30),
    discount_periods: String(row?.discount_periods ?? 3),
    coupon_valid_days: String(row?.coupon_valid_days ?? 14),
  };
}

function clampInt(value: string, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

interface ReasonDraft {
  label_pl: string;
  label_en: string;
  active: boolean;
}

function reasonDraftFromRow(row: RetentionReasonRow): ReasonDraft {
  return { label_pl: row.label_pl, label_en: row.label_en, active: row.active };
}

function RetentionTab() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const ta = (k: string, opts?: Record<string, unknown>) => t(`adminPricing.${k}`, opts);
  const qc = useQueryClient();

  const settingsQ = useQuery({
    queryKey: ["admin", "retention-settings"],
    queryFn: async (): Promise<RetentionSettingsRow | null> => {
      const { data, error } = await supabase.from("retention_settings").select("*").maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });
  const reasonsQ = useQuery({
    queryKey: ["admin", "retention-reasons"],
    queryFn: async (): Promise<RetentionReasonRow[]> => {
      const { data, error } = await supabase
        .from("retention_reasons")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
  const feedbackQ = useQuery({
    queryKey: ["admin", "retention-feedback"],
    queryFn: async (): Promise<RetentionFeedbackRow[]> => {
      const { data, error } = await supabase
        .from("retention_feedback")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const reasons = reasonsQ.data ?? [];
  const feedback = useMemo(() => feedbackQ.data ?? [], [feedbackQ.data]);

  const [settingsDraft, setSettingsDraft] = useState<RetentionSettingsDraft | null>(null);
  const draft = settingsDraft ?? settingsDraftFromRow(settingsQ.data ?? null);
  const setDraft = (patch: Partial<RetentionSettingsDraft>) =>
    setSettingsDraft({ ...draft, ...patch });

  const [reasonDrafts, setReasonDrafts] = useState<Record<string, ReasonDraft>>({});
  const [newReasonPl, setNewReasonPl] = useState("");
  const [newReasonEn, setNewReasonEn] = useState("");

  const invalidateSettings = () => {
    void qc.invalidateQueries({ queryKey: ["admin", "retention-settings"] });
    void qc.invalidateQueries({ queryKey: ["retention-settings"] });
  };
  const invalidateReasons = () => {
    void qc.invalidateQueries({ queryKey: ["admin", "retention-reasons"] });
    void qc.invalidateQueries({ queryKey: ["retention-reasons"] });
  };

  const tenantId =
    settingsQ.data?.tenant_id ?? reasons[0]?.tenant_id ?? feedback[0]?.tenant_id ?? null;

  const saveSettings = useMutation({
    mutationFn: async (input: RetentionSettingsDraft) => {
      if (!tenantId) throw new Error(ta("toast.noTenant"));
      const payload = {
        tenant_id: tenantId,
        enabled: input.enabled,
        discount_pct: clampInt(input.discount_pct, 1, 90, 30),
        discount_periods: clampInt(input.discount_periods, 1, 24, 3),
        coupon_valid_days: clampInt(input.coupon_valid_days, 1, 90, 14),
      };
      const { error } = await supabase
        .from("retention_settings")
        .upsert(payload, { onConflict: "tenant_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(ta("toast.retentionSaved"));
      setSettingsDraft(null);
      invalidateSettings();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const addReason = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error(ta("toast.noTenant"));
      const maxSort = reasons.reduce((max, r) => Math.max(max, r.sort_order), 0);
      const { error } = await supabase.from("retention_reasons").insert({
        tenant_id: tenantId,
        label_pl: newReasonPl.trim(),
        label_en: newReasonEn.trim(),
        sort_order: maxSort + 10,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(ta("toast.reasonAdded"));
      setNewReasonPl("");
      setNewReasonEn("");
      invalidateReasons();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const saveReason = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: ReasonDraft }) => {
      const { error } = await supabase
        .from("retention_reasons")
        .update({
          label_pl: value.label_pl.trim(),
          label_en: value.label_en.trim(),
          active: value.active,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(ta("toast.reasonSaved"));
      invalidateReasons();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteReason = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("retention_reasons").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(ta("toast.reasonDeleted"));
      invalidateReasons();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const reorderReasons = useMutation({
    mutationFn: async (moved: { fromIndex: number; toIndex: number }) =>
      persistOrder(
        "retention_reasons",
        reasons.map((r) => ({ id: r.id, sort_order: r.sort_order })),
        moved,
      ),
    onSuccess: () => {
      toast.success(ta("toast.reordered"));
      invalidateReasons();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Statystyki z ostatnich 90 dni (na próbce najnowszych 100 odpowiedzi).
  const stats = useMemo(() => {
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const recent = feedback.filter((row) => new Date(row.created_at).getTime() >= cutoff);
    const shown = recent.filter((row) => row.offer_shown);
    const accepted = recent.filter((row) => row.offer_accepted);
    const byReason = new Map<string, number>();
    for (const row of recent) {
      byReason.set(row.reason_label, (byReason.get(row.reason_label) ?? 0) + 1);
    }
    const topReasons = [...byReason.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    return {
      total: recent.length,
      accepted: accepted.length,
      acceptRate: shown.length > 0 ? Math.round((accepted.length / shown.length) * 100) : null,
      topReasons,
    };
  }, [feedback]);

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "en" ? "en-GB" : "pl-PL");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <HeartHandshake className="h-4 w-4 text-primary" aria-hidden="true" />
            {ta("retention.settingsHeading")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">{ta("retention.settingsHint")}</p>
          <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-5">
            <div className="flex items-center gap-2 pb-2">
              <Switch checked={draft.enabled} onCheckedChange={(v) => setDraft({ enabled: v })} />
              <span className="text-xs">{ta("retention.enabled")}</span>
            </div>
            <div>
              <Label className="text-xs">{ta("retention.discountPct")}</Label>
              <Input
                type="number"
                min={1}
                max={90}
                value={draft.discount_pct}
                onChange={(e) => setDraft({ discount_pct: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">{ta("retention.discountPeriods")}</Label>
              <Input
                type="number"
                min={1}
                max={24}
                value={draft.discount_periods}
                onChange={(e) => setDraft({ discount_periods: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">{ta("retention.validDays")}</Label>
              <Input
                type="number"
                min={1}
                max={90}
                value={draft.coupon_valid_days}
                onChange={(e) => setDraft({ coupon_valid_days: e.target.value })}
              />
            </div>
            <Button
              size="sm"
              disabled={saveSettings.isPending}
              onClick={() => saveSettings.mutate(draft)}
            >
              <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {ta("retention.save")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="pb-4 pt-5">
            <div className="text-xs text-muted-foreground">{ta("retention.stats.total")}</div>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pb-4 pt-5">
            <div className="text-xs text-muted-foreground">{ta("retention.stats.accepted")}</div>
            <div className="text-2xl font-bold">
              {stats.accepted}
              {stats.acceptRate !== null && (
                <span className="ml-2 text-sm font-medium text-muted-foreground">
                  ({stats.acceptRate}%)
                </span>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pb-4 pt-5">
            <div className="text-xs text-muted-foreground">{ta("retention.stats.topReasons")}</div>
            {stats.topReasons.length === 0 ? (
              <div className="text-sm text-muted-foreground">-</div>
            ) : (
              <ul className="mt-1 space-y-0.5 text-sm">
                {stats.topReasons.map(([label, count]) => (
                  <li key={label} className="flex items-center justify-between gap-2">
                    <span className="truncate">{label}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{count}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{ta("retention.reasonsHeading")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <div>
              <Label className="text-xs">{ta("retention.reasonPl")}</Label>
              <Input value={newReasonPl} onChange={(e) => setNewReasonPl(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">{ta("retention.reasonEn")}</Label>
              <Input value={newReasonEn} onChange={(e) => setNewReasonEn(e.target.value)} />
            </div>
            <Button
              size="sm"
              disabled={addReason.isPending || !newReasonPl.trim() || !newReasonEn.trim()}
              onClick={() => addReason.mutate()}
            >
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {ta("retention.addReason")}
            </Button>
          </div>
          <div className="space-y-2">
            {reasons.map((reason, index) => {
              const value = reasonDrafts[reason.id] ?? reasonDraftFromRow(reason);
              const set = (patch: Partial<ReasonDraft>) =>
                setReasonDrafts((d) => ({ ...d, [reason.id]: { ...value, ...patch } }));
              return (
                <div
                  key={reason.id}
                  className="grid grid-cols-1 items-center gap-2 rounded-md border border-border/60 p-2 sm:grid-cols-[1fr_1fr_auto_auto]"
                >
                  <Input
                    value={value.label_pl}
                    onChange={(e) => set({ label_pl: e.target.value })}
                    className="h-8 text-sm"
                  />
                  <Input
                    value={value.label_en}
                    onChange={(e) => set({ label_en: e.target.value })}
                    className="h-8 text-sm"
                  />
                  <label className="flex items-center gap-2 px-1">
                    <Switch checked={value.active} onCheckedChange={(v) => set({ active: v })} />
                    <span className="text-xs">{ta("retention.reasonActive")}</span>
                  </label>
                  <div className="flex items-center gap-0.5">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() =>
                        reorderReasons.mutate({ fromIndex: index, toIndex: index - 1 })
                      }
                      disabled={index === 0 || reorderReasons.isPending}
                      title={ta("retention.moveUp")}
                    >
                      <ArrowUp className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() =>
                        reorderReasons.mutate({ fromIndex: index, toIndex: index + 1 })
                      }
                      disabled={index === reasons.length - 1 || reorderReasons.isPending}
                      title={ta("retention.moveDown")}
                    >
                      <ArrowDown className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        if (confirm(ta("retention.reasonDeleteConfirm"))) {
                          deleteReason.mutate(reason.id);
                        }
                      }}
                      disabled={deleteReason.isPending}
                      title={ta("retention.reasonDelete")}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => saveReason.mutate({ id: reason.id, value })}
                      disabled={
                        saveReason.isPending || !value.label_pl.trim() || !value.label_en.trim()
                      }
                      title={ta("retention.save")}
                    >
                      <Save className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{ta("retention.feedbackHeading")}</CardTitle>
        </CardHeader>
        <CardContent>
          {feedback.length === 0 ? (
            <p className="text-sm text-muted-foreground">{ta("retention.feedbackEmpty")}</p>
          ) : (
            <div className="space-y-2">
              {feedback.slice(0, 25).map((row) => (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{row.reason_label}</div>
                    {row.comment && (
                      <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {row.comment}
                      </div>
                    )}
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {fmtDate(row.created_at)}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs">
                    {row.offer_accepted ? (
                      <span className="rounded bg-primary/10 px-2 py-0.5 font-medium text-primary">
                        {ta("retention.offerAccepted")}
                        {row.coupon_code ? ` · ${row.coupon_code}` : ""}
                      </span>
                    ) : row.offer_shown ? (
                      <span className="rounded bg-muted px-2 py-0.5 text-muted-foreground">
                        {ta("retention.offerDeclined")}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
