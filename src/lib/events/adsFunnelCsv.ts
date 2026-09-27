// Eksport tabeli lejka do CSV (arkusz organizatora, nie import do Google Ads).
//
// WSPOLNY SERIALIZATOR `csvDocument` (`src/lib/crm/csv.ts`): komorki
// zaczynajace sie od znaku formuly dostaja apostrof - w tym pliku nazwy
// kampanii i zrodla pochodza z ADRESOW, ktore wpisal ktos obcy
// (`utm_campaign==HYPERLINK(...)`), wiec ochrona przed wstrzyknieciem formuly
// jest tu konieczna. BOM dla Excela dokleja wolajacy (jak w innych eksportach).
//
// Jeden wiersz na kanal (zrodlo/medium) w grupie kampanii, plus wiersz
// "bez atrybucji". Koszt, CPA i ROAS sa w wierszu grupy (koszt nalezy do
// kampanii, nie do kanalu) - wiersze kanalow maja tam puste komorki.
import { csvDocument, type CsvCellValue } from "@/lib/crm/csv";
import {
  costPerAcquisition,
  microsToCents,
  returnOnAdSpend,
  type AdsFunnelGroup,
  type AdsFunnelReport,
  type CostAmount,
  type MoneyAmount,
} from "@/lib/events/adsFunnel";
import { centsToDecimal } from "@/lib/events/adsOfflineConversions";

export interface AdsFunnelCsvLabels {
  campaign: string;
  source: string;
  medium: string;
  visits: string;
  registrationStarts: string;
  registrations: string;
  checkoutStarts: string;
  paid: string;
  revenue: string;
  cost: string;
  cpa: string;
  roas: string;
  /** Nazwa grupy "bez kampanii". */
  noCampaign: string;
  /** Nazwa grupy kampanii zwinietych przez baze (`other`). */
  otherCampaigns: string;
  /** Nazwa wiersza zgloszen bez atrybucji. */
  unattributed: string;
}

function amounts(items: readonly MoneyAmount[]): string {
  return items.map((item) => `${centsToDecimal(item.cents)} ${item.currency}`).join("; ");
}

function costText(items: readonly CostAmount[]): string {
  return amounts(
    items.map((item) => ({ currency: item.currency, cents: microsToCents(item.micros) })),
  );
}

export function adsFunnelGroupName(
  group: AdsFunnelGroup,
  noCampaign: string,
  otherCampaigns: string,
): string {
  if (group.kind === "none") return noCampaign;
  if (group.kind === "other") return otherCampaigns;
  return group.label ?? group.utmCampaign ?? group.gadCampaignId ?? noCampaign;
}

export function buildAdsFunnelCsv(report: AdsFunnelReport, labels: AdsFunnelCsvLabels): string {
  const header = [
    labels.campaign,
    labels.source,
    labels.medium,
    labels.visits,
    labels.registrationStarts,
    labels.registrations,
    labels.checkoutStarts,
    labels.paid,
    labels.revenue,
    labels.cost,
    labels.cpa,
    labels.roas,
  ];
  const rows: CsvCellValue[][] = [];
  for (const group of report.groups) {
    const name = adsFunnelGroupName(group, labels.noCampaign, labels.otherCampaigns);
    const cpa = costPerAcquisition(group.cost, group.paid);
    const roas = returnOnAdSpend(group.revenue, group.cost);
    rows.push([
      name,
      "",
      "",
      group.visits,
      group.registrationStarts,
      group.registrations,
      group.checkoutStarts,
      group.paid,
      amounts(group.revenue),
      costText(group.cost),
      cpa === null ? "" : costText([cpa]),
      roas === null ? "" : roas.toFixed(2),
    ]);
    for (const channel of group.channels) {
      rows.push([
        name,
        channel.source,
        channel.medium,
        channel.visits,
        channel.registrationStarts,
        channel.registrations,
        channel.checkoutStarts,
        channel.paid,
        amounts(channel.revenue),
        "",
        "",
        "",
      ]);
    }
  }
  rows.push([
    labels.unattributed,
    "",
    "",
    "",
    "",
    report.unattributed.registrations,
    "",
    report.unattributed.paid,
    amounts(report.unattributed.revenue),
    "",
    "",
    "",
  ]);
  return csvDocument(header, rows);
}
