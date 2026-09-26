// Molekula: EKSPORT planu sali do CSV - lista przy drzwiach, wszystkie miejsca,
// goscie jednej firmy.
//
// DANE CIAGNIEMY W CHWILI KLIKNIECIA (`admin_event_seating_export`), a nie
// z cache ekranu: plik ma pokazywac stan bazy, a nie ostatni odczyt, ktory
// mogl sie zestarzec, gdy drugi organizator przesadzal gosci.
//
// LISTA GOSCI FIRMY (CRM): osoby firmy i miejsca, ktore trzymamy dla niej
// (wprost, przez sponsora albo zamowienie pakietowe) - to jest plik dla
// opiekuna klienta. Nazwa firmy jest zapisywana w chwili eksportu.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { FormSelect } from "@/components/atoms/FormSelect";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Download } from "@/lib/lucide-shim";
import { adminSeatingErrorMessage } from "@/lib/events/adminSeatingErrors";
import { fetchSeatingExport, type SeatExportRow } from "@/lib/events/seatingApi";
import { seatingCsvFileName, seatingExportToCsv, type SeatingCsvMode } from "@/lib/events/seatingCsv";
import { uiLang } from "@/lib/i18n/format";
import { ensureSeatingI18n } from "@/lib/i18n-admin-event-seating";

ensureSeatingI18n();

const NONE = "__none__";

/** Pobranie tekstu jako pliku - adres zwalniamy w nastepnej klatce (Safari). */
export function downloadTextFile(fileName: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export interface SeatExportCompany {
  id: string;
  name: string;
}

export interface SeatExportMenuProps {
  eventSlug: string;
  mapId: string;
  mapName: string;
  companies: readonly SeatExportCompany[];
  seatText: (row: SeatExportRow) => string;
}

export function SeatExportMenu({ eventSlug, mapId, mapName, companies, seatText }: SeatExportMenuProps) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [companyId, setCompanyId] = useState<string>(NONE);
  const [busy, setBusy] = useState(false);

  const run = async (mode: SeatingCsvMode, company: string | null) => {
    setBusy(true);
    try {
      const rows = await fetchSeatingExport(mapId, company);
      const csv = seatingExportToCsv(rows, { mode, lang, seatText });
      downloadTextFile(
        seatingCsvFileName(eventSlug, mapName, company === null ? mode : "company", new Date().toISOString()),
        csv,
        "text/csv;charset=utf-8",
      );
      toast.success(t("adminEventSeating.toasts.exported"));
    } catch (error: unknown) {
      toast.error(adminSeatingErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">
          <Download className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("adminEventSeating.export.button")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3">
        <Button className="w-full justify-start" variant="ghost" disabled={busy} onClick={() => void run("door", null)}>
          {t("adminEventSeating.export.door")}
        </Button>
        <Button className="w-full justify-start" variant="ghost" disabled={busy} onClick={() => void run("seats", null)}>
          {t("adminEventSeating.export.seats")}
        </Button>
        <div className="space-y-1.5 border-t border-border pt-3">
          <Label htmlFor="seat-export-company">{t("adminEventSeating.export.company")}</Label>
          {companies.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("adminEventSeating.export.noCompanies")}</p>
          ) : (
            <>
              <FormSelect
                id="seat-export-company"
                value={companyId}
                options={[
                  { value: NONE, label: t("adminEventSeating.export.companyPlaceholder") },
                  ...companies.map((company) => ({ value: company.id, label: company.name })),
                ]}
                onValueChange={setCompanyId}
              />
              <Button
                className="w-full"
                size="sm"
                disabled={busy || companyId === NONE}
                onClick={() => void run("seats", companyId)}
              >
                {t("adminEventSeating.export.companyDownload")}
              </Button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
