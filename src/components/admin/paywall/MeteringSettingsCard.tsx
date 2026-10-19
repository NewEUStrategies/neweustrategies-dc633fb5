// Organizm: ustawienia licznika darmowych artykułów (`metering_settings`,
// singleton najemcy; egzekwowanie serwerowe w `consume_metered_view`).
// Reużywa go hub S7 (zakładka Dostęp) - kontrakt propsów: PLAN S1 §4.7.
//
// CO NAPRAWIA (S1 def. 14, DIAGNOZA paywalla).
//   * BRAK WIERSZA = WYŁĄCZONY. Serwer bez wiersza `metering_settings` nie liczy
//     niczego, a formularz podstawiał wtedy `DEFAULT_METERING_SETTINGS` -
//     admin widział „włączony, 5 artykułów" i był pewien, że licznik działa.
//     Teraz karta pokazuje stan serwera (`meteringServerState`): przy braku
//     wiersza „Wyłączony - brak konfiguracji" i jawną akcję „Włącz z wartościami
//     domyślnymi" (`METERING_DEFAULTS` = SQL `metering_defaults()`); formularz
//     pojawia się dopiero, gdy jest co edytować, a do zapisu propozycja
//     domyślnych jest tylko propozycją.
//   * ZAPIS Z TOKENEM. Dawny `upsert(onConflict: tenant_id)` nadpisywał wiersz
//     bez względu na to, co admin widział. `useSaveMeteringSettings` robi UPDATE
//     warunkowany `updated_at` (konflikt `40001`) albo INSERT przy braku wiersza.
//   * JEDEN KLUCZ Z CZYTELNIKIEM. `meteringSettingsQueryOptions()` to ten sam
//     wpis cache, który czyta strona artykułu i unieważnia szyna - zapis tutaj
//     widać u czytelnika bez drugiego zapytania.
import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Gauge, Power } from "lucide-react";

import { SectionCard } from "@/components/admin/membership/atoms/SectionCard";
import { DisabledReason } from "@/components/admin/pricing/atoms/DisabledReason";
import { showSaveError } from "@/components/admin/pricing/saveErrorToast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { meteringSettingsQueryOptions, type MeteringSettings } from "@/lib/access/metering";
import { METERING_DEFAULTS } from "@/lib/access/meteringDefaults";
import {
  METERING_LIMIT_MAX,
  meteringImpactPreviewQueryOptions,
  meteringServerState,
  useSaveMeteringSettings,
} from "@/lib/access/meteringQueries";
import { isStaleWriteError } from "@/lib/billing/planQueries";
import { uiLocale } from "@/lib/i18n/format";
import { ensureI18n } from "@/lib/i18n-admin-paywall-sync";
import { useNowMs } from "@/lib/time/useNowMs";

type MeteringToggle = "meter_paid" | "meter_members" | "show_counter";

export function MeteringSettingsCard({ readOnly = false }: { readOnly?: boolean }) {
  ensureI18n();
  const { t } = useTranslation();
  const settingsQ = useQuery(meteringSettingsQueryOptions());
  const saveM = useSaveMeteringSettings();
  const id = useId();
  const server = settingsQ.data === undefined ? null : meteringServerState(settingsQ.data);
  // Szkic istnieje tylko nad wierszem serwera albo nad propozycją domyślnych,
  // którą admin świadomie otworzył. `null` = formularz pokazuje stan serwera.
  const [draft, setDraft] = useState<MeteringSettings | null>(null);
  const [proposingDefaults, setProposingDefaults] = useState(false);
  const readOnlyReason = readOnly ? t("adminPaywall.readOnly.hint") : null;

  const base: MeteringSettings | null =
    server?.kind === "row" ? server.settings : proposingDefaults ? { ...METERING_DEFAULTS } : null;
  const form = draft ?? base;
  const expectedUpdatedAt = server?.kind === "row" ? server.updatedAt : null;

  const save = async (settings: MeteringSettings) => {
    try {
      await saveM.mutateAsync({ settings, expectedUpdatedAt });
      setDraft(null);
      setProposingDefaults(false);
      toast.success(t("adminPaywall.metering.saved"));
    } catch (err) {
      if (isStaleWriteError(err)) {
        // „Wczytaj aktualne" = stan serwera jako nowa baza formularza; do tej
        // chwili szkic admina zostaje na ekranie („Zostaw mój szkic").
        showSaveError(err, t, () => {
          void settingsQ.refetch().then(() => setDraft(null));
        });
        return;
      }
      console.error("[paywall] metering save failed", err);
      toast.error(t("adminPaywall.metering.saveError"));
    }
  };

  const toggle = (key: MeteringToggle, labelKey: string) =>
    form ? (
      <div className="flex items-center gap-2 text-sm">
        <Switch
          id={`${id}-${key}`}
          checked={form[key]}
          disabled={!form.enabled}
          onCheckedChange={(next) => setDraft({ ...form, [key]: next })}
        />
        <Label htmlFor={`${id}-${key}`} className="font-normal">
          {t(labelKey)}
        </Label>
      </div>
    ) : null;

  const limitField = (key: "member_monthly_limit" | "anon_monthly_limit", labelKey: string) =>
    form ? (
      <div>
        <Label htmlFor={`${id}-${key}`}>{t(labelKey)}</Label>
        <Input
          id={`${id}-${key}`}
          type="number"
          min={0}
          max={METERING_LIMIT_MAX}
          value={form[key]}
          onChange={(e) => setDraft({ ...form, [key]: Number(e.target.value) || 0 })}
          className="w-40"
          disabled={!form.enabled}
        />
      </div>
    ) : null;

  return (
    <SectionCard
      icon={Gauge}
      title={t("adminPaywall.metering.title")}
      description={t("adminPaywall.metering.subtitle")}
    >
      {settingsQ.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          {t("adminPaywall.metering.readError")}
          <Button size="sm" variant="outline" onClick={() => void settingsQ.refetch()}>
            {t("adminPaywall.metering.retry")}
          </Button>
        </div>
      ) : server === null ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("common.loading")}
        </p>
      ) : form === null ? (
        <div className="space-y-3 rounded-md border border-dashed border-border bg-muted/30 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Power className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {t("adminPaywall.metering.missingTitle")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("adminPaywall.metering.missingDescription")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("adminPaywall.metering.defaultsPreview", {
              member: METERING_DEFAULTS.member_monthly_limit,
              anon: METERING_DEFAULTS.anon_monthly_limit,
            })}
          </p>
          <DisabledReason reason={readOnlyReason}>
            <Button
              size="sm"
              disabled={readOnly || saveM.isPending}
              onClick={() => setProposingDefaults(true)}
            >
              {t("adminPaywall.metering.enableDefaults")}
            </Button>
          </DisabledReason>
        </div>
      ) : (
        <fieldset disabled={readOnly} className="space-y-4">
          {server.kind === "missing" && (
            <p className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              {t("adminPaywall.sync.serverMissing")}
            </p>
          )}
          <div className="flex items-center gap-2 text-sm font-medium">
            <Switch
              id={`${id}-enabled`}
              checked={form.enabled}
              onCheckedChange={(next) => setDraft({ ...form, enabled: next })}
            />
            <Label htmlFor={`${id}-enabled`}>{t("adminPaywall.metering.enabled")}</Label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {limitField("member_monthly_limit", "adminPaywall.metering.memberLimit")}
            {limitField("anon_monthly_limit", "adminPaywall.metering.anonLimit")}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {toggle("meter_paid", "adminPaywall.metering.meterPaid")}
            {toggle("meter_members", "adminPaywall.metering.meterMembers")}
            {toggle("show_counter", "adminPaywall.metering.showCounter")}
          </div>
          <MeteringImpactPreview proposedLimit={form.member_monthly_limit} enabled={form.enabled} />
          <DisabledReason reason={readOnlyReason}>
            <Button onClick={() => void save(form)} disabled={readOnly || saveM.isPending}>
              {t("adminPaywall.metering.save")}
            </Button>
          </DisabledReason>
        </fieldset>
      )}
    </SectionCard>
  );
}

/**
 * Podgląd wpływu limitu na bieżący miesiąc kalendarzowy (RPC
 * `metering_impact_preview`, staff-only) z debouncem - bez niego każde
 * uderzenie klawisza w polu limitu byłoby osobnym wywołaniem RPC.
 */
function MeteringImpactPreview({
  proposedLimit,
  enabled,
}: {
  proposedLimit: number;
  enabled: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const [debounced, setDebounced] = useState(proposedLimit);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(proposedLimit), 350);
    return () => window.clearTimeout(timer);
  }, [proposedLimit]);

  const q = useQuery(meteringImpactPreviewQueryOptions(debounced, enabled));
  const fmt = new Intl.NumberFormat(uiLocale(lang));
  const now = useNowMs(60_000);
  const monthLabel =
    now === null
      ? ""
      : new Intl.DateTimeFormat(uiLocale(lang), {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        }).format(now);
  const row = q.data;

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm font-medium">{t("adminPaywall.metering.impact.title")}</p>
        <span className="text-xs capitalize text-muted-foreground">{monthLabel}</span>
      </div>
      {!enabled ? (
        <p className="text-xs text-muted-foreground">
          {t("adminPaywall.metering.impact.disabled")}
        </p>
      ) : q.isLoading ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t("common.loading")}
        </p>
      ) : q.isError ? (
        <p className="text-xs text-destructive">{t("adminPaywall.metering.impact.error")}</p>
      ) : !row || row.total_members + row.total_anon === 0 ? (
        <p className="text-xs text-muted-foreground">{t("adminPaywall.metering.impact.empty")}</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("adminPaywall.metering.impact.blocked")}
              </dt>
              <dd className="font-semibold tabular-nums text-destructive">
                {fmt.format(row.members_blocked)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("adminPaywall.metering.impact.warning")}
              </dt>
              <dd className="font-semibold tabular-nums text-brand-ink dark:text-brand">
                {fmt.format(row.members_warning)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("adminPaywall.metering.impact.safe")}
              </dt>
              <dd className="font-semibold tabular-nums">{fmt.format(row.members_safe)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("adminPaywall.metering.impact.avg")}
              </dt>
              <dd className="font-semibold tabular-nums">
                {fmt.format(Number(row.avg_used) || 0)}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            {t("adminPaywall.metering.impact.summary", {
              members: fmt.format(row.total_members),
              anon: fmt.format(row.total_anon),
              views: fmt.format(row.total_views),
              max: fmt.format(row.max_used),
              limit: fmt.format(debounced),
            })}
          </p>
        </>
      )}
    </div>
  );
}
