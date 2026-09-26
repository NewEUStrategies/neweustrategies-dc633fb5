// EKSPORT RAPORTU DLA SPONSORÓW - pliki metryk (CSV z BOM i XLSX).
//
// NAGŁÓWKI DAJE WOŁAJĄCY, Z i18n. Moduł nie zna języków: kolumny tłumaczy
// ekran (`t("...columns.*")`), więc plik z panelu po angielsku ma angielskie
// nagłówki, a ten moduł nie trzyma drugiego słownika obok nakładki.
//
// PLIK WYCHODZI POZA SYSTEM, WIĘC NIE WOLNO MU WYKONAĆ FORMUŁY. Nazwa sponsora
// i etykiety pochodzą od ludzi; `=HYPERLINK(...)` w nazwie firmy byłby w
// Excelu formułą. CSV neutralizuje to w `csvCell` (`toCsv`), a dla XLSX robimy
// to samo tutaj, na każdej komórce tekstowej, zanim arkusz trafi do procesu.
//
// KONTAKTÓW TEN MODUŁ NIE BUDUJE. Plik „kontakty" to `buildLeadExport`
// z `leadExport.ts` - jedna reguła redakcji kontaktu (bez zgody = puste pola)
// dla panelu i dla linku sponsora.
import { neutralizeCsvFormula, toCsv } from "@/lib/csv/formatCsv";
import { leadExportFileName, type LeadExportFile } from "@/lib/events/leadExport";
import { writeSpreadsheetInWorker } from "@/lib/files/spreadsheetWorker";
import {
  ctrPercent,
  reportNumber,
  sponsorCtr,
  type SponsorDailyPoint,
} from "@/lib/events/sponsorReportModel";
import type { SponsorReportSeriesRow } from "@/lib/events/sponsorReportApi";

export type SponsorReportCell = string | number | null;
export type SponsorReportExportFormat = "csv" | "xlsx";

export interface SponsorReportExportOptions {
  format: SponsorReportExportFormat;
  /** Prefiks nazwy pliku (już przetłumaczony). */
  prefix: string;
  /** Nazwa arkusza XLSX (już przetłumaczona). */
  sheetName: string;
  /** Chwila eksportu (ISO) - dzień trafia do nazwy pliku. */
  nowIso: string;
}

function safeCell(value: SponsorReportCell): SponsorReportCell {
  return typeof value === "string" ? neutralizeCsvFormula(value) : value;
}

/** Plik metryk w żądanym formacie - nagłówki i wiersze w kolejności kolumn. */
export async function buildSponsorReportExport(
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<SponsorReportCell>>,
  options: SponsorReportExportOptions,
): Promise<LeadExportFile> {
  if (options.format === "csv") {
    return {
      fileName: leadExportFileName(options.prefix, options.nowIso, "csv"),
      mimeType: "text/csv;charset=utf-8",
      data: `﻿${toCsv(headers, rows)}`,
    };
  }
  const bytes = await writeSpreadsheetInWorker(options.sheetName, [
    headers.map((header) => neutralizeCsvFormula(header)),
    ...rows.map((row) => row.map(safeCell)),
  ]);
  return {
    fileName: leadExportFileName(options.prefix, options.nowIso, "xlsx"),
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    data: bytes,
  };
}

/**
 * Wiersze metryk panelu: dzień x sponsor x miejsce, w kolejności kolumn
 * `day, sponsor, placement, viewsUnique, viewsTotal, clicksUnique,
 * clicksTotal, ctr, materialOpens`. Nazwę sponsora i etykietę miejsca podaje
 * ekran (wie, w jakim języku jest panel).
 */
export function adminMetricsRows(
  series: readonly SponsorReportSeriesRow[],
  sponsorName: (sponsorId: string) => string,
  placementLabel: (placement: string) => string,
): SponsorReportCell[][] {
  return series.map((row) => {
    const views = reportNumber(row.views_unique);
    const clicks = reportNumber(row.clicks_unique);
    return [
      row.day,
      sponsorName(row.sponsor_id),
      placementLabel(row.placement),
      views,
      reportNumber(row.views_total),
      clicks,
      reportNumber(row.clicks_total),
      ctrPercent(sponsorCtr(clicks, views)),
      reportNumber(row.material_opens),
    ];
  });
}

/**
 * Wiersze metryk strony dla sponsora: dzień po dniu, w kolejności kolumn
 * `day, viewsUnique, clicksUnique, ctr, materialOpens, leadsNew`.
 */
export function publicMetricsRows(series: readonly SponsorDailyPoint[]): SponsorReportCell[][] {
  return series.map((point) => [
    point.day,
    point.viewsUnique,
    point.clicksUnique,
    ctrPercent(sponsorCtr(point.clicksUnique, point.viewsUnique)),
    point.materialOpens,
    point.leadsNew,
  ]);
}
