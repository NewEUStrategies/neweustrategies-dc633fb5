// Organizm: zakładka „Retencja odchodzących" panelu Cennika 2.0.
//
// Spina cztery rzeczy wokół rezygnacji: ustawienia kontroferty (procent, liczba
// okresów, ważność kodu), skuteczność z ostatnich 90 dni, katalog powodów
// odejścia i przegląd odpowiedzi. Kupony retencyjne powstają w module Kuponów
// B2B (`metadata.source = 'retention'`) - tutaj ustawiamy tylko ich parametry.
//
// Wyniesione z pliku trasy `/admin/pricing` (1821 linii) bez zmiany zachowania.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { RetentionFeedbackList } from "@/components/admin/pricing/molecules/RetentionFeedbackList";
import { RetentionReasonsEditor } from "@/components/admin/pricing/molecules/RetentionReasonsEditor";
import { RetentionSettingsCard } from "@/components/admin/pricing/molecules/RetentionSettingsCard";
import { RetentionStatsCards } from "@/components/admin/pricing/molecules/RetentionStatsCards";
import { supabase } from "@/integrations/supabase/client";
import {
  clampInt,
  settingsDraftFromRow,
  type ReasonDraft,
  type RetentionSettingsDraft,
} from "@/lib/admin/pricingDrafts";
import { retentionStats } from "@/lib/admin/retentionStats";
import { persistOrder } from "@/lib/admin/sortOrder";
import type {
  RetentionFeedbackRow,
  RetentionReasonRow,
  RetentionSettingsRow,
} from "@/lib/retention/queries";

export function RetentionTab() {
  const { t } = useTranslation();
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
    mutationFn: async (labels: { label_pl: string; label_en: string }) => {
      if (!tenantId) throw new Error(ta("toast.noTenant"));
      const maxSort = reasons.reduce((max, r) => Math.max(max, r.sort_order), 0);
      const { error } = await supabase.from("retention_reasons").insert({
        tenant_id: tenantId,
        label_pl: labels.label_pl.trim(),
        label_en: labels.label_en.trim(),
        sort_order: maxSort + 10,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(ta("toast.reasonAdded"));
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
  const stats = useMemo(() => retentionStats(feedback), [feedback]);

  return (
    <div className="space-y-4">
      <RetentionSettingsCard
        draft={draft}
        saving={saveSettings.isPending}
        onChange={(patch) => setSettingsDraft({ ...draft, ...patch })}
        onSave={() => saveSettings.mutate(draft)}
      />
      <RetentionStatsCards stats={stats} />
      <RetentionReasonsEditor
        reasons={reasons}
        addPending={addReason.isPending}
        savePending={saveReason.isPending}
        deletePending={deleteReason.isPending}
        reorderPending={reorderReasons.isPending}
        onAdd={(labels) => addReason.mutateAsync(labels)}
        onSave={(id, value) => saveReason.mutate({ id, value })}
        onDelete={(id) => deleteReason.mutate(id)}
        onReorder={(moved) => reorderReasons.mutate(moved)}
      />
      <RetentionFeedbackList feedback={feedback} />
    </div>
  );
}
