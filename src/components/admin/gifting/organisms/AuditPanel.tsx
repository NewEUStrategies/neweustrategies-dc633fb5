// Organizm: zakladka AUDYT panelu prezentow - log zdarzen.
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listGiftEventsAdmin } from "@/lib/gifting-admin.functions";
import { EventPill } from "../atoms/EventPill";

export type EventFilter = "all" | "created" | "redeemed" | "revoked" | "exhausted";

export function AuditPanel({ dateLocale }: { dateLocale: string }) {
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
