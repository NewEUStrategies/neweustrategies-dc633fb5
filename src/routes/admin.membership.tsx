// Panel warstw członkostwa: edycja katalogu warstw (nazwy, benefity, ranga)
// oraz mapowania plan sprzedażowy -> warstwa (access_plans.tier_key).
// Benefity edytowane per-punkt (para PL/EN, kolejność drag = przyciski up/down);
// features (bramki maszynowe) jako surowy JSON dla adminów.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BadgeCheck, Crown, Save, Plus, Trash2, ArrowUp, ArrowDown, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import "@/lib/i18n-admin-membership";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FloatingInput } from "@/components/ui/floating-input";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { fetchActivePlans } from "@/lib/billing/queries";
import { planName } from "@/lib/billing/types";
import { parseTierBenefits, type MembershipTierRow, type TierBenefit } from "@/lib/billing/tiers";
import {
  fetchMembershipGrants,
  grantMembership,
  revokeGrant,
  type AdminGrantRow,
} from "@/lib/admin/membership-admin";
import { Link } from "@tanstack/react-router";
import { Landmark } from "lucide-react";
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
  benefits: TierBenefit[];
  features: string;
  active: boolean;
  is_default: boolean;
}

function draftFromTier(tier: MembershipTierRow): TierDraft {
  return {
    name_pl: tier.name_pl,
    name_en: tier.name_en,
    description_pl: tier.description_pl ?? "",
    description_en: tier.description_en ?? "",
    rank: tier.rank,
    benefits: parseTierBenefits(tier.benefits),
    features: JSON.stringify(tier.features ?? {}, null, 0),
    active: tier.active,
    is_default: tier.is_default,
  };
}

function benefitsToJson(list: TierBenefit[]): Json {
  const out = list
    .map((b) => ({ pl: b.pl.trim(), en: b.en.trim() }))
    .filter((b) => b.pl || b.en)
    .map((b) => ({ pl: b.pl || b.en, en: b.en || b.pl }));
  return out as unknown as Json;
}

function AdminMembershipPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const tm = (k: string, opts?: Record<string, unknown>) => t(`adminMembership.${k}`, opts);
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
        throw new Error(tm("toast.featuresInvalid"));

      }
      const { error } = await supabase
        .from("membership_tiers")
        .update({
          name_pl: draft.name_pl.trim(),
          name_en: draft.name_en.trim(),
          description_pl: draft.description_pl.trim() || null,
          description_en: draft.description_en.trim() || null,
          rank: draft.rank,
          benefits: benefitsToJson(draft.benefits),
          features,
          active: draft.active,
          is_default: draft.is_default,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(tm("toast.tierSaved"));
      void qc.invalidateQueries({ queryKey: ["admin", "membership-tiers"] });
      void qc.invalidateQueries({ queryKey: ["membership-tiers"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteTier = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("membership_tiers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(tm("toast.tierDeleted"));
      void qc.invalidateQueries({ queryKey: ["admin", "membership-tiers"] });
      void qc.invalidateQueries({ queryKey: ["membership-tiers"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createTier = useMutation({
    mutationFn: async (input: { key: string; rank: number; name_pl: string; name_en: string }) => {
      // tenant_id wymuszony przez politykę RLS - pobierz z istniejącej warstwy
      const existing = tiersQ.data?.[0];
      if (!existing) throw new Error(tm("toast.noTenant"));
      const { error } = await supabase.from("membership_tiers").insert({
        tenant_id: existing.tenant_id,
        key: input.key.trim(),
        rank: input.rank,
        name_pl: input.name_pl.trim(),
        name_en: input.name_en.trim(),
        benefits: [] as unknown as Json,
        features: {} as Json,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(tm("toast.tierCreated"));
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
      toast.success(tm("toast.planMappingSaved"));
      void qc.invalidateQueries({ queryKey: ["admin", "plans-active"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-8 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Crown className="h-6 w-6" aria-hidden="true" />
            {tm("title")}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{tm("subtitle")}</p>

        </div>
        <NewTierDialog
          lang={lang}
          existingKeys={(tiersQ.data ?? []).map((t) => t.key)}
          suggestedRank={((tiersQ.data ?? []).at(-1)?.rank ?? 0) + 10}
          onCreate={(v) => createTier.mutate(v)}
          isPending={createTier.isPending}
        />
      </header>

      <section className="flex flex-col gap-4">
        {(tiersQ.data ?? []).map((tier) => {
          const draft = drafts[tier.id] ?? draftFromTier(tier);
          const set = (patch: Partial<TierDraft>) =>
            setDrafts((d) => ({ ...d, [tier.id]: { ...draft, ...patch } }));
          const setBenefits = (list: TierBenefit[]) => set({ benefits: list });
          return (
            <Card key={tier.id} className="flex flex-col">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <span className="flex min-w-0 items-center gap-2">
                    <BadgeCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span className="truncate font-mono text-sm">{tier.key}</span>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal">
                      {tm("rankBadge")} {tier.rank}
                    </span>
                  </span>
                  <div className="flex items-center gap-1">
                    {tier.is_default && (
                      <span className="rounded bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                        {tm("defaultBadge")}
                      </span>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        if (
                          confirm(tm("deleteConfirm", { key: tier.key }))
                        ) {
                          deleteTier.mutate(tier.id);
                        }
                      }}
                      disabled={deleteTier.isPending || tier.is_default}
                      title={
                        tier.is_default ? tm("deleteDefaultDisabled") : tm("deleteTitle")
                      }

                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-3">
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
                <div className="grid grid-cols-1 gap-2">
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

                <BenefitsEditor lang={lang} value={draft.benefits} onChange={setBenefits} />

                <div className="grid grid-cols-3 items-end gap-2">
                  <div>
                    <Label className="text-xs">{tm("fields.rank")}</Label>
                    <Input
                      type="number"
                      min={0}
                      value={draft.rank}
                      onChange={(e) => set({ rank: Number(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="flex items-center gap-2 pb-2">
                    <Switch checked={draft.active} onCheckedChange={(v) => set({ active: v })} />
                    <span className="text-xs">{tm("fields.active")}</span>
                  </div>
                  <div className="flex items-center gap-2 pb-2">
                    <Switch
                      checked={draft.is_default}
                      onCheckedChange={(v) => set({ is_default: v })}
                    />
                    <span className="text-xs">{tm("fields.default")}</span>
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
                    {tm("fields.featuresHint")}
                  </p>

                </div>
                <div className="mt-auto pt-1">
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={saveTier.isPending}
                    onClick={() => saveTier.mutate({ id: tier.id, draft })}
                  >
                    <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    {tm("save")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section>
        <h2 className="text-lg font-semibold">
          {tm("mapping.heading")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{tm("mapping.hint")}</p>

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
                    {tm("mapping.noTier")}
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

      <GrantsSection lang={lang} tierOptions={tierOptions} />

      <section>
        <h2 className="text-lg font-semibold">
          {tm("org.heading")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{tm("org.hint")}</p>

        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link to="/admin/organizations">
            <Landmark className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {tm("org.open")}
          </Link>
        </Button>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nadania warstwy poza planem (membership_grants): komplementarne / fakturowe.
// ---------------------------------------------------------------------------
function GrantsSection({
  lang,
  tierOptions,
}: {
  lang: "pl" | "en";
  tierOptions: MembershipTierRow[];
}) {
  const qc = useQueryClient();
  const grantsQ = useQuery({
    queryKey: ["admin", "membership-grants"],
    queryFn: fetchMembershipGrants,
  });

  const [email, setEmail] = useState("");
  const [tierKey, setTierKey] = useState("");
  const [months, setMonths] = useState("12");
  const [note, setNote] = useState("");

  const grantM = useMutation({
    mutationFn: () =>
      grantMembership({
        email: email.trim(),
        tierKey,
        months: months.trim() === "" ? null : Number(months),
        note: note.trim() || null,
      }),
    onSuccess: () => {
      toast.success(lang === "pl" ? "Nadano warstwę" : "Membership granted");
      setEmail("");
      setNote("");
      void qc.invalidateQueries({ queryKey: ["admin", "membership-grants"] });
    },
    onError: (e: Error) => {
      const msg = e.message || "";
      if (msg.includes("user not found"))
        toast.error(
          lang === "pl" ? "Nie znaleziono konta o tym e-mailu" : "No account with that email",
        );
      else if (msg.includes("tier not found"))
        toast.error(lang === "pl" ? "Nieznana warstwa" : "Unknown tier");
      else toast.error(msg);
    },
  });

  const revokeM = useMutation({
    mutationFn: (id: string) => revokeGrant(id),
    onSuccess: () => {
      toast.success(lang === "pl" ? "Cofnięto nadanie" : "Grant revoked");
      void qc.invalidateQueries({ queryKey: ["admin", "membership-grants"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canGrant = /.+@.+\..+/.test(email.trim()) && tierKey !== "";
  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(lang === "pl" ? "pl-PL" : "en-GB") : "—";
  const sourceLabel = (s: string) =>
    s === "donation"
      ? lang === "pl"
        ? "darowizna"
        : "donation"
      : s === "import"
        ? "import"
        : lang === "pl"
          ? "ręczne"
          : "manual";

  return (
    <section>
      <h2 className="text-lg font-semibold">
        {lang === "pl" ? "Nadania warstwy (poza planem)" : "Membership grants (off-plan)"}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {lang === "pl"
          ? "Nadaj warstwę bezpośrednio po e-mailu konta (sprzedaż fakturowa, członkostwo eksperckie/partnerskie, komplementarne). Pozostaw „miesiące” puste dla nadania bezterminowego."
          : "Grant a tier directly by account email (invoice sales, expert/partner membership, complimentary). Leave “months” empty for an open-ended grant."}
      </p>

      <div className="mt-3 grid gap-2 rounded-md border border-border/60 p-3 sm:grid-cols-[1fr_10rem_7rem_auto] sm:items-end">
        <div>
          <Label className="text-xs">Email</Label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="osoba@instytucja.eu"
          />
        </div>
        <div>
          <Label className="text-xs">{lang === "pl" ? "Warstwa" : "Tier"}</Label>
          <Select value={tierKey} onValueChange={setTierKey}>
            <SelectTrigger>
              <SelectValue placeholder={lang === "pl" ? "wybierz" : "select"} />
            </SelectTrigger>
            <SelectContent>
              {tierOptions.map((tier) => (
                <SelectItem key={tier.key} value={tier.key}>
                  {tier.key} ({lang === "pl" ? tier.name_pl : tier.name_en})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">{lang === "pl" ? "Miesiące" : "Months"}</Label>
          <Input
            type="number"
            min={1}
            max={120}
            value={months}
            onChange={(e) => setMonths(e.target.value)}
            placeholder="∞"
          />
        </div>
        <Button disabled={!canGrant || grantM.isPending} onClick={() => grantM.mutate()}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {lang === "pl" ? "Nadaj" : "Grant"}
        </Button>
        <div className="sm:col-span-4">
          <FloatingInput
            label={lang === "pl" ? "Notatka (opcjonalnie)" : "Note (optional)"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {(grantsQ.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {lang === "pl" ? "Brak aktywnych nadań." : "No active grants."}
          </p>
        ) : (
          (grantsQ.data ?? []).map((g: AdminGrantRow) => (
            <div
              key={g.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {g.display_name ? `${g.display_name} · ` : ""}
                  {g.email}
                </div>
                <div className="text-xs text-muted-foreground">
                  {g.tier_key} · {sourceLabel(g.source)} ·{" "}
                  {g.expires_at
                    ? `${lang === "pl" ? "do" : "until"} ${fmtDate(g.expires_at)}`
                    : lang === "pl"
                      ? "bezterminowo"
                      : "no expiry"}
                  {g.revoked_at ? ` · ${lang === "pl" ? "cofnięte" : "revoked"}` : ""}
                </div>
              </div>
              {!g.revoked_at && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={revokeM.isPending}
                  onClick={() => revokeM.mutate(g.id)}
                >
                  <Trash2 className="mr-1 h-4 w-4" aria-hidden="true" />
                  {lang === "pl" ? "Cofnij" : "Revoke"}
                </Button>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Per-punkt edytor benefitów (para PL/EN, reorder, add/remove).
// ---------------------------------------------------------------------------
function BenefitsEditor({
  lang,
  value,
  onChange,
}: {
  lang: "pl" | "en";
  value: TierBenefit[];
  onChange: (next: TierBenefit[]) => void;
}) {
  const update = (i: number, patch: Partial<TierBenefit>) => {
    const next = value.map((b, idx) => (idx === i ? { ...b, ...patch } : b));
    onChange(next);
  };
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = value.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const add = () => onChange([...value, { pl: "", en: "" }]);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <Label className="text-xs">
          {lang === "pl" ? "Benefity (per punkt)" : "Benefits (per item)"}
        </Label>
        <Button type="button" size="sm" variant="outline" className="h-7 px-2" onClick={add}>
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          {lang === "pl" ? "Dodaj" : "Add"}
        </Button>
      </div>
      {value.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/60 px-3 py-4 text-center text-xs text-muted-foreground">
          {lang === "pl"
            ? "Brak benefitów. Dodaj pierwszy punkt."
            : "No benefits yet. Add the first item."}
        </p>
      ) : (
        <ol className="space-y-2">
          {value.map((b, i) => (
            <li key={i} className="rounded-md border border-border/60 bg-muted/30 p-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground">#{i + 1}</span>
                <div className="flex items-center gap-0.5">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    title={lang === "pl" ? "W górę" : "Move up"}
                  >
                    <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => move(i, 1)}
                    disabled={i === value.length - 1}
                    title={lang === "pl" ? "W dół" : "Move down"}
                  >
                    <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    onClick={() => remove(i)}
                    title={lang === "pl" ? "Usuń" : "Remove"}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                <Input
                  placeholder="PL"
                  value={b.pl}
                  onChange={(e) => update(i, { pl: e.target.value })}
                  className="h-8 text-sm"
                />
                <Input
                  placeholder="EN"
                  value={b.en}
                  onChange={(e) => update(i, { en: e.target.value })}
                  className="h-8 text-sm"
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialog: nowa warstwa - key (slug), ranga, nazwy PL/EN.
// ---------------------------------------------------------------------------
function NewTierDialog({
  lang,
  existingKeys,
  suggestedRank,
  onCreate,
  isPending,
}: {
  lang: "pl" | "en";
  existingKeys: string[];
  suggestedRank: number;
  onCreate: (v: { key: string; rank: number; name_pl: string; name_en: string }) => void;
  isPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [rank, setRank] = useState(suggestedRank);
  const [namePl, setNamePl] = useState("");
  const [nameEn, setNameEn] = useState("");

  const keyOk = /^[a-z0-9_-]{2,32}$/.test(key) && !existingKeys.includes(key);
  const canSubmit = keyOk && namePl.trim().length > 0 && nameEn.trim().length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onCreate({ key, rank, name_pl: namePl, name_en: nameEn });
    setOpen(false);
    setKey("");
    setRank(suggestedRank + 10);
    setNamePl("");
    setNameEn("");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setRank(suggestedRank);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {lang === "pl" ? "Nowa warstwa" : "New tier"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{lang === "pl" ? "Nowa warstwa" : "New tier"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">{lang === "pl" ? "Klucz (slug)" : "Key (slug)"}</Label>
            <Input
              value={key}
              onChange={(e) => setKey(e.target.value.toLowerCase())}
              placeholder="patron"
              className="font-mono"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {lang === "pl"
                ? "2-32 znaki: a-z, 0-9, _ lub -. Musi być unikalny."
                : "2-32 chars: a-z, 0-9, _ or -. Must be unique."}
            </p>
          </div>
          <div>
            <Label className="text-xs">{tm("fields.rank")}</Label>
            <Input
              type="number"
              min={0}
              value={rank}
              onChange={(e) => setRank(Number(e.target.value) || 0)}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {lang === "pl"
                ? "Wyższa ranga = szerszy dostęp. Standard: 0/10/20."
                : "Higher rank = more access. Standard: 0/10/20."}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <FloatingInput
              label="Nazwa PL"
              value={namePl}
              onChange={(e) => setNamePl(e.target.value)}
            />
            <FloatingInput
              label="Name EN"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {lang === "pl" ? "Anuluj" : "Cancel"}
          </Button>
          <Button onClick={submit} disabled={!canSubmit || isPending}>
            {lang === "pl" ? "Utwórz" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
