// Organizm: wydane linki raportu dla sponsorów - kto ma dostęp, do kiedy,
// ile razy raport otwierano, z odwołaniem.
//
// LISTA NIE ZNA TOKENÓW. Baza oddaje wyłącznie prefiks (8 znaków) - po nim
// organizator rozpoznaje link w wiadomości do sponsora, a nikt z panelu nie
// odtworzy poświadczenia. Odwołanie działa od razu: odczyt po tokenie odmawia
// linkowi odwołanemu i przeterminowanemu tym samym „wygasł".
//
// STAN LINKU LICZY BAZA (`is_active` = nieodwołany i nieprzeterminowany),
// a panel rozróżnia tylko, KTÓRY z dwóch powodów zamknął link - bez zegara
// przeglądarki w renderze.
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { confirmDialog } from "@/lib/appDialogs";
import { adminSponsorReportErrorMessage } from "@/lib/events/adminSponsorReportErrors";
import type { SponsorReportLinkRow } from "@/lib/events/sponsorReportApi";
import { formatEventDate, formatEventDateTime } from "@/lib/events/timezone";
import { useRevokeSponsorReportLink, useSponsorReportLinks } from "@/lib/events/useSponsorReport";
import { uiLang } from "@/lib/i18n/format";
import { ensureSponsorReportI18n } from "@/lib/i18n-admin-event-sponsor-report";

type LinkStatus = "active" | "revoked" | "expired";

const STATUS_KEYS: Record<LinkStatus, string> = {
  active: "adminEventSponsorReport.links.active",
  revoked: "adminEventSponsorReport.links.revoked",
  expired: "adminEventSponsorReport.links.expired",
};

function linkStatus(row: SponsorReportLinkRow): LinkStatus {
  if (row.is_active) return "active";
  return row.revoked_at ? "revoked" : "expired";
}

export function SponsorReportLinksPanel({
  eventId,
  timezone,
}: {
  eventId: string;
  timezone: string;
}) {
  ensureSponsorReportI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const linksQ = useSponsorReportLinks(eventId);
  const revoke = useRevokeSponsorReportLink(eventId);
  const links = linksQ.data ?? [];

  const onRevoke = async (row: SponsorReportLinkRow) => {
    const ok = await confirmDialog({
      title: t("adminEventSponsorReport.links.revokeFor", { prefix: row.token_prefix }),
      description: t("adminEventSponsorReport.links.revokeConfirm"),
      confirmLabel: t("adminEventSponsorReport.links.revoke"),
      destructive: true,
    });
    if (!ok) return;
    revoke.mutate(row.id, {
      onSuccess: () => toast.success(t("adminEventSponsorReport.links.revokedToast")),
      onError: (error) => toast.error(adminSponsorReportErrorMessage(error)),
    });
  };

  return (
    <AdminCatalogListState
      isLoading={linksQ.isPending}
      loadingLabel={t("adminEventSponsorReport.loading")}
      errorMessage={linksQ.isError ? adminSponsorReportErrorMessage(linksQ.error) : null}
      isEmpty={links.length === 0}
      emptyLabel={t("adminEventSponsorReport.links.empty")}
    >
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("adminEventSponsorReport.links.sponsor")}</TableHead>
              <TableHead>{t("adminEventSponsorReport.links.label")}</TableHead>
              <TableHead>{t("adminEventSponsorReport.links.prefix")}</TableHead>
              <TableHead>{t("adminEventSponsorReport.links.leads")}</TableHead>
              <TableHead>{t("adminEventSponsorReport.links.expires")}</TableHead>
              <TableHead>{t("adminEventSponsorReport.links.lastSeen")}</TableHead>
              <TableHead className="text-right">
                {t("adminEventSponsorReport.links.views")}
              </TableHead>
              <TableHead>{t("adminEventSponsorReport.links.status")}</TableHead>
              <TableHead>
                <span className="sr-only">{t("adminEventSponsorReport.table.actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {links.map((row) => {
              const status = linkStatus(row);
              return (
                <TableRow key={row.id}>
                  <TableCell>{row.sponsor_name}</TableCell>
                  <TableCell>{row.label}</TableCell>
                  <TableCell>
                    <code className="text-xs">{row.token_prefix}…</code>
                  </TableCell>
                  <TableCell>
                    {row.include_leads
                      ? t("adminEventSponsorReport.links.withLeads")
                      : t("adminEventSponsorReport.links.withoutLeads")}
                  </TableCell>
                  <TableCell>{formatEventDate(row.expires_at, timezone, lang)}</TableCell>
                  <TableCell>
                    {row.last_seen_at
                      ? formatEventDateTime(row.last_seen_at, timezone, lang, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })
                      : t("adminEventSponsorReport.links.never")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.view_count}</TableCell>
                  <TableCell>
                    <Badge variant={status === "active" ? "default" : "secondary"}>
                      {t(STATUS_KEYS[status])}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {status === "active" ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={t("adminEventSponsorReport.links.revokeFor", {
                          prefix: row.token_prefix,
                        })}
                        disabled={revoke.isPending}
                        onClick={() => void onRevoke(row)}
                      >
                        {t("adminEventSponsorReport.links.revoke")}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </AdminCatalogListState>
  );
}
