// Molekula: tabela lejka per kampania, z rozbiciem na zrodlo/medium.
//
// KOSZT NALEZY DO KAMPANII, NIE DO KANALU. Wiersz grupy niesie koszt, CPA
// i ROAS; wiersze kanalow (wciete pod grupa) - tylko liczby lejka i przychod.
// Wskaznik "zgloszenie z wizyty" liczymy WEWNATRZ grupy: te same przegladarki
// ze zgoda po obu stronach ulamka.
//
// "BEZ ATRYBUCJI" TO OSOBNY WIERSZ Z UCZCIWYM WYJASNIENIEM. Zgloszenia bez
// zgody na pomiar, z innego urzadzenia albo spoza formularza nie maja wizyt -
// w tabeli stoja z kreska w kolumnach lejka, a nie z zerem.
//
// "POZOSTALE KAMPANIE" TO WIERSZ ZBIORCZY. Baza zwija kampanie UTM i Google Ads
// spoza 50 najliczniejszych w jedna grupe `other` (nazwy przychodza z adresow
// obcych, wiec lista bez limitu rosla dowolnie) - wiersz mowi, ile zwinieto.
//
// Molekula nie pyta serwera: dostaje gotowy raport.
import { Fragment } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  costPerAcquisition,
  returnOnAdSpend,
  stepRate,
  type AdsFunnelGroupKind,
  type AdsFunnelReport,
} from "@/lib/events/adsFunnel";
import { adsFunnelGroupName } from "@/lib/events/adsFunnelCsv";
import { formatAmounts, formatCosts, formatRate, formatRoas } from "@/lib/events/adsFunnelFormat";
import { ensureAdsFunnelI18n } from "@/lib/i18n-admin-event-ads-funnel";

const KIND_LABEL_KEYS: Record<AdsFunnelGroupKind, string> = {
  campaign: "adminEventAdsFunnel.table.kinds.campaign",
  utm_campaign: "adminEventAdsFunnel.table.kinds.utm_campaign",
  gad_campaign: "adminEventAdsFunnel.table.kinds.gad_campaign",
  other: "adminEventAdsFunnel.table.kinds.other",
  none: "adminEventAdsFunnel.table.kinds.none",
};

const DASH = "—";

function shown(value: string | number | null): string | number {
  return value === null ? DASH : value;
}

export function AdsFunnelCampaignTable({
  report,
  lang,
}: {
  report: AdsFunnelReport;
  lang: string;
}) {
  ensureAdsFunnelI18n();
  const { t } = useTranslation();
  const noCampaign = t("adminEventAdsFunnel.table.noCampaign");
  const otherCampaigns = t("adminEventAdsFunnel.table.otherCampaigns");

  if (report.groups.length === 0 && report.unattributed.registrations === 0) {
    return <p className="text-sm text-muted-foreground">{t("adminEventAdsFunnel.table.empty")}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t("adminEventAdsFunnel.table.campaign")}</TableHead>
            <TableHead scope="col" className="text-right">
              {t("adminEventAdsFunnel.table.visits")}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t("adminEventAdsFunnel.table.registrationStarts")}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t("adminEventAdsFunnel.table.registrations")}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t("adminEventAdsFunnel.table.conversion")}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t("adminEventAdsFunnel.table.checkoutStarts")}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t("adminEventAdsFunnel.table.paid")}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t("adminEventAdsFunnel.table.revenue")}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t("adminEventAdsFunnel.table.cost")}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t("adminEventAdsFunnel.table.cpa")}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t("adminEventAdsFunnel.table.roas")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.groups.map((group) => {
            const cpa = costPerAcquisition(group.cost, group.paid);
            return (
              <Fragment key={group.key}>
                <TableRow>
                  <TableHead scope="row" className="font-medium">
                    <span className="mr-2">
                      {adsFunnelGroupName(group, noCampaign, otherCampaigns)}
                    </span>
                    <Badge variant="outline">{t(KIND_LABEL_KEYS[group.kind])}</Badge>
                    {group.kind === "other" ? (
                      <span className="block text-[11px] font-normal text-muted-foreground">
                        {t("adminEventAdsFunnel.table.otherHint", { folded: report.groupsFolded })}
                      </span>
                    ) : null}
                  </TableHead>
                  <TableCell className="text-right tabular-nums">{group.visits}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {group.registrationStarts}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{group.registrations}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {shown(formatRate(stepRate(group.registrations, group.visits)))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{group.checkoutStarts}</TableCell>
                  <TableCell className="text-right tabular-nums">{group.paid}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {shown(formatAmounts(group.revenue, lang))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {shown(formatCosts(group.cost, lang))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {shown(cpa === null ? null : formatCosts([cpa], lang))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {shown(formatRoas(returnOnAdSpend(group.revenue, group.cost)))}
                  </TableCell>
                </TableRow>
                {group.channels.map((channel) => (
                  <TableRow
                    key={`${group.key}|${channel.source}|${channel.medium}`}
                    className="text-muted-foreground"
                  >
                    <TableCell className="pl-8 text-xs">
                      {`${channel.source} / ${channel.medium}`}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {channel.visits}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {channel.registrationStarts}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {channel.registrations}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {shown(formatRate(stepRate(channel.registrations, channel.visits)))}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {channel.checkoutStarts}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {channel.paid}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {shown(formatAmounts(channel.revenue, lang))}
                    </TableCell>
                    <TableCell colSpan={3} />
                  </TableRow>
                ))}
              </Fragment>
            );
          })}
          <TableRow>
            <TableHead scope="row" className="font-medium">
              <span className="block">{t("adminEventAdsFunnel.table.unattributed")}</span>
              <span className="block text-[11px] font-normal text-muted-foreground">
                {t("adminEventAdsFunnel.table.unattributedHint")}
              </span>
            </TableHead>
            <TableCell className="text-right">{DASH}</TableCell>
            <TableCell className="text-right">{DASH}</TableCell>
            <TableCell className="text-right tabular-nums">
              {report.unattributed.registrations}
            </TableCell>
            <TableCell className="text-right">{DASH}</TableCell>
            <TableCell className="text-right">{DASH}</TableCell>
            <TableCell className="text-right tabular-nums">{report.unattributed.paid}</TableCell>
            <TableCell className="text-right tabular-nums">
              {shown(formatAmounts(report.unattributed.revenue, lang))}
            </TableCell>
            <TableCell colSpan={3} />
          </TableRow>
          <TableRow className="font-semibold">
            <TableHead scope="row">{t("adminEventAdsFunnel.table.total")}</TableHead>
            <TableCell className="text-right tabular-nums">{report.totals.visits}</TableCell>
            <TableCell className="text-right tabular-nums">
              {report.totals.registrationStarts}
            </TableCell>
            <TableCell className="text-right tabular-nums">{report.totals.registrations}</TableCell>
            <TableCell className="text-right">{DASH}</TableCell>
            <TableCell className="text-right tabular-nums">
              {report.totals.checkoutStarts}
            </TableCell>
            <TableCell className="text-right tabular-nums">{report.totals.paid}</TableCell>
            <TableCell className="text-right tabular-nums">
              {shown(formatAmounts(report.totals.revenue, lang))}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {shown(formatCosts(report.totals.cost, lang))}
            </TableCell>
            <TableCell colSpan={2} />
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
