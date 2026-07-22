// Panel admina - Gift Articles. Trzy zakladki: Ustawienia (per tenant),
// Linki (przeglad + cofanie), Audyt (log zdarzen created/redeemed/revoked).
// Wszystkie dane pochodza z SECURITY DEFINER RPC re-walidujacych rolę i tenant.
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
} from "@/lib/gifting-admin.functions";
import "@/lib/i18n-gifting-admin";

export const Route = createFileRoute("/admin/gifting")({
  component: GiftingAdmin,
});

type Tab = "settings" | "links" | "audit";

function GiftingAdmin() {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>("settings");
  const lang = i18n.language === "en" ? "en" : "pl";
  const dateLocale = lang === "pl" ? "pl-PL" : "en-GB";

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

      <StatsPanel dateLocale={dateLocale} />

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

// ---------------- Stats ----------------

function StatsPanel({ dateLocale: _l }: { dateLocale: string }) {
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
        { label: t("giftingAdmin.stats.revoked"), value: data.revoked_links },
        { label: t("giftingAdmin.stats.expired"), value: data.expired_links },
      ]
    : [];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {isLoading
        ? Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-20 rounded-[6px] border border-border bg-muted/30 animate-pulse" />
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

function SettingsPanel() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const getSettings = useServerFn(getGiftAdminSettings);
  const updateSettings = useServerFn(updateGiftAdminSettings);

  const { data, isLoading } = useQuery({
    queryKey: ["gift-admin", "settings"],
    queryFn: () => getSettings(),
  });

  const [draft, setDraft] = useState<{
    enabled: boolean;
    monthly_limit: number;
    link_ttl_days: number;
  } | null>(null);

  const effective = draft ?? (data
    ? {
        enabled: data.enabled,
        monthly_limit: data.monthly_limit,
        link_ttl_days: data.link_ttl_days,
      }
    : null);

  const save = useMutation({
    mutationFn: (payload: NonNullable<typeof draft>) => updateSettings({ data: payload }),
    onSuccess: () => {
      toast.success(t("giftingAdmin.settings.saved"));
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["gift-admin", "settings"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading || !effective) {
    return <p className="text-sm text-muted-foreground">{t("giftingAdmin.common.loading")}</p>;
  }

  const set = <K extends keyof NonNullable<typeof draft>>(
    k: K,
    v: NonNullable<typeof draft>[K],
  ) => setDraft({ ...effective, [k]: v });

  const updatedAt = data?.updated_at
    ? new Intl.DateTimeFormat(i18n.language === "en" ? "en-GB" : "pl-PL", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(data.updated_at))
    : null;

  return (
    <div className="max-w-2xl space-y-5">
      <label className="flex items-start gap-3 p-4 rounded-[6px] border border-border bg-card cursor-pointer">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 rounded-[3px] border-border accent-brand"
          checked={effective.enabled}
          onChange={(e) => set("enabled", e.target.checked)}
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

      <div>
        <label className="block text-sm font-semibold text-foreground mb-1">
          {t("giftingAdmin.settings.monthlyLimit")}
        </label>
        <input
          type="number"
          min={0}
          max={1000}
          value={effective.monthly_limit}
          onChange={(e) => set("monthly_limit", Math.max(0, Math.min(1000, Number(e.target.value))))}
          className="h-10 w-40 rounded-[6px] border border-border bg-background px-3 text-sm"
        />
        <p className="text-xs text-muted-foreground mt-1">
          {t("giftingAdmin.settings.monthlyLimitHint")}
        </p>
      </div>

      <div>
        <label className="block text-sm font-semibold text-foreground mb-1">
          {t("giftingAdmin.settings.ttl")}
        </label>
        <input
          type="number"
          min={0}
          max={365}
          value={effective.link_ttl_days}
          onChange={(e) => set("link_ttl_days", Math.max(0, Math.min(365, Number(e.target.value))))}
          className="h-10 w-40 rounded-[6px] border border-border bg-background px-3 text-sm"
        />
        <p className="text-xs text-muted-foreground mt-1">{t("giftingAdmin.settings.ttlHint")}</p>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          disabled={save.isPending || !draft}
          onClick={() => draft && save.mutate(draft)}
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

  const rows = (data?.rows ?? []) as unknown as Array<{
    id: string;
    post_title: string;
    post_slug: string | null;
    creator_name: string | null;
    creator_email: string | null;
    code: string;
    created_at: string;
    expires_at: string | null;
    revoked_at: string | null;
    redemption_count: number;
    last_redeemed_at: string | null;
  }>;

  const statusOf = (r: (typeof rows)[number]): "active" | "revoked" | "expired" => {
    if (r.revoked_at) return "revoked";
    if (r.expires_at && new Date(r.expires_at) <= new Date()) return "expired";
    return "active";
  };

  return (
    <div className="space-y-3">
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
                    <td className="px-3 py-2 tabular-nums">{r.redemption_count}</td>
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

type EventFilter = "all" | "created" | "redeemed" | "revoked";

function AuditPanel({ dateLocale }: { dateLocale: string }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<EventFilter>("all");
  const listEvents = useServerFn(listGiftEventsAdmin);

  const { data, isLoading } = useQuery({
    queryKey: ["gift-admin", "audit", filter],
    queryFn: () => listEvents({ data: { limit: 200, offset: 0, event_type: filter } }),
  });

  const rows = (data?.rows ?? []) as unknown as Array<{
    id: string;
    event_type: "created" | "redeemed" | "revoked" | "expired";
    post_title: string;
    actor_id: string | null;
    actor_name: string | null;
    actor_email: string | null;
    code: string;
    created_at: string;
  }>;

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(dateLocale, { dateStyle: "short", timeStyle: "medium" }).format(
      new Date(iso),
    );

  const filters: Array<{ id: EventFilter; label: string }> = [
    { id: "all", label: t("giftingAdmin.audit.filterAll") },
    { id: "created", label: t("giftingAdmin.audit.filterCreated") },
    { id: "redeemed", label: t("giftingAdmin.audit.filterRedeemed") },
    { id: "revoked", label: t("giftingAdmin.audit.filterRevoked") },
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
                    <EventPill type={e.event_type} label={t(`giftingAdmin.audit.type.${e.event_type}`)} />
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

function EventPill({
  type,
  label,
}: {
  type: "created" | "redeemed" | "revoked" | "expired";
  label: string;
}) {
  const cls =
    type === "created"
      ? "bg-blue-500/10 text-blue-600 border-blue-500/20"
      : type === "redeemed"
        ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
        : type === "revoked"
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
