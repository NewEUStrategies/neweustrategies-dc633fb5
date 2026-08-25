// Organizm: LEADY SPONSORÓW.
//
// ZGODA JEST MIGAWKĄ Z CHWILI SKANU, nie aktualnym stanem profilu. Uczestnik
// mógł zgodę później wycofać - wiersz nadal pokazuje, co zapisano przy stoisku,
// bo to ta migawka rozstrzyga, czy sponsor miał prawo napisać do tej osoby.
//
// BRAK ZGODY JEST ODZNACZONY WPROST. Wiersz bez zgody nie trafia do materiałów
// marketingowych sponsora, więc odznaka nie jest ozdobą, tylko granicą prawną.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { FormSelect } from "@/components/atoms/FormSelect";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { AdminPagination } from "@/components/admin/molecules/AdminPagination";
import { adminOnsiteErrorMessage } from "@/lib/events/adminOnsiteErrors";
import { useLeadScans } from "@/lib/events/useEventOnsite";
import { useSponsors } from "@/lib/events/useEventSponsors";

const ALL = "__all__";

export function OnsiteLeadsPanel({ eventId }: { eventId: string }) {
  const { t, i18n } = useTranslation();
  const [sponsorId, setSponsorId] = useState(ALL);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const sponsorsQ = useSponsors({ eventId, limit: 200 });
  const listQ = useLeadScans({
    eventId,
    sponsorId: sponsorId === ALL ? undefined : sponsorId,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  const rows = listQ.data ?? [];
  const total = rows.length === 0 ? 0 : rows[0].total_count;

  const sponsorOptions = useMemo(
    () => [
      { value: ALL, label: t("adminEventOnsite.filters.all") },
      ...(sponsorsQ.data ?? []).map((row) => ({
        value: row.id,
        label: row.snapshot_name || row.crm_name || row.id,
      })),
    ],
    [sponsorsQ.data, t],
  );

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h2 className="font-display text-lg">{t("adminEventOnsite.leads.title")}</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t("adminEventOnsite.leads.subtitle")}
        </p>
      </header>

      <div className="max-w-md space-y-1.5">
        <Label htmlFor="leads-sponsor">{t("adminEventOnsite.filters.sponsor")}</Label>
        <FormSelect
          id="leads-sponsor"
          value={sponsorId}
          options={sponsorOptions}
          onValueChange={(value) => {
            setSponsorId(value);
            setPage(1);
          }}
          aria-label={t("adminEventOnsite.filters.sponsor")}
        />
      </div>

      <AdminCatalogListState
        isLoading={listQ.isLoading}
        loadingLabel={t("adminEventOnsite.leads.loading")}
        errorMessage={
          listQ.error === null || listQ.error === undefined
            ? null
            : adminOnsiteErrorMessage(listQ.error)
        }
        isEmpty={rows.length === 0}
        emptyLabel={t("adminEventOnsite.leads.empty")}
      >
        <div className="overflow-hidden rounded-md border border-border/70">
          <ul className="divide-y divide-border/70">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {`${row.first_name ?? ""} ${row.last_name ?? ""}`.trim()}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[row.company, row.sponsor_name, row.device_label]
                      .filter((part) => part !== null && part !== "")
                      .join(" · ")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={row.consent ? "default" : "destructive"}>
                    {t(
                      row.consent
                        ? "adminEventOnsite.labels.consent"
                        : "adminEventOnsite.labels.noConsent",
                    )}
                  </Badge>
                  {row.interest_rating === null ? null : (
                    <Badge variant="outline">{`${t("adminEventOnsite.labels.interest")}: ${row.interest_rating}`}</Badge>
                  )}
                  {row.scan_count > 1 ? (
                    <Badge variant="outline">{`${t("adminEventOnsite.labels.scans")}: ${row.scan_count}`}</Badge>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    {new Date(row.last_scanned_at).toLocaleString(i18n.language)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <AdminPagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </div>
      </AdminCatalogListState>
    </section>
  );
}
