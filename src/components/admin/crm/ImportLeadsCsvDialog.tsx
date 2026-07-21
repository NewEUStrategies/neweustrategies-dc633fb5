// Import leadów CRM z pliku CSV (dedup po e-mailu).
//
// Krok 1: upload pliku -> wspólny parser @/lib/csv/parseCsv
// Krok 2: mapowanie kolumn (auto-detekcja PL/EN naglowkow)
// Krok 3: podgląd + import porcjami (CRM_IMPORT_CHUNK_SIZE per wywołanie RPC
//         crm_import_leads - dedup/merge liczy baza przez crm_upsert_from_form).
//
// Duplikaty WEWNĄTRZ pliku odpadają po stronie klienta (pierwszy wiersz
// wygrywa), duplikaty względem bazy są scalane (merge), nie duplikowane.
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileText, Upload } from "lucide-react";
import { parseCsv } from "@/lib/csv/parseCsv";
import {
  CRM_IMPORT_CHUNK_SIZE,
  importCrmLeads,
  type CrmImportRow,
  type CrmImportSummary,
} from "@/lib/crm-tasks.functions";

type FieldKey =
  | "email"
  | "first_name"
  | "last_name"
  | "phone"
  | "company"
  | "position"
  | "country"
  | "linkedin_url"
  | "tags"
  | "";

const FIELD_ORDER: FieldKey[] = [
  "email",
  "first_name",
  "last_name",
  "phone",
  "company",
  "position",
  "country",
  "linkedin_url",
  "tags",
  "",
];

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

const TXT = {
  pl: {
    open: "Import CSV",
    title: "Import leadów z CSV",
    desc: "Wgraj plik, zmapuj kolumny i zatwierdź. Duplikaty po e-mailu są scalane z istniejącymi leadami (merge), nie duplikowane.",
    pick: "Kliknij, aby wybrać plik .csv (do 5000 wierszy)",
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
  },
  en: {
    open: "Import CSV",
    title: "Import leads from CSV",
    desc: "Upload a file, map the columns and confirm. E-mail duplicates are merged into existing leads, never duplicated.",
    pick: "Click to choose a .csv file (up to 5000 rows)",
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
  },
};

function autoMap(header: string[]): FieldKey[] {
  return header.map((h): FieldKey => {
    const n = h.trim().toLowerCase();
    if (/^(e[-_ ]?mail|mail|adres)/.test(n)) return "email";
    if (/(first|imi)/.test(n)) return "first_name";
    if (/(last|nazwisko|surname)/.test(n)) return "last_name";
    if (/(phone|tel)/.test(n)) return "phone";
    if (/(company|firma|organi)/.test(n)) return "company";
    if (/(position|stanowisko|title|rola|role)/.test(n)) return "position";
    if (/(country|kraj)/.test(n)) return "country";
    if (/linked/.test(n)) return "linkedin_url";
    if (/(tags?|tagi|etykiet)/.test(n)) return "tags";
    return "";
  });
}

const MAX_ROWS = 5000;

interface MappedRows {
  rows: CrmImportRow[];
  inFileDuplicates: number;
}

function mapRows(rows: string[][], mapping: FieldKey[]): MappedRows {
  const emailIdx = mapping.indexOf("email");
  const seen = new Set<string>();
  const out: CrmImportRow[] = [];
  let dupes = 0;
  for (const r of rows) {
    const email = (r[emailIdx] ?? "").trim();
    if (!/.+@.+\..+/.test(email)) continue;
    const norm = email.toLowerCase();
    if (seen.has(norm)) {
      dupes++;
      continue;
    }
    seen.add(norm);
    const row: CrmImportRow = { email };
    mapping.forEach((key, i) => {
      const value = (r[i] ?? "").trim();
      if (!key || key === "email" || !value) return;
      if (key === "tags") {
        const tags = value
          .split(/[|;,]/)
          .map((t) => t.trim())
          .filter((t) => t.length > 0)
          .slice(0, 20);
        if (tags.length > 0) row.tags = tags;
        return;
      }
      row[key] = value.slice(0, 300);
    });
    out.push(row);
    if (out.length >= MAX_ROWS) break;
  }
  return { rows: out, inFileDuplicates: dupes };
}

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
  const [mapping, setMapping] = useState<FieldKey[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const qc = useQueryClient();
  const importFn = useServerFn(importCrmLeads);

  const parsed = useMemo(() => (csvText ? parseCsv(csvText) : null), [csvText]);
  const emailIdx = mapping.indexOf("email");
  const mapped = useMemo(
    () =>
      parsed && emailIdx >= 0 ? mapRows(parsed.rows, mapping) : { rows: [], inFileDuplicates: 0 },
    [parsed, mapping, emailIdx],
  );

  const onFile = async (f: File) => {
    setFile(f);
    const text = await f.text();
    setCsvText(text);
    setMapping(autoMap(parseCsv(text).header));
  };

  const reset = () => {
    setFile(null);
    setCsvText("");
    setMapping([]);
    setProgress(null);
  };

  const doImport = async () => {
    if (!parsed || emailIdx < 0 || mapped.rows.length === 0) {
      toast.error(t.needEmail);
      return;
    }
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
      void qc.invalidateQueries({ queryKey: ["crm-leads"] });
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
          <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-border rounded-xl p-10 cursor-pointer hover:border-primary/50 transition-colors">
            <Upload className="w-8 h-8 text-muted-foreground" aria-hidden />
            <span className="text-sm text-muted-foreground">{t.pick}</span>
            <Input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
          </label>
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
                      value={mapping[i] ?? ""}
                      onValueChange={(v) => {
                        const next = [...mapping];
                        next[i] = v as FieldKey;
                        setMapping(next);
                      }}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FIELD_ORDER.map((k) => (
                          <SelectItem key={k || "skip"} value={k}>
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
            disabled={busy || !parsed || emailIdx < 0 || mapped.rows.length === 0}
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
