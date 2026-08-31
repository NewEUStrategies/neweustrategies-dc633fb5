// Organizm: cala strona listy kuponow B2B. Trasa
// `src/routes/admin.coupons.index.tsx` jest juz cienkim opakowaniem.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ensureI18n as ensureAdminCouponsI18n } from "@/lib/i18n-admin-coupons";
import { Plus, Trash2, Copy, Check, Loader2, Link2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { confirmDialog } from "@/lib/appDialogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { B2bCouponRow } from "@/lib/billing/coupons";
import { Stat } from "../atoms/Stat";
import { CouponCreateDialog } from "./CouponCreateDialog";

export type ExtRow = B2bCouponRow & {
  campaign_id: string | null;
  grants_tier_key: string | null;
  grants_duration_days: number | null;
  assigned_company_id: string | null;
  assigned_lead_id: string | null;
};

export function CouponsListPage() {
  // Rejestracja słownika w chunku KOMPONENTU trasy (nie w entry) - patrz
  // komentarz przy ensureI18n w lib/i18n-admin-coupons.ts.
  ensureAdminCouponsI18n();
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
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

  // Dialog APLIKACJI, nie natywny `confirm`: natywne okno blokuje cala karte,
  // nie da sie go ostylowac ani oznaczyc jako destrukcyjne, a przegladarka
  // pozwala uzytkownikowi zablokowac kolejne takie okna - wtedy `confirm`
  // zwraca `false` bez pytania i przycisk kasowania cicho przestaje dzialac.
  const askAndRemove = async (row: ExtRow) => {
    const potwierdzone = await confirmDialog({
      title: t("adminCoupons.deleteCoupon"),
      description: t("adminCoupons.deleteCouponBody", { code: row.code }),
      destructive: true,
      confirmLabel: t("adminCoupons.deleteConfirm"),
    });
    if (potwierdzone) remove.mutate(row.id);
  };

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
            placeholder={t("adminCoupons.searchCodeName")}
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
              <SelectItem value="all">{t("adminCoupons.all")}</SelectItem>
              <SelectItem value="active">{t("adminCoupons.active")}</SelectItem>
              <SelectItem value="inactive">{t("adminCoupons.inactive")}</SelectItem>
              <SelectItem value="expired">{t("adminCoupons.expired")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="h-10 rounded-[6px]">
              <Plus className="h-4 w-4 mr-2" />
              {t("adminCoupons.newCoupon")}
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
        <Stat label={t("adminCoupons.total")} value={String(rows.length)} />
        <Stat label={t("adminCoupons.active")} value={String(active)} />
        <Stat label={t("adminCoupons.totalRedemptions")} value={String(totalRedemptions)} />
        <Stat label={t("adminCoupons.expired")} value={String(expired)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("adminCoupons.couponList")}</CardTitle>
        </CardHeader>
        <CardContent>
          {couponsQ.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("adminCoupons.loading")}
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">{t("adminCoupons.results")}</p>
          ) : (
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground uppercase">
                  <tr className="border-b border-border/60">
                    <th className="text-left py-2 pr-3">{t("adminCoupons.code")}</th>
                    <th className="text-left py-2 pr-3">{t("adminCoupons.discount")}</th>
                    <th className="text-left py-2 pr-3">{t("adminCoupons.uses")}</th>
                    <th className="text-left py-2 pr-3">{t("adminCoupons.validity")}</th>
                    <th className="text-left py-2 pr-3">{t("adminCoupons.planSubscription")}</th>
                    <th className="text-left py-2 pr-3">{t("adminCoupons.status")}</th>
                    <th className="text-right py-2">{t("adminCoupons.actions")}</th>
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
                            aria-label={t("adminCoupons.copyCode")}
                            className="text-muted-foreground hover:text-foreground"
                            onClick={() => {
                              void navigator.clipboard.writeText(c.code);
                              toast.success(t("adminCoupons.copied"));
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
                        {c.valid_from ? new Date(c.valid_from).toLocaleDateString(lang) : "-"}
                        {" → "}
                        {c.valid_until
                          ? new Date(c.valid_until).toLocaleDateString(lang)
                          : t("adminCoupons.unlimited2")}
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
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="py-3 pr-3">
                        {c.active ? (
                          <Badge className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/10">
                            <Check className="h-3 w-3 mr-1" />
                            {t("adminCoupons.active2")}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">{t("adminCoupons.inactive2")}</Badge>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <Switch
                            checked={c.active}
                            onCheckedChange={() => toggle.mutate(c)}
                            aria-label={t("adminCoupons.toggleActive")}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t("adminCoupons.deleteAction")}
                            onClick={() => void askAndRemove(c)}
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
