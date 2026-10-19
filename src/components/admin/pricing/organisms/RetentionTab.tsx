// Organizm: zakładka „Retencja odchodzących" panelu Cennika 2.0.
//
// Spina cztery rzeczy wokół rezygnacji: ustawienia kontroferty (procent, liczba
// okresów, ważność kodu), skuteczność z okna `RETENTION_STATS_WINDOW_DAYS`,
// katalog powodów odejścia i przegląd odpowiedzi. Kupony retencyjne powstają
// w module Kuponów B2B (`metadata.source = 'retention'`) - tutaj ustawiamy
// tylko ich parametry.
//
// CO NAPRAWIA (S1 def. 13, Z-08).
//   * JEDNA `queryFn` NA BYT. Zakładka i `/admin/monetization` trzymały pod
//     tym samym kluczem dwa różne zapytania odpowiedzi (kto pierwszy wypełnił
//     cache, ten decydował, co widzi drugi ekran). Teraz oba czytają
//     `retentionFeedbackQueryOptions` z `lib/retention/queries.ts`.
//   * STATYSTYKI Z PEŁNEGO OKNA. Dawne `limit(100)` PRZED filtrem 90 dni
//     liczyło skuteczność z próbki, a wiersze przepływu bez powodu
//     (`started`/`abandoned`) wypierały z niej odpowiedzi. Okno i filtr
//     „tylko z powodem" są teraz w zapytaniu; gdy okno ma więcej odpowiedzi
//     niż limit, ekran mówi to wprost, zamiast udawać pełną statystykę.
//   * STAN SERWERA. Brak wiersza ustawień = serwer NIE pokazuje kontroferty
//     (`acceptRetentionOffer` → `offer_disabled`), a panel pokazywał wtedy
//     „Włączona 30%". Teraz „wyłączona - brak konfiguracji" i jawna akcja
//     „Skonfiguruj", która dopiero podsuwa propozycję do zapisu.
//   * NAJEMCA Z SESJI. Zapis brał `tenant_id` z pierwszego wiersza ustawień,
//     powodów albo odpowiedzi - najemca bez żadnego wiersza nie mógł zapisać
//     nic. Mutatory `retention/mutations.ts` biorą go z sesji, zapis ustawień
//     idzie z tokenem `updated_at` (konflikt `40001`).
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { HeartHandshake } from "lucide-react";

import { RetentionFeedbackList } from "@/components/admin/pricing/molecules/RetentionFeedbackList";
import { RetentionReasonsEditor } from "@/components/admin/pricing/molecules/RetentionReasonsEditor";
import { RetentionSettingsCard } from "@/components/admin/pricing/molecules/RetentionSettingsCard";
import { RetentionStatsCards } from "@/components/admin/pricing/molecules/RetentionStatsCards";
import {
  RETENTION_FEEDBACK_LIMIT,
  retentionFeedbackWindowQueryOptions,
} from "@/components/admin/pricing/retentionFeedbackWindow";
import { showSaveError } from "@/components/admin/pricing/saveErrorToast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  clampInt,
  settingsDraftFromRow,
  type ReasonDraft,
  type RetentionSettingsDraft,
} from "@/lib/admin/pricingDrafts";
import { retentionStats } from "@/lib/admin/retentionStats";
import { ensureI18n as ensurePaywallSyncI18n } from "@/lib/i18n-admin-paywall-sync";
import {
  RETENTION_SETTINGS_LIMITS,
  useDeleteRetentionReason,
  useReorderRetentionReasons,
  useSaveRetentionReason,
  useSaveRetentionSettings,
} from "@/lib/retention/mutations";
import {
  retentionReasonsQueryOptions,
  retentionSettingsQueryOptions,
} from "@/lib/retention/queries";
import { toastError } from "@/lib/toastError";

export function RetentionTab() {
  ensurePaywallSyncI18n();
  const { t } = useTranslation();
  const ta = (k: string, opts?: Record<string, unknown>) => t(`adminPricing.${k}`, opts);

  const settingsQ = useQuery(retentionSettingsQueryOptions("admin"));
  const reasonsQ = useQuery(retentionReasonsQueryOptions("admin"));
  // Ten sam wpis cache co skrót retencji na pulpicie monetyzacji: granica okna
  // zaokrąglona do doby (stała przez pobyt na ekranie) i wspólny limit.
  const feedbackQ = useQuery(retentionFeedbackWindowQueryOptions());

  const saveSettingsM = useSaveRetentionSettings();
  const saveReasonM = useSaveRetentionReason();
  const deleteReasonM = useDeleteRetentionReason();
  const reorderM = useReorderRetentionReasons();

  const reasons = useMemo(() => reasonsQ.data ?? [], [reasonsQ.data]);
  const feedback = useMemo(() => feedbackQ.data?.rows ?? [], [feedbackQ.data]);
  const [settingsDraft, setSettingsDraft] = useState<RetentionSettingsDraft | null>(null);
  const [configuring, setConfiguring] = useState(false);

  // `undefined` = odczyt w drodze albo padł; `null` = wiersza NIE MA (serwer
  // nie pokazuje kontroferty); wiersz = stan do edycji.
  const settingsRow = settingsQ.data;
  const draft = settingsDraft ?? settingsDraftFromRow(settingsRow ?? null);
  // Padnięty przegląd odpowiedzi to nie „zero odpowiedzi" - ani pusta lista,
  // ani zera w statystykach.
  const feedbackFailed = feedbackQ.isError && feedbackQ.data === undefined;

  const saveSettings = async (input: RetentionSettingsDraft) => {
    const { discount_pct, discount_periods, coupon_valid_days } = RETENTION_SETTINGS_LIMITS;
    try {
      await saveSettingsM.mutateAsync({
        settings: {
          enabled: input.enabled,
          discount_pct: clampInt(input.discount_pct, discount_pct.min, discount_pct.max, 30),
          discount_periods: clampInt(
            input.discount_periods,
            discount_periods.min,
            discount_periods.max,
            3,
          ),
          coupon_valid_days: clampInt(
            input.coupon_valid_days,
            coupon_valid_days.min,
            coupon_valid_days.max,
            14,
          ),
        },
        expectedUpdatedAt: settingsRow?.updated_at ?? null,
      });
      toast.success(ta("toast.retentionSaved"));
      setSettingsDraft(null);
      setConfiguring(false);
    } catch (err) {
      showSaveError(err, t, () => {
        void settingsQ.refetch().then(() => setSettingsDraft(null));
      });
    }
  };

  const addReason = async (labels: { label_pl: string; label_en: string }) => {
    const maxSort = reasons.reduce((max, r) => Math.max(max, r.sort_order), 0);
    try {
      await saveReasonM.mutateAsync({ id: null, fields: labels, sortOrder: maxSort + 10 });
      toast.success(ta("toast.reasonAdded"));
    } catch (err) {
      toastError(err, "save");
      // Edytor czyści pola tylko po sukcesie - odrzucona obietnica je zostawia.
      throw err;
    }
  };

  const saveReason = async (id: string, value: ReasonDraft) => {
    const row = reasons.find((r) => r.id === id);
    if (!row) return;
    try {
      await saveReasonM.mutateAsync({
        id,
        expectedUpdatedAt: row.updated_at,
        fields: { label_pl: value.label_pl, label_en: value.label_en, active: value.active },
      });
      toast.success(ta("toast.reasonSaved"));
    } catch (err) {
      showSaveError(err, t, () => void reasonsQ.refetch());
    }
  };

  const deleteReason = async (id: string) => {
    try {
      await deleteReasonM.mutateAsync({ id });
      toast.success(ta("toast.reasonDeleted"));
    } catch (err) {
      toastError(err, "delete");
    }
  };

  const reorderReasons = async (moved: { fromIndex: number; toIndex: number }) => {
    try {
      await reorderM.mutateAsync({
        rows: reasons.map((r) => ({ id: r.id, sort_order: r.sort_order })),
        ...moved,
      });
      toast.success(ta("toast.reordered"));
    } catch (err) {
      toastError(err, "save");
    }
  };

  const stats = useMemo(() => retentionStats(feedback), [feedback]);

  return (
    <div className="space-y-4">
      {settingsRow !== undefined && (settingsRow !== null || configuring) ? (
        <RetentionSettingsCard
          draft={draft}
          saving={saveSettingsM.isPending}
          onChange={(patch) => setSettingsDraft({ ...draft, ...patch })}
          onSave={() => void saveSettings(draft)}
        />
      ) : settingsRow === null ? (
        <Card>
          <CardContent className="space-y-2 pt-5">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <HeartHandshake className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {ta("retention.missingTitle")}
            </p>
            <p className="text-xs text-muted-foreground">{ta("retention.missingDescription")}</p>
            <p className="text-xs text-muted-foreground">
              {ta("retention.defaultsPreview", {
                pct: draft.discount_pct,
                periods: draft.discount_periods,
                days: draft.coupon_valid_days,
              })}
            </p>
            <Button size="sm" onClick={() => setConfiguring(true)}>
              {ta("retention.configure")}
            </Button>
          </CardContent>
        </Card>
      ) : settingsQ.isError ? (
        <LoadFailedCard
          message={ta("retention.settingsLoadError")}
          retryLabel={ta("retention.retryLoad")}
          onRetry={() => void settingsQ.refetch()}
        />
      ) : (
        <div className="h-40 animate-pulse rounded-md bg-muted/50" aria-hidden="true" />
      )}
      {feedbackFailed ? (
        <LoadFailedCard
          message={ta("retention.feedbackLoadError")}
          retryLabel={ta("retention.retryLoad")}
          onRetry={() => void feedbackQ.refetch()}
        />
      ) : (
        <>
          <RetentionStatsCards stats={stats} />
          {feedbackQ.data?.truncated && (
            <p className="text-xs text-muted-foreground">
              {ta("retention.truncated", { limit: RETENTION_FEEDBACK_LIMIT })}
            </p>
          )}
        </>
      )}
      <RetentionReasonsEditor
        reasons={reasons}
        addPending={saveReasonM.isPending}
        savePending={saveReasonM.isPending}
        deletePending={deleteReasonM.isPending}
        reorderPending={reorderM.isPending}
        onAdd={addReason}
        onSave={(id, value) => void saveReason(id, value)}
        onDelete={(id) => void deleteReason(id)}
        onReorder={(moved) => void reorderReasons(moved)}
      />
      {!feedbackFailed && <RetentionFeedbackList feedback={feedback} />}
    </div>
  );
}

/** Nieudany odczyt sekcji: komunikat zamiast udawanych wartości i ponowienie. */
function LoadFailedCard({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
        <Button size="sm" variant="outline" onClick={onRetry}>
          {retryLabel}
        </Button>
      </CardContent>
    </Card>
  );
}
