// Zakładka Kupony - lista + CRUD (rozbudowa: DatePicker, powiązania CRM/plan).
//
// Po ekstrakcji trasa jest KOMPOZYCJĄ: warstwa danych (trzy zapytania i dwie
// mutacje) plus złożenie organizmów. Reguły listy mieszkają w
// `lib/billing/couponAdminList`, reguły formularza w `lib/billing/couponAdminForm`,
// a widok w `components/admin/coupons/{atoms,molecules,organisms}`.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ensureI18n as ensureAdminCouponsI18n } from "@/lib/i18n-admin-coupons";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { CouponListToolbar } from "@/components/admin/coupons/molecules/CouponListToolbar";
import { CouponStatsRow } from "@/components/admin/coupons/molecules/CouponStatsRow";
import { CouponCreateDialog } from "@/components/admin/coupons/organisms/CouponCreateDialog";
import {
  CouponsTable,
  type CouponAdminRow,
} from "@/components/admin/coupons/organisms/CouponsTable";
import {
  couponListStats,
  filterCoupons,
  type CouponListStatus,
} from "@/lib/billing/couponAdminList";

export const Route = createFileRoute("/admin/coupons/")({
  component: CouponsListPage,
});

function CouponsListPage() {
  // Rejestracja słownika w chunku KOMPONENTU trasy (nie w entry) - patrz
  // komentarz przy ensureI18n w lib/i18n-admin-coupons.ts.
  ensureAdminCouponsI18n();
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState<CouponListStatus>("all");
  const [search, setSearch] = useState("");

  const couponsQ = useQuery({
    queryKey: ["admin", "b2b-coupons"],
    queryFn: async (): Promise<CouponAdminRow[]> => {
      const { data, error } = await supabase
        .from("b2b_coupons")
        .select(
          "id, code, name, description, discount_kind, discount_percent, discount_cents, currency, active, max_redemptions, redemptions_count, valid_from, valid_until, plan_ids, organization_id, metadata, created_at, updated_at, campaign_id, grants_tier_key, grants_duration_days, assigned_company_id, assigned_lead_id",
        )
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as CouponAdminRow[];
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
    mutationFn: async (row: CouponAdminRow) => {
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
  const filtered = useMemo(
    () => filterCoupons(rows, { search, status: filterStatus }, Date.now()),
    [rows, search, filterStatus],
  );
  const stats = useMemo(() => couponListStats(rows, Date.now()), [rows]);

  return (
    <div className="space-y-6">
      <CouponListToolbar
        search={search}
        onSearch={setSearch}
        status={filterStatus}
        onStatus={setFilterStatus}
      >
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
      </CouponListToolbar>

      <CouponStatsRow stats={stats} />

      <CouponsTable
        rows={filtered}
        loading={couponsQ.isLoading}
        lang={lang}
        onCopy={(code) => {
          void navigator.clipboard.writeText(code);
          toast.success(t("adminCoupons.copied"));
        }}
        onToggle={(row) => toggle.mutate(row)}
        onDelete={(row) => {
          if (confirm(t("adminCoupons.deleteCoupon") + ` ${row.code}`)) {
            remove.mutate(row.id);
          }
        }}
      />
    </div>
  );
}
