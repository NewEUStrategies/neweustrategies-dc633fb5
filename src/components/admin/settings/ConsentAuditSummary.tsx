// Administracyjne podsumowanie rejestru zgód (audyt RODO).
//
// Dane wyłącznie z utwardzonych RPC (bramka admina + zakres najemca po stronie
// bazy) - komponent nie dotyka `user_consent_events` bezpośrednio.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react";
import { listConsentDecisions, listConsentStats } from "@/lib/admin/consentAudit.functions";
import { ensureI18n } from "@/lib/i18n-admin-consent-audit";

ensureI18n();

const WINDOWS = [7, 30, 90] as const;

function formatDate(value: string | null, lang: string): string {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "-"
    : d.toLocaleString(lang === "en" ? "en-GB" : "pl-PL", {
        dateStyle: "short",
        timeStyle: "short",
      });
}

function KeyChip({ label, tone }: { label: string; tone: "granted" | "denied" }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
        tone === "granted"
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-destructive/10 text-destructive"
      }`}
    >
      {label}
    </span>
  );
}

export function ConsentAuditSummary() {
  const { t, i18n } = useTranslation();
  const [days, setDays] = useState<number>(30);
  const [limit, setLimit] = useState<number>(25);

  const stats = useQuery({
    queryKey: ["admin", "consent-stats", days],
    queryFn: () => listConsentStats({ data: { days } }),
  });
  const decisions = useQuery({
    queryKey: ["admin", "consent-decisions", limit],
    queryFn: () => listConsentDecisions({ data: { limit, offset: 0 } }),
  });

  return (
    <section className="mt-10 border-t border-border pt-6">
      <div className="mb-4 flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
        >
          <ShieldCheck className="h-4 w-4" />
        </span>
        <div>
          <h3 className="font-display text-lg">{t("adminConsentAudit.title")}</h3>
          <p className="text-xs text-muted-foreground">{t("adminConsentAudit.hint")}</p>
        </div>
      </div>

      {/* Podsumowanie zbiorcze */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {t("adminConsentAudit.stats.window")}:
        </span>
        {WINDOWS.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => setDays(w)}
            aria-pressed={days === w}
            className={`rounded-md border px-2 py-1 text-xs transition-colors ${
              days === w
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            {t(`adminConsentAudit.stats.days${w}`)}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">{t("adminConsentAudit.stats.key")}</th>
              <th className="px-3 py-2 text-right">{t("adminConsentAudit.stats.granted")}</th>
              <th className="px-3 py-2 text-right">{t("adminConsentAudit.stats.denied")}</th>
              <th className="px-3 py-2 text-right">{t("adminConsentAudit.stats.gpc")}</th>
              <th className="px-3 py-2 text-left">{t("adminConsentAudit.stats.bannerVersions")}</th>
              <th className="px-3 py-2 text-left">{t("adminConsentAudit.stats.lastEvent")}</th>
            </tr>
          </thead>
          <tbody>
            {stats.isLoading && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-xs text-muted-foreground">
                  {t("adminConsentAudit.decisions.loading")}
                </td>
              </tr>
            )}
            {stats.isError && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-xs text-destructive">
                  {t("adminConsentAudit.decisions.error")}
                </td>
              </tr>
            )}
            {stats.data?.length === 0 && !stats.isLoading && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-xs text-muted-foreground">
                  {t("adminConsentAudit.decisions.empty")}
                </td>
              </tr>
            )}
            {stats.data?.map((row) => (
              <tr key={row.consent_key} className="border-t border-border">
                <td className="px-3 py-2 font-medium">{row.consent_key}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.granted}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.denied}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.gpc_events}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {row.banner_versions?.join(", ") || "-"}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {formatDate(row.last_event_at, i18n.language)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Dziennik decyzji */}
      <h4 className="mt-6 mb-2 text-sm font-medium">{t("adminConsentAudit.decisions.title")}</h4>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">{t("adminConsentAudit.decisions.user")}</th>
              <th className="px-3 py-2 text-left">{t("adminConsentAudit.decisions.when")}</th>
              <th className="px-3 py-2 text-left">{t("adminConsentAudit.decisions.categories")}</th>
              <th className="px-3 py-2 text-left">
                {t("adminConsentAudit.decisions.bannerVersion")}
              </th>
              <th className="px-3 py-2 text-left">{t("adminConsentAudit.decisions.source")}</th>
              <th className="px-3 py-2 text-left">{t("adminConsentAudit.decisions.page")}</th>
            </tr>
          </thead>
          <tbody>
            {decisions.isLoading && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-xs text-muted-foreground">
                  {t("adminConsentAudit.decisions.loading")}
                </td>
              </tr>
            )}
            {decisions.isError && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-xs text-destructive">
                  {t("adminConsentAudit.decisions.error")}
                </td>
              </tr>
            )}
            {decisions.data?.length === 0 && !decisions.isLoading && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-xs text-muted-foreground">
                  {t("adminConsentAudit.decisions.empty")}
                </td>
              </tr>
            )}
            {decisions.data?.map((row) => (
              <tr key={row.decision_id} className="border-t border-border align-top">
                <td className="px-3 py-2">
                  <span className="block font-medium">{row.display_name || row.email || "-"}</span>
                  {row.display_name && row.email && (
                    <span className="block text-xs text-muted-foreground">{row.email}</span>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">
                  {formatDate(row.decided_at, i18n.language)}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {row.granted_keys.map((k) => (
                      <KeyChip key={`g-${k}`} label={k} tone="granted" />
                    ))}
                    {row.denied_keys.map((k) => (
                      <KeyChip key={`d-${k}`} label={k} tone="denied" />
                    ))}
                    {row.gpc && (
                      <span className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                        {t("adminConsentAudit.decisions.gpcActive")}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {row.banner_version || "-"}
                  {row.lang ? ` · ${row.lang.toUpperCase()}` : ""}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {row.source
                    ? t(`adminConsentAudit.sources.${row.source}`, { defaultValue: row.source })
                    : "-"}
                </td>
                <td className="px-3 py-2 max-w-[220px] truncate text-xs text-muted-foreground">
                  {row.page_url || "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {decisions.data && decisions.data.length >= limit && (
        <button
          type="button"
          onClick={() => setLimit((n) => Math.min(n + 25, 200))}
          className="mt-3 rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
        >
          {t("adminConsentAudit.decisions.more")}
        </button>
      )}
    </section>
  );
}
