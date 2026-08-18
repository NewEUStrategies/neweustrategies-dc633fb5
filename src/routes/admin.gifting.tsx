// Panel admina - Gift Articles. Trzy zakladki: Ustawienia (per tenant),
// Linki (przeglad + cofanie), Audyt (log zdarzen created/redeemed/revoked).
// Modul jest domena admin/editor: server functions przechodza przez
// requireAdminEditor, a baza re-waliduje role i tenant w RLS/SECURITY DEFINER
// RPC. Formularz ustawien pracuje na drafcie z lib/gifting/admin-model -
// jedno zrodlo prawdy dla zakresow (lustro CHECK-ow SQL), walidacji i
// semantyki "0 = bez limitu" (puste pole nigdy nie staje sie cichym zerem).
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Gift, Copy, X, Loader2 } from "lucide-react";
import {
  getGiftAdminSettings,
  updateGiftAdminSettings,
  getGiftAdminStats,
  listGiftLinksAdmin,
  listGiftEventsAdmin,
  revokeGiftLinkAdmin,
  type GiftEventType,
} from "@/lib/gifting-admin.functions";
import {
  GIFT_ADMIN_BOUNDS,
  GIFT_ELIGIBILITY_OPTIONS,
  draftToGiftAdminSettings,
  giftAdminSettingsEqual,
  giftCapExhausted,
  parseGiftAdminLimitInput,
  toGiftAdminDraft,
  validateGiftAdminDraft,
  type GiftAdminDraftIssue,
  type GiftAdminLimitField,
  type GiftAdminSettings,
  type GiftAdminSettingsDraft,
} from "@/lib/gifting/admin-model";
import { ensureI18n as ensureGiftingAdminI18n } from "@/lib/i18n-gifting-admin";
import { uiLocale } from "@/lib/i18n/format";

export const Route = createFileRoute("/admin/gifting")({
  component: GiftingAdmin,
});

type Tab = "settings" | "links" | "audit";

function GiftingAdmin() {
  // Rejestracja słownika w chunku KOMPONENTU trasy (nie w entry) - patrz
  // komentarz przy ensureI18n w lib/i18n-gifting-admin.ts.
  ensureGiftingAdminI18n();
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>("settings");
  const lang = i18n.language === "en" ? "en" : "pl";
  const dateLocale = uiLocale(lang);

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "settings", label: t("giftingAdmin.tabs.settings") },
    { id: "links", label: t("giftingAdmin.tabs.links") },
    { id: "audit", label: t("giftingAdmin.tabs.audit") },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold flex items-center gap-3">
          <Gift className="w-7 h-7 text-brand" aria-hidden />
          {t("giftingAdmin.title")}
        </h1>
        <p className="text-muted-foreground mt-1">{t("giftingAdmin.subtitle")}</p>
      </div>

      <StatsPanel />

      <div className="border-b border-border">
        <nav className="flex gap-1" role="tablist">
          {tabs.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={tab === x.id}
              onClick={() => setTab(x.id)}
              className={`px-4 py-2 text-sm font-medium rounded-t-[6px] transition-colors ${
                tab === x.id
                  ? "border-b-2 border-brand text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {x.label}
            </button>
          ))}
        </nav>
      </div>

      {tab === "settings" && <SettingsPanel />}
      {tab === "links" && <LinksPanel dateLocale={dateLocale} />}
      {tab === "audit" && <AuditPanel dateLocale={dateLocale} />}
    </div>
  );
}

// ---------------- Shared queries ----------------

/**
 * Ustawienia tenanta - jeden klucz cache dla zakladki Ustawienia i tabeli
 * linkow (kolumna "otwarcia / cap"), wiec zapis natychmiast odswieza oba.
 */
function useGiftAdminSettingsQuery() {
  const getSettings = useServerFn(getGiftAdminSettings);
  return useQuery({
    queryKey: ["gift-admin", "settings"],
    queryFn: () => getSettings(),
    staleTime: 30_000,
  });
}

// ---------------- Stats ----------------

function StatsPanel() {
  const { t } = useTranslation();
  const getStats = useServerFn(getGiftAdminStats);
  const { data, isLoading } = useQuery({
    queryKey: ["gift-admin", "stats"],
    queryFn: () => getStats(),
    staleTime: 30_000,
  });

  const cells: Array<{ label: string; value: number }> = data
    ? [
        { label: t("giftingAdmin.stats.active"), value: data.active_links },
        { label: t("giftingAdmin.stats.createdThisMonth"), value: data.created_this_month },
        { label: t("giftingAdmin.stats.redeemedThisMonth"), value: data.redeemed_this_month },
        { label: t("giftingAdmin.stats.totalCreated"), value: data.total_created },
        { label: t("giftingAdmin.stats.totalRedeemed"), value: data.total_redeemed },
        { label: t("giftingAdmin.stats.gifters"), value: data.unique_gifters },
        { label: t("giftingAdmin.stats.recipients"), value: data.unique_recipients },
        { label: t("giftingAdmin.stats.exhausted"), value: data.exhausted_links },
        { label: t("giftingAdmin.stats.revoked"), value: data.revoked_links },
        { label: t("giftingAdmin.stats.expired"), value: data.expired_links },
      ]
    : [];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {isLoading
        ? Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              className="h-20 rounded-[6px] border border-border bg-muted/30 animate-pulse"
            />
          ))
        : cells.map((c) => (
            <div key={c.label} className="rounded-[6px] border border-border bg-card p-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {c.label}
              </div>
              <div className="mt-1 font-display text-2xl font-bold">{c.value.toLocaleString()}</div>
            </div>
          ))}
    </div>
  );
}

// ---------------- Settings ----------------

/**
 * Pole limitu (molecule): label + input + walidacja inline + hint. Zakres i
 * atrybuty min/max pochodza z GIFT_ADMIN_BOUNDS, wiec przegladarka, walidacja
 * draftu i CHECK w bazie egzekwuja dokladnie ten sam przedzial. Puste pole
 * trzymamy jako null (issue "required") - nigdy nie koercjujemy go do 0,
 * bo 0 znaczy tu "bez limitu".
 */
function LimitField({
  field,
  label,
  hint,
  value,
  issue,
  zeroWarning,
  onChange,
}: {
  field: GiftAdminLimitField;
  label: string;
  hint: string;
  value: number | null;
  issue: GiftAdminDraftIssue | undefined;
  /** Ostrzezenie pokazywane, gdy wartosc = 0 (limit wylaczony). */
  zeroWarning?: string;
  onChange: (value: number | null) => void;
}) {
  const { t } = useTranslation();
  const bounds = GIFT_ADMIN_BOUNDS[field];
  const inputId = `gift-admin-${field}`;
  const messageId = `${inputId}-message`;

  return (
    <div>
      <label htmlFor={inputId} className="block text-sm font-semibold text-foreground mb-1">
        {label}
      </label>
      <input
        id={inputId}
        type="number"
        inputMode="numeric"
        min={bounds.min}
        max={bounds.max}
        step={1}
        value={value ?? ""}
        onChange={(e) => onChange(parseGiftAdminLimitInput(e.target.value))}
        aria-invalid={issue ? true : undefined}
        aria-describedby={messageId}
        className={`h-10 w-40 rounded-[6px] border bg-background px-3 text-sm ${
          issue ? "border-destructive focus-visible:outline-destructive" : "border-border"
        }`}
      />
      <p
        id={messageId}
        className={`text-xs mt-1 ${issue ? "text-destructive" : "text-muted-foreground"}`}
      >
        {issue
          ? t(`giftingAdmin.settings.errors.${issue}`, { min: bounds.min, max: bounds.max })
          : hint}
      </p>
      {!issue && zeroWarning && value === 0 && (
        <p className="text-xs mt-1 font-medium text-amber-600 dark:text-amber-500" role="alert">
          {zeroWarning}
        </p>
      )}
    </div>
  );
}

function SettingsPanel() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const updateSettings = useServerFn(updateGiftAdminSettings);
  const { data, isLoading } = useGiftAdminSettingsQuery();

  const [draft, setDraft] = useState<GiftAdminSettingsDraft | null>(null);

  const persistedSettings: GiftAdminSettings | null = data
    ? {
        enabled: data.enabled,
        monthly_limit: data.monthly_limit,
        link_ttl_days: data.link_ttl_days,
        max_redemptions_per_link: data.max_redemptions_per_link,
        eligibility: data.eligibility,
      }
    : null;

  const effective = draft ?? (persistedSettings ? toGiftAdminDraft(persistedSettings) : null);

  const save = useMutation({
    mutationFn: (payload: GiftAdminSettings) => updateSettings({ data: payload }),
    onSuccess: () => {
      toast.success(t("giftingAdmin.settings.saved"));
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["gift-admin", "settings"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading || !effective || !persistedSettings || !data) {
    return <p className="text-sm text-muted-foreground">{t("giftingAdmin.common.loading")}</p>;
  }

  const issues = validateGiftAdminDraft(effective);
  const payload = draftToGiftAdminSettings(effective);
  // Brak wiersza w bazie = zapis zawsze dozwolony (utrwala efektywne domyslne);
  // przy istniejacym wierszu wymagamy realnej zmiany.
  const isDirty =
    !data.persisted || (payload !== null && !giftAdminSettingsEqual(payload, persistedSettings));
  const canSave = payload !== null && isDirty && !save.isPending;

  const setField = (field: GiftAdminLimitField) => (value: number | null) =>
    setDraft({ ...effective, [field]: value });

  const updatedAt =
    data.persisted && data.updated_at
      ? new Intl.DateTimeFormat(i18n.language === "en" ? "en-GB" : "pl-PL", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(data.updated_at))
      : null;

  return (
    <div className="max-w-2xl space-y-5">
      {!data.persisted && (
        <p className="rounded-[6px] border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
          {t("giftingAdmin.settings.defaultsNotice")}
        </p>
      )}

      <label className="flex items-start gap-3 p-4 rounded-[6px] border border-border bg-card cursor-pointer">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 rounded-[3px] border-border accent-brand"
          checked={effective.enabled}
          onChange={(e) => setDraft({ ...effective, enabled: e.target.checked })}
        />
        <div>
          <div className="text-sm font-semibold text-foreground">
            {t("giftingAdmin.settings.enabled")}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {t("giftingAdmin.settings.enabledHint")}
          </p>
        </div>
      </label>

      {/* Bramka uprawnienia - kto w ogole zobaczy przycisk „Udostepnij pelny
        artykul" i wygeneruje link. Radiogroup zamiast selecta: dwie opcje z
        realnymi konsekwencjami biznesowymi czyta sie lepiej obok siebie. */}
      <fieldset className="rounded-[6px] border border-border bg-card p-4">
        <legend className="px-1 text-sm font-semibold text-foreground">
          {t("giftingAdmin.settings.eligibility")}
        </legend>
        <p className="text-xs text-muted-foreground mb-3">
          {t("giftingAdmin.settings.eligibilityHint")}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {GIFT_ELIGIBILITY_OPTIONS.map((option) => (
            <label
              key={option}
              className={`flex cursor-pointer items-start gap-3 rounded-[6px] border p-3 transition-colors ${
                effective.eligibility === option
                  ? "border-brand bg-brand/5"
                  : "border-border hover:bg-muted/40"
              }`}
            >
              <input
                type="radio"
                name="gift-admin-eligibility"
                className="mt-1 h-4 w-4 border-border accent-brand"
                value={option}
                checked={effective.eligibility === option}
                onChange={() => setDraft({ ...effective, eligibility: option })}
              />
              <span>
                <span className="block text-sm font-semibold text-foreground">
                  {t(`giftingAdmin.settings.eligibilityOptions.${option}.label`)}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {t(`giftingAdmin.settings.eligibilityOptions.${option}.hint`)}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <LimitField
          field="monthly_limit"
          label={t("giftingAdmin.settings.monthlyLimit")}
          hint={t("giftingAdmin.settings.monthlyLimitHint")}
          value={effective.monthly_limit}
          issue={issues.monthly_limit}
          onChange={setField("monthly_limit")}
        />
        <LimitField
          field="link_ttl_days"
          label={t("giftingAdmin.settings.ttl")}
          hint={t("giftingAdmin.settings.ttlHint")}
          value={effective.link_ttl_days}
          issue={issues.link_ttl_days}
          onChange={setField("link_ttl_days")}
        />
        <LimitField
          field="max_redemptions_per_link"
          label={t("giftingAdmin.settings.cap")}
          hint={t("giftingAdmin.settings.capHint")}
          value={effective.max_redemptions_per_link}
          issue={issues.max_redemptions_per_link}
          zeroWarning={t("giftingAdmin.settings.capZeroWarning")}
          onChange={setField("max_redemptions_per_link")}
        />
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          disabled={!canSave}
          onClick={() => payload && save.mutate(payload)}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-[6px] bg-brand text-brand-foreground text-sm font-semibold hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          {t("giftingAdmin.settings.save")}
        </button>
        {updatedAt && (
          <span className="text-xs text-muted-foreground">
            {t("giftingAdmin.settings.updatedAt", { when: updatedAt })}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------- Links ----------------

type LinkStatus = "all" | "active" | "revoked" | "expired";

function LinksPanel({ dateLocale }: { dateLocale: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [status, setStatus] = useState<LinkStatus>("all");
  const listLinks = useServerFn(listGiftLinksAdmin);
  const revokeLink = useServerFn(revokeGiftLinkAdmin);
  const { data: settings } = useGiftAdminSettingsQuery();

  const { data, isLoading } = useQuery({
    queryKey: ["gift-admin", "links", status],
    queryFn: () => listLinks({ data: { limit: 100, offset: 0, status } }),
  });

  const revoke = useMutation({
    mutationFn: (link_id: string) => revokeLink({ data: { link_id } }),
    onSuccess: () => {
      toast.success(t("giftingAdmin.links.revoked"));
      qc.invalidateQueries({ queryKey: ["gift-admin", "links"] });
      qc.invalidateQueries({ queryKey: ["gift-admin", "stats"] });
      qc.invalidateQueries({ queryKey: ["gift-admin", "audit"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const fmtDate = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(dateLocale, { dateStyle: "short", timeStyle: "short" }).format(
          new Date(iso),
        )
      : "-";

  const filters: Array<{ id: LinkStatus; label: string }> = [
    { id: "all", label: t("giftingAdmin.links.filterAll") },
    { id: "active", label: t("giftingAdmin.links.filterActive") },
    { id: "revoked", label: t("giftingAdmin.links.filterRevoked") },
    { id: "expired", label: t("giftingAdmin.links.filterExpired") },
  ];

  const rows = data?.rows ?? [];
  // Budzet czytamy z LINKU (zamrozony przy tworzeniu), nie z biezacych
  // ustawien tenanta - inaczej kolumna klamalaby po kazdej zmianie suwaka.
  // Ustawienia sluza juz tylko do noty "domyslnie N" nad tabela.
  const defaultCap = settings?.max_redemptions_per_link ?? 0;

  const statusOf = (r: (typeof rows)[number]): "active" | "revoked" | "expired" => {
    if (r.revoked_at) return "revoked";
    if (r.expires_at && new Date(r.expires_at) <= new Date()) return "expired";
    return "active";
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {defaultCap > 0
          ? t("giftingAdmin.links.capNote", { count: defaultCap })
          : t("giftingAdmin.links.capNoteUnlimited")}
      </p>
      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setStatus(f.id)}
            className={`h-9 px-3 rounded-[6px] text-xs font-semibold border transition-colors ${
              status === f.id
                ? "bg-brand text-brand-foreground border-brand"
                : "border-border bg-background text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="rounded-[6px] border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">{t("giftingAdmin.links.col.post")}</th>
                <th className="text-left px-3 py-2">{t("giftingAdmin.links.col.gifter")}</th>
                <th className="text-left px-3 py-2">{t("giftingAdmin.links.col.created")}</th>
                <th className="text-left px-3 py-2">{t("giftingAdmin.links.col.expires")}</th>
                <th className="text-left px-3 py-2">{t("giftingAdmin.links.col.redemptions")}</th>
                <th className="text-left px-3 py-2">{t("giftingAdmin.links.col.status")}</th>
                <th className="text-right px-3 py-2">{t("giftingAdmin.links.col.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    {t("giftingAdmin.common.loading")}
                  </td>
                </tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    {t("giftingAdmin.links.empty")}
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const s = statusOf(r);
                const cap = r.max_redemptions;
                const exhausted = giftCapExhausted(r.redemption_count, cap);
                return (
                  <tr key={r.id} className="hover:bg-muted/20">
                    <td className="px-3 py-2">
                      <div className="font-medium text-foreground line-clamp-1">
                        {r.post_title || r.post_slug || "-"}
                      </div>
                      <div className="text-[11px] text-muted-foreground line-clamp-1">
                        /{r.post_slug ?? ""}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-foreground line-clamp-1">
                        {r.creator_name ?? r.creator_email ?? "-"}
                      </div>
                      {r.creator_email && r.creator_email !== r.creator_name && (
                        <div className="text-[11px] text-muted-foreground line-clamp-1">
                          {r.creator_email}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{fmtDate(r.created_at)}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.expires_at ? fmtDate(r.expires_at) : t("giftingAdmin.links.neverExpires")}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {cap > 0 ? (
                        <span
                          className={exhausted ? "font-semibold text-destructive" : undefined}
                          title={exhausted ? t("giftingAdmin.links.capReached") : undefined}
                        >
                          {r.redemption_count} / {cap}
                        </span>
                      ) : (
                        r.redemption_count
                      )}
                      {/* Unikalni odbiorcy: klikniecia sa deduplikowane, wiec
                        ta liczba mowi, ILU LUDZI realnie otworzylo artykul. */}
                      <span className="ml-1 text-[11px] text-muted-foreground">
                        ({t("giftingAdmin.links.recipients", { count: r.unique_recipients })})
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill status={s} label={t(`giftingAdmin.links.status.${s}`)} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          title={t("giftingAdmin.links.copyCode")}
                          onClick={() => {
                            navigator.clipboard.writeText(r.code);
                            toast.success(t("giftingAdmin.links.copyCode"));
                          }}
                          className="h-8 w-8 rounded-[6px] border border-border hover:bg-muted grid place-items-center text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Copy className="w-3.5 h-3.5" aria-hidden />
                        </button>
                        {s === "active" && (
                          <button
                            type="button"
                            title={t("giftingAdmin.links.revoke")}
                            disabled={revoke.isPending}
                            onClick={() => {
                              if (window.confirm(t("giftingAdmin.links.confirmRevoke"))) {
                                revoke.mutate(r.id);
                              }
                            }}
                            className="h-8 w-8 rounded-[6px] border border-border hover:bg-destructive/10 hover:border-destructive/40 grid place-items-center text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <X className="w-3.5 h-3.5" aria-hidden />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatusPill({
  status,
  label,
}: {
  status: "active" | "revoked" | "expired";
  label: string;
}) {
  const cls =
    status === "active"
      ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
      : status === "revoked"
        ? "bg-destructive/10 text-destructive border-destructive/20"
        : "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={`inline-flex items-center h-6 px-2 rounded-[6px] border text-[11px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {label}
    </span>
  );
}

// ---------------- Audit ----------------

type EventFilter = "all" | "created" | "redeemed" | "revoked" | "exhausted";

function AuditPanel({ dateLocale }: { dateLocale: string }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<EventFilter>("all");
  const listEvents = useServerFn(listGiftEventsAdmin);

  const { data, isLoading } = useQuery({
    queryKey: ["gift-admin", "audit", filter],
    queryFn: () => listEvents({ data: { limit: 200, offset: 0, event_type: filter } }),
  });

  const rows = data?.rows ?? [];

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(dateLocale, { dateStyle: "short", timeStyle: "medium" }).format(
      new Date(iso),
    );

  const filters: Array<{ id: EventFilter; label: string }> = [
    { id: "all", label: t("giftingAdmin.audit.filterAll") },
    { id: "created", label: t("giftingAdmin.audit.filterCreated") },
    { id: "redeemed", label: t("giftingAdmin.audit.filterRedeemed") },
    { id: "revoked", label: t("giftingAdmin.audit.filterRevoked") },
    { id: "exhausted", label: t("giftingAdmin.audit.filterExhausted") },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`h-9 px-3 rounded-[6px] text-xs font-semibold border transition-colors ${
              filter === f.id
                ? "bg-brand text-brand-foreground border-brand"
                : "border-border bg-background text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="rounded-[6px] border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">{t("giftingAdmin.audit.col.when")}</th>
                <th className="text-left px-3 py-2">{t("giftingAdmin.audit.col.type")}</th>
                <th className="text-left px-3 py-2">{t("giftingAdmin.audit.col.post")}</th>
                <th className="text-left px-3 py-2">{t("giftingAdmin.audit.col.actor")}</th>
                <th className="text-left px-3 py-2">{t("giftingAdmin.audit.col.code")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    {t("giftingAdmin.common.loading")}
                  </td>
                </tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    {t("giftingAdmin.audit.empty")}
                  </td>
                </tr>
              )}
              {rows.map((e) => (
                <tr key={e.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2 text-muted-foreground tabular-nums whitespace-nowrap">
                    {fmt(e.created_at)}
                  </td>
                  <td className="px-3 py-2">
                    <EventPill
                      type={e.event_type}
                      label={t(`giftingAdmin.audit.type.${e.event_type}`, {
                        defaultValue: e.event_type,
                      })}
                    />
                  </td>
                  <td className="px-3 py-2 text-foreground">
                    <span className="line-clamp-1">{e.post_title || "-"}</span>
                  </td>
                  <td className="px-3 py-2">
                    {e.event_type === "redeemed" && !e.actor_id ? (
                      <span className="text-muted-foreground italic">
                        {t("giftingAdmin.audit.anonymous")}
                      </span>
                    ) : (
                      <span className="text-foreground line-clamp-1">
                        {e.actor_name ?? e.actor_email ?? "-"}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                    {e.code.slice(0, 10)}...
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const EVENT_PILL_CLS: Record<GiftEventType, string> = {
  created: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  redeemed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  revoked: "bg-destructive/10 text-destructive border-destructive/20",
  expired: "bg-muted text-muted-foreground border-border",
  exhausted: "bg-amber-500/10 text-amber-600 border-amber-500/20",
};

function isKnownEventType(type: string): type is GiftEventType {
  return type in EVENT_PILL_CLS;
}

/** Nieznane typy zdarzen dostaja neutralna tonacje zamiast wysypywac render. */
function EventPill({ type, label }: { type: string; label: string }) {
  const cls = isKnownEventType(type) ? EVENT_PILL_CLS[type] : EVENT_PILL_CLS.expired;
  return (
    <span
      className={`inline-flex items-center h-6 px-2 rounded-[6px] border text-[11px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {label}
    </span>
  );
}
