// Import leadów CRM z pliku CSV (dedup po e-mailu).
//
// Krok 1: upload pliku -> wspólny parser @/lib/csv/parseCsv
// Krok 2: mapowanie kolumn (auto-detekcja PL/EN naglowkow)
// Krok 3: podgląd + import porcjami (CRM_IMPORT_CHUNK_SIZE per wywołanie RPC
//         crm_import_leads - dedup/merge liczy baza przez crm_upsert_from_form).
//
// Duplikaty WEWNĄTRZ pliku odpadają po stronie klienta (pierwszy wiersz
// wygrywa), duplikaty względem bazy są scalane (merge), nie duplikowane.
//
// Wartość ponad limit pola (I9, Z-I9b-15) - tag > 64 znaki, nazwisko > 100,
// ponad 20 tagów w komórce - dialog pokazuje z numerem wiersza i kolumną
// i blokuje „Importuj" do poprawy pliku. Nie przycinamy: przycięta wartość to
// inna dana osobowa niż w pliku, a serwer odrzuciłby całą porcję.
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileSpreadsheet, FileText, Upload } from "lucide-react";
import { UploadArea } from "@/components/ui/upload-area";
import { parseCsv } from "@/lib/csv/parseCsv";
import {
  LEAD_IMPORT_FIELD_CHOICES,
  autoMapHeaders,
  mapImportRows,
  type LeadImportFieldChoice,
  type LeadImportMapping,
  type OversizedImportValue,
} from "@/lib/crm/importMapping";
import {
  CRM_IMPORT_CHUNK_SIZE,
  importCrmLeads,
  type CrmImportSummary,
} from "@/lib/crm-tasks.functions";
import { crmKeys } from "@/lib/crm/keys";

// Etykiety pól zostają w panelu (PL/EN), reguła mapowania mieszka w
// lib/crm/importMapping.ts - to ona decyduje o losie danych osobowych.
type FieldKey = LeadImportFieldChoice;

const FIELD_LABELS: Record<"pl" | "en", Record<FieldKey, string>> = {
  pl: {
    email: "E-mail (wymagane)",
    first_name: "Imię",
    last_name: "Nazwisko",
    phone: "Telefon",
    company: "Firma",
    position: "Stanowisko",
    country: "Kraj",
    linkedin_url: "LinkedIn",
    tags: "Tagi (rozdzielone | ; ,)",
    "": "-- pomiń --",
  },
  en: {
    email: "E-mail (required)",
    first_name: "First name",
    last_name: "Last name",
    phone: "Phone",
    company: "Company",
    position: "Position",
    country: "Country",
    linkedin_url: "LinkedIn",
    tags: "Tags (separated by | ; ,)",
    "": "-- skip --",
  },
};

// Radix Select ODRZUCA pustą wartość pozycji (rzuca wyjątkiem, żeby `""` mogło
// znaczyć „wyczyszczone"). Opcja „pomiń kolumnę" ma w mapowaniu właśnie pustą
// wartość, więc w interfejsie zastępuje ją wartownik - inaczej krok mapowania
// kolumn NIE RENDERUJE SIĘ WCALE (cały dialog padał po wybraniu pliku).
const SKIP_VALUE = "__skip__";

/** Ile wartości ponad limit wypisujemy z nazwy - resztę podsumowuje licznik. */
const OVERSIZED_LISTED = 5;

const PL_PLURAL = new Intl.PluralRules("pl");

/** Liczebnik PL: forma `one` / `few` / `many` (ułamki nie występują). */
function plForm(n: number, one: string, few: string, many: string): string {
  const form = PL_PLURAL.select(n);
  return form === "one" ? one : form === "few" ? few : many;
}

type OversizedText = (issue: OversizedImportValue, column: string) => string;

const TXT = {
  pl: {
    open: "Import CSV",
    title: "Import leadów z CSV",
    desc: "Wgraj plik, zmapuj kolumny i zatwierdź. Duplikaty po e-mailu są scalane z istniejącymi leadami (merge), nie duplikowane.",
    pickTitle: "Wgraj plik CSV z leadami",
    pick: "Przeciągnij plik .csv tutaj albo wybierz go z dysku.\nDo 5000 wierszy w jednym pliku.",
    pickCta: "Wybierz plik CSV",
    rows: (total: number, valid: number, dupes: number) =>
      `${total} wierszy, ${valid} z poprawnym e-mailem` +
      (dupes > 0 ? `, ${dupes} duplikatów w pliku` : ""),
    changeFile: "Zmień plik",
    mapping: "Mapowanie kolumn",
    needEmail: "Wskaż kolumnę z adresem e-mail.",
    preview: "Podgląd (pierwsze 5)",
    cancel: "Anuluj",
    importN: (n: number) => `Importuj ${n}`,
    importing: (done: number, total: number) => `Importowanie ${done}/${total}…`,
    done: (s: CrmImportSummary) =>
      `Nowe: ${s.imported}, scalone: ${s.merged}, pominięte: ${s.skipped}`,
    errors: (n: number) => `Błędy: ${n} - szczegóły w konsoli`,
    oversizedTitle:
      "Niektóre wartości są dłuższe, niż pozwalają pola. Popraw plik i wgraj go ponownie - import niczego nie przycina.",
    oversized: ((issue, column) => {
      const where = `Wiersz ${issue.row}, kolumna „${column}”`;
      if (issue.kind === "count") {
        return `${where}: więcej niż ${issue.limit} ${plForm(issue.limit, "tag", "tagi", "tagów")}`;
      }
      const chars = plForm(issue.limit, "znak", "znaki", "znaków");
      return issue.field === "tags"
        ? `${where}: tag dłuższy niż ${issue.limit} ${chars}`
        : `${where}: wartość dłuższa niż ${issue.limit} ${chars}`;
    }) satisfies OversizedText,
    oversizedMore: (n: number) => `…i jeszcze ${n}`,
  },
  en: {
    open: "Import CSV",
    title: "Import leads from CSV",
    desc: "Upload a file, map the columns and confirm. E-mail duplicates are merged into existing leads, never duplicated.",
    pickTitle: "Upload a CSV file with leads",
    pick: "Drag a .csv file here, or pick one from your disk.\nUp to 5000 rows per file.",
    pickCta: "Choose a CSV file",
    rows: (total: number, valid: number, dupes: number) =>
      `${total} rows, ${valid} with a valid e-mail` +
      (dupes > 0 ? `, ${dupes} in-file duplicates` : ""),
    changeFile: "Change file",
    mapping: "Column mapping",
    needEmail: "Pick the column that holds the e-mail address.",
    preview: "Preview (first 5)",
    cancel: "Cancel",
    importN: (n: number) => `Import ${n}`,
    importing: (done: number, total: number) => `Importing ${done}/${total}…`,
    done: (s: CrmImportSummary) => `New: ${s.imported}, merged: ${s.merged}, skipped: ${s.skipped}`,
    errors: (n: number) => `Errors: ${n} - details in the console`,
    oversizedTitle:
      "Some values are longer than the fields allow. Fix the file and upload it again - the import never truncates data.",
    oversized: ((issue, column) => {
      const where = `Row ${issue.row}, column "${column}"`;
      if (issue.kind === "count") {
        return `${where}: more than ${issue.limit} ${issue.limit === 1 ? "tag" : "tags"}`;
      }
      const chars = issue.limit === 1 ? "character" : "characters";
      return issue.field === "tags"
        ? `${where}: a tag longer than ${issue.limit} ${chars}`
        : `${where}: a value longer than ${issue.limit} ${chars}`;
    }) satisfies OversizedText,
    oversizedMore: (n: number) => `…and ${n} more`,
  },
};

export function ImportLeadsCsvDialog({
  open,
  onOpenChange,
  lang,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lang: "pl" | "en";
}) {
  const t = TXT[lang];
  const fieldLabels = FIELD_LABELS[lang];
  const [file, setFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState("");
  const [mapping, setMapping] = useState<LeadImportMapping>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const qc = useQueryClient();
  const importFn = useServerFn(importCrmLeads);

  const parsed = useMemo(() => (csvText ? parseCsv(csvText) : null), [csvText]);
  const emailIdx = mapping.indexOf("email");
  const mapped = useMemo(
    () =>
      parsed && emailIdx >= 0
        ? mapImportRows(parsed.rows, mapping, parsed.rowNumbers)
        : {
            rows: [],
            oversized: [],
            inFileDuplicates: 0,
            skippedWithoutEmail: 0,
            droppedOverLimit: 0,
          },
    [parsed, mapping, emailIdx],
  );

  const onFile = async (f: File) => {
    setFile(f);
    const text = await f.text();
    setCsvText(text);
    setMapping(autoMapHeaders(parseCsv(text).header));
  };

  const reset = () => {
    setFile(null);
    setCsvText("");
    setMapping([]);
    setProgress(null);
  };

  const blocked = mapped.oversized.length > 0;

  const doImport = async () => {
    if (!parsed || emailIdx < 0 || mapped.rows.length === 0) {
      toast.error(t.needEmail);
      return;
    }
    if (blocked) return;
    setBusy(true);
    const total = mapped.rows.length;
    const summary: CrmImportSummary = { imported: 0, merged: 0, skipped: 0, errors: [] };
    try {
      // Porcjami: pojedyncze wywołanie RPC ma twardy limit wierszy (timeouty
      // po stronie bazy), klient skleja podsumowania.
      for (let offset = 0; offset < total; offset += CRM_IMPORT_CHUNK_SIZE) {
        setProgress({ done: offset, total });
        const chunk = mapped.rows.slice(offset, offset + CRM_IMPORT_CHUNK_SIZE);
        const res = await importFn({ data: { rows: chunk, source: "import" } });
        summary.imported += res.imported;
        summary.merged += res.merged;
        summary.skipped += res.skipped;
        summary.errors.push(...res.errors);
      }
      setProgress({ done: total, total });
      toast.success(t.done(summary));
      if (summary.errors.length > 0) {
        toast.warning(t.errors(summary.errors.length));
        console.warn("[crm import] errors", summary.errors);
      }
      void qc.invalidateQueries({ queryKey: crmKeys.leadsAll() });
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) {
          reset();
          onOpenChange(o);
        } else if (o) {
          onOpenChange(o);
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.desc}</DialogDescription>
        </DialogHeader>

        {!parsed ? (
          <UploadArea
            className="mx-auto"
            title={t.pickTitle}
            description={t.pick}
            ctaLabel={t.pickCta}
            icons={[FileSpreadsheet, Upload, FileText]}
            accept=".csv,text/csv"
            onFiles={(files) => onFile(files[0])}
          />
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <FileText className="w-4 h-4 text-muted-foreground" aria-hidden />
              <span className="font-medium">{file?.name}</span>
              <span className="text-muted-foreground">
                ({t.rows(parsed.rows.length, mapped.rows.length, mapped.inFileDuplicates)})
              </span>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={reset} disabled={busy}>
                {t.changeFile}
              </Button>
            </div>

            <div>
              <Label className="mb-2 block">{t.mapping}</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                {parsed.header.map((h, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr] gap-2 items-center">
                    <div
                      className="text-xs font-mono px-2 py-1 rounded bg-muted truncate"
                      title={h}
                    >
                      {h || `col_${i + 1}`}
                    </div>
                    <Select
                      value={mapping[i] ? mapping[i] : SKIP_VALUE}
                      onValueChange={(v) => {
                        const next = [...mapping];
                        next[i] = v === SKIP_VALUE ? "" : (v as FieldKey);
                        setMapping(next);
                      }}
                    >
                      <SelectTrigger className="h-8" aria-label={`${t.mapping}: ${h || i + 1}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LEAD_IMPORT_FIELD_CHOICES.map((k) => (
                          <SelectItem key={k || SKIP_VALUE} value={k || SKIP_VALUE}>
                            {fieldLabels[k]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>

            {emailIdx < 0 && <p className="text-xs text-destructive">{t.needEmail}</p>}

            {blocked && (
              <div
                role="alert"
                data-import-oversized
                className="rounded-lg border border-destructive/40 p-3 text-xs text-destructive space-y-1"
              >
                <p className="font-medium">{t.oversizedTitle}</p>
                <ul className="space-y-0.5">
                  {mapped.oversized.slice(0, OVERSIZED_LISTED).map((issue) => (
                    <li key={`${issue.row}:${issue.column}:${issue.kind}`}>
                      {t.oversized(issue, parsed.header[issue.column] || `col_${issue.column + 1}`)}
                    </li>
                  ))}
                </ul>
                {mapped.oversized.length > OVERSIZED_LISTED && (
                  <p>{t.oversizedMore(mapped.oversized.length - OVERSIZED_LISTED)}</p>
                )}
              </div>
            )}

            <div className="rounded-lg border border-border overflow-hidden">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40 px-3 py-1.5 border-b border-border">
                {t.preview}
              </div>
              <div className="p-3 space-y-1 text-xs font-mono">
                {mapped.rows.slice(0, 5).map((r) => (
                  <div key={r.email} className="truncate">
                    {r.email}
                    {r.company ? ` · ${r.company}` : ""}
                  </div>
                ))}
                {mapped.rows.length === 0 && <div className="text-muted-foreground">-</div>}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t.cancel}
          </Button>
          <Button
            onClick={doImport}
            disabled={busy || !parsed || emailIdx < 0 || mapped.rows.length === 0 || blocked}
          >
            {busy && progress
              ? t.importing(Math.min(progress.done, progress.total), progress.total)
              : t.importN(mapped.rows.length)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
