// Organizm: log zdarzeń gifting (audyt).
//
// Filtr typu zdarzenia jedzie do zapytania i do klucza cache. Zbiór filtrów
// jest WĘŻSZY niż enum walidatora server fn - to świadoma obserwacja, nie
// przeoczenie w ekstrakcji: kod przeniesiony znak w znak zachowuje pięć
// przycisków, a brakującego "expired" dowodzi test.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { GiftFilterChip } from "@/components/admin/gifting/atoms/GiftFilterChip";
import { GiftEventRow } from "@/components/admin/gifting/molecules/GiftEventRow";
import { GiftTableState } from "@/components/admin/gifting/molecules/GiftTableState";
import { listGiftEventsAdmin } from "@/lib/gifting-admin.functions";
import { ensureI18n as ensureGiftingAdminI18n } from "@/lib/i18n-gifting-admin";

type EventFilter = "all" | "created" | "redeemed" | "revoked" | "exhausted";

export function GiftAuditPanel({ dateLocale }: { dateLocale: string }) {
  ensureGiftingAdminI18n();
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
          <GiftFilterChip
            key={f.id}
            label={f.label}
            active={filter === f.id}
            onSelect={() => setFilter(f.id)}
          />
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
              <GiftTableState
                isLoading={isLoading}
                isEmpty={rows.length === 0}
                colSpan={5}
                loadingLabel={t("giftingAdmin.common.loading")}
                emptyLabel={t("giftingAdmin.audit.empty")}
              />
              {rows.map((e) => (
                <GiftEventRow key={e.id} event={e} formatDate={fmt} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
