// Zakładka Kupony - lista + CRUD (rozbudowa: DatePicker, powiązania CRM/plan).
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, Copy, Check, Loader2, Link2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
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
import type { B2bCouponRow, CouponDiscountKind } from "@/lib/billing/coupons";
import { normalizeCouponCode } from "@/lib/billing/coupons";

export const Route = createFileRoute("/admin/coupons/")({
  component: CouponsListPage,
});

type ExtRow = B2bCouponRow & {
  campaign_id: string | null;
  grants_tier_key: string | null;
  grants_duration_days: number | null;
  assigned_company_id: string | null;
  assigned_lead_id: string | null;
};

function CouponsListPage() {
  const { i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "inactive" | "expired">(
    "all",
  );
  const [search, setSearch] = useState("");

  const couponsQ = useQuery({
    queryKey: ["admin", "b2b-coupons"],
    queryFn: async (): Promise<ExtRow[]> => {
      const { data, error } = await supabase
        .from("b2b_coupons")
        .select(
          "id, code, name, description, discount_kind, discount_percent, discount_cents, currency, active, max_redemptions, redemptions_count, valid_from, valid_until, plan_ids, organization_id, metadata, created_at, updated_at, campaign_id, grants_tier_key, grants_duration_days, assigned_company_id, assigned_lead_id",
        )
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as ExtRow[];
    },
  });

  const plansQ = useQuery({
    queryKey: ["admin", "b2b-coupons", "plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("access_plans")
        .select("id, name_pl, name_en, active")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const tiersQ = useQuery({
    queryKey: ["admin", "b2b-coupons", "tiers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("membership_tiers")
        .select("key, name_pl, name_en, active")
        .eq("active", true)
        .order("rank", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const toggle = useMutation({
    mutationFn: async (row: ExtRow) => {
      const { error } = await supabase
        .from("b2b_coupons")
        .update({ active: !row.active })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "b2b-coupons"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("b2b_coupons").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "b2b-coupons"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = couponsQ.data ?? [];
  const filtered = useMemo(() => {
    const now = Date.now();
    return rows.filter((c) => {
      if (search) {
        const s = search.toLowerCase();
        if (!c.code.toLowerCase().includes(s) && !(c.name ?? "").toLowerCase().includes(s)) {
          return false;
        }
      }
      if (filterStatus === "active" && !c.active) return false;
      if (filterStatus === "inactive" && c.active) return false;
      if (filterStatus === "expired") {
        if (!c.valid_until || new Date(c.valid_until).getTime() >= now) return false;
      }
      return true;
    });
  }, [rows, search, filterStatus]);

  const active = useMemo(() => rows.filter((c) => c.active).length, [rows]);
  const totalRedemptions = useMemo(
    () => rows.reduce((s, c) => s + (c.redemptions_count || 0), 0),
    [rows],
  );
  const expired = useMemo(
    () =>
      rows.filter((c) => c.valid_until && new Date(c.valid_until).getTime() < Date.now()).length,
    [rows],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={L("Szukaj po kodzie/nazwie", "Search by code/name")}
            className="h-10 w-56 rounded-[6px]"
          />
          <Select
            value={filterStatus}
            onValueChange={(v) => setFilterStatus(v as typeof filterStatus)}
          >
            <SelectTrigger className="h-10 w-40 rounded-[6px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{L("Wszystkie", "All")}</SelectItem>
              <SelectItem value="active">{L("Aktywne", "Active")}</SelectItem>
              <SelectItem value="inactive">{L("Nieaktywne", "Inactive")}</SelectItem>
              <SelectItem value="expired">{L("Wygasłe", "Expired")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="h-10 rounded-[6px]">
              <Plus className="h-4 w-4 mr-2" />
              {L("Nowy kupon", "New coupon")}
            </Button>
          </DialogTrigger>
          <CouponCreateDialog
            plans={plansQ.data ?? []}
            tiers={tiersQ.data ?? []}
            onCreated={() => {
              setOpen(false);
              void qc.invalidateQueries({ queryKey: ["admin", "b2b-coupons"] });
            }}
          />
        </Dialog>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label={L("Wszystkie", "Total")} value={String(rows.length)} />
        <StatCard label={L("Aktywne", "Active")} value={String(active)} />
        <StatCard
          label={L("Użycia łącznie", "Total redemptions")}
          value={String(totalRedemptions)}
        />
        <StatCard label={L("Wygasłe", "Expired")} value={String(expired)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{L("Lista kuponów", "Coupon list")}</CardTitle>
        </CardHeader>
        <CardContent>
          {couponsQ.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" />
              {L("Wczytywanie…", "Loading…")}
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">
              {L("Brak wyników.", "No results.")}
            </p>
          ) : (
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground uppercase">
                  <tr className="border-b border-border/60">
                    <th className="text-left py-2 pr-3">{L("Kod", "Code")}</th>
                    <th className="text-left py-2 pr-3">{L("Rabat", "Discount")}</th>
                    <th className="text-left py-2 pr-3">{L("Użycia", "Uses")}</th>
                    <th className="text-left py-2 pr-3">{L("Ważność", "Validity")}</th>
                    <th className="text-left py-2 pr-3">
                      {L("Plan / Subskrypcja", "Plan / Subscription")}
                    </th>
                    <th className="text-left py-2 pr-3">{L("Status", "Status")}</th>
                    <th className="text-right py-2">{L("Akcje", "Actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.id} className="border-b border-border/40">
                      <td className="py-3 pr-3">
                        <div className="flex items-center gap-2">
                          <code className="font-mono font-semibold text-sm">{c.code}</code>
                          <button
                            type="button"
                            aria-label="Kopiuj"
                            className="text-muted-foreground hover:text-foreground"
                            onClick={() => {
                              void navigator.clipboard.writeText(c.code);
                              toast.success(L("Skopiowano", "Copied"));
                            }}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          {c.campaign_id && (
                            <Link2 className="h-3.5 w-3.5 text-brand" aria-label="kampania" />
                          )}
                        </div>
                        {c.name && <div className="text-xs text-muted-foreground">{c.name}</div>}
                      </td>
                      <td className="py-3 pr-3">
                        {c.discount_kind === "percent"
                          ? `${c.discount_percent}%`
                          : `${((c.discount_cents ?? 0) / 100).toFixed(2)} ${c.currency ?? ""}`}
                      </td>
                      <td className="py-3 pr-3">
                        {c.redemptions_count}
                        {c.max_redemptions != null ? ` / ${c.max_redemptions}` : ""}
                      </td>
                      <td className="py-3 pr-3 text-xs">
                        {c.valid_from ? new Date(c.valid_from).toLocaleDateString(lang) : "—"}
                        {" → "}
                        {c.valid_until ? new Date(c.valid_until).toLocaleDateString(lang) : "∞"}
                      </td>
                      <td className="py-3 pr-3 text-xs">
                        {c.grants_tier_key ? (
                          <span className="inline-flex items-center gap-1">
                            <Badge variant="outline" className="text-xs">
                              {c.grants_tier_key}
                            </Badge>
                            {c.grants_duration_days && (
                              <span className="text-muted-foreground">
                                {c.grants_duration_days}d
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-3 pr-3">
                        {c.active ? (
                          <Badge className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/10">
                            <Check className="h-3 w-3 mr-1" />
                            {L("Aktywny", "Active")}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">{L("Nieaktywny", "Inactive")}</Badge>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <Switch
                            checked={c.active}
                            onCheckedChange={() => toggle.mutate(c)}
                            aria-label="toggle-active"
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="delete"
                            onClick={() => {
                              if (confirm(L("Usunąć kupon?", "Delete coupon?") + ` ${c.code}`)) {
                                remove.mutate(c.id);
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="text-xs uppercase text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}

interface CreateDialogProps {
  plans: Array<{ id: string; name_pl: string | null; name_en: string | null; active: boolean }>;
  tiers: Array<{ key: string; name_pl: string; name_en: string; active: boolean }>;
  onCreated: () => void;
}

function CouponCreateDialog({ plans, tiers, onCreated }: CreateDialogProps) {
  const { i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);

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
      toast.error(L("Podaj kod", "Enter a code"));
      return;
    }
    if (kind === "percent" && (percent < 1 || percent > 100)) {
      toast.error(L("Procent 1–100", "Percent 1–100"));
      return;
    }
    if (kind === "fixed" && cents <= 0) {
      toast.error(L("Kwota > 0", "Amount > 0"));
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
    toast.success(L("Kupon utworzony", "Coupon created"));
    onCreated();
  };

  return (
    <DialogContent className="max-w-xl">
      <DialogHeader>
        <DialogTitle>{L("Nowy kupon B2B", "New B2B coupon")}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{L("Kod", "Code")}</Label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="NES-B2B-10"
              className="uppercase h-10 rounded-[6px]"
            />
          </div>
          <div>
            <Label>{L("Nazwa (opcjonalnie)", "Name (optional)")}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-10 rounded-[6px]"
            />
          </div>
        </div>

        <div>
          <Label>{L("Opis wewnętrzny", "Internal description")}</Label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{L("Typ rabatu", "Discount type")}</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as CouponDiscountKind)}>
              <SelectTrigger className="h-10 rounded-[6px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percent">%</SelectItem>
                <SelectItem value="fixed">{L("Kwotowy", "Fixed")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {kind === "percent" ? (
            <div>
              <Label>{L("Procent", "Percent")}</Label>
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
                <Label>{L("Kwota (grosze)", "Amount (cents)")}</Label>
                <Input
                  type="number"
                  min={1}
                  value={cents}
                  onChange={(e) => setCents(Number(e.target.value))}
                  className="h-10 rounded-[6px]"
                />
              </div>
              <div>
                <Label>{L("Waluta", "Currency")}</Label>
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

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{L("Limit użyć", "Max redemptions")}</Label>
            <Input
              type="number"
              min={1}
              value={maxRedemptions}
              onChange={(e) => setMaxRedemptions(e.target.value)}
              placeholder={L("bez limitu", "unlimited")}
              className="h-10 rounded-[6px]"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <DatePickerField
              value={validFrom}
              onChange={setValidFrom}
              label={L("Ważny od", "Valid from")}
            />
            <DatePickerField
              value={validUntil}
              onChange={setValidUntil}
              label={L("Ważny do", "Valid until")}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/60">
          <div>
            <Label>{L("Nadaje subskrypcję (opcjonalnie)", "Grants subscription (optional)")}</Label>
            <Select
              value={grantsTierKey || "none"}
              onValueChange={(v) => setGrantsTierKey(v === "none" ? "" : v)}
            >
              <SelectTrigger className="h-10 rounded-[6px]">
                <SelectValue placeholder={L("Brak", "None")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{L("Brak", "None")}</SelectItem>
                {tiers.map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    {lang === "pl" ? t.name_pl : t.name_en}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{L("Czas trwania (dni)", "Duration (days)")}</Label>
            <Input
              type="number"
              min={1}
              value={grantsDurationDays}
              onChange={(e) => setGrantsDurationDays(e.target.value)}
              placeholder={L("bezterminowo", "unlimited")}
              disabled={!grantsTierKey}
              className="h-10 rounded-[6px]"
            />
          </div>
        </div>

        <div>
          <Label>{L("Ogranicz do planów (opcjonalnie)", "Restrict to plans (optional)")}</Label>
          <div className="rounded-[6px] border border-border/60 p-2 max-h-40 overflow-y-auto space-y-1">
            {plans.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {L("Brak planów", "No plans available")}
              </p>
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
                    {(lang === "pl" ? p.name_pl : p.name_en) || p.name_pl || p.name_en}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={busy} className="h-10 rounded-[6px]">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : L("Utwórz kupon", "Create coupon")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
