// Dialog importu subskrybentow z pliku CSV.
//
// Krok 1: upload pliku
// Krok 2: mapowanie kolumn (auto-detekcja + rozwijalne pola)
// Krok 3: podglad + zatwierdzenie -> server fn importNewsletterSubscribers
//
// Parser CSV jest wspolny z importem leadow CRM: @/lib/csv/parseCsv.
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
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
import { Upload, FileText } from "lucide-react";
import { importNewsletterSubscribers } from "@/lib/newsletter-admin.functions";
import { parseCsv } from "@/lib/csv/parseCsv";

type FieldKey =
  | "email"
  | "firstName"
  | "lastName"
  | "displayName"
  | "language"
  | "status"
  | "company"
  | "source"
  | "";

const FIELD_LABELS: Record<FieldKey, string> = {
  email: "E-mail (wymagane)",
  firstName: "Imie",
  lastName: "Nazwisko",
  displayName: "Pelna nazwa",
  language: "Jezyk (pl/en)",
  status: "Status",
  company: "Firma",
  source: "Zrodlo",
  "": "-- pomin --",
};

function autoMap(header: string[]): FieldKey[] {
  return header.map((h): FieldKey => {
    const n = h.trim().toLowerCase();
    if (/^(e[-_ ]?mail|mail|adres)/.test(n)) return "email";
    if (/(first|imi)/.test(n)) return "firstName";
    if (/(last|nazwisko|surname)/.test(n)) return "lastName";
    if (/(name|nazwa)/.test(n)) return "displayName";
    if (/(lang|jezyk|language)/.test(n)) return "language";
    if (/status/.test(n)) return "status";
    if (/(company|firma)/.test(n)) return "company";
    if (/(source|zrod)/.test(n)) return "source";
    return "";
  });
}

export function ImportCsvDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState("");
  const [mapping, setMapping] = useState<FieldKey[]>([]);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const importFn = useServerFn(importNewsletterSubscribers);

  const parsed = useMemo(() => (csvText ? parseCsv(csvText) : null), [csvText]);
  const emailIdx = mapping.indexOf("email");
  const validRows =
    parsed?.rows.filter((r) => emailIdx >= 0 && /.+@.+\..+/.test(r[emailIdx] ?? "")) ?? [];

  const onFile = async (f: File) => {
    setFile(f);
    const t = await f.text();
    setCsvText(t);
    const p = parseCsv(t);
    setMapping(autoMap(p.header));
  };

  const reset = () => {
    setFile(null);
    setCsvText("");
    setMapping([]);
  };

  const doImport = async () => {
    if (!parsed || emailIdx < 0) {
      toast.error("Zmapuj kolumne e-mail.");
      return;
    }
    const rows = validRows.map((r) => {
      const row: Record<string, string> = {};
      mapping.forEach((k, i) => {
        if (k && r[i]) row[k] = r[i]!.trim();
      });
      return {
        email: row.email!,
        firstName: row.firstName || undefined,
        lastName: row.lastName || undefined,
        displayName: row.displayName || undefined,
        language: (row.language === "en" ? "en" : "pl") as "pl" | "en",
        status: (row.status === "pending" || row.status === "unsubscribed"
          ? row.status
          : "subscribed") as "subscribed" | "pending" | "unsubscribed",
        source: row.source || undefined,
        company: row.company || undefined,
      };
    });

    setBusy(true);
    try {
      const res = await importFn({ data: { rows, markSource: "csv-import" } });
      toast.success(`Zaimportowano ${res.imported}, pominieto ${res.skipped}`);
      if (res.errors.length) {
        toast.warning(`Bledy: ${res.errors.length} - sprawdz konsole`);
        console.warn("[nl import] errors", res.errors);
      }
      qc.invalidateQueries({ queryKey: ["newsletter-subscribers"] });
      qc.invalidateQueries({ queryKey: ["newsletter-kpis"] });
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
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import subskrybentow z CSV</DialogTitle>
          <DialogDescription>
            Wgraj plik CSV, zmapuj kolumny i zatwierdz. Duplikaty (po e-mail) sa pomijane.
          </DialogDescription>
        </DialogHeader>

        {!parsed ? (
          <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-border rounded-xl p-10 cursor-pointer hover:border-primary/50 transition-colors">
            <Upload className="w-8 h-8 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              Kliknij aby wybrac plik .csv (do 5000 wierszy)
            </span>
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
              <FileText className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium">{file?.name}</span>
              <span className="text-muted-foreground">
                ({parsed.rows.length} wierszy, {validRows.length} z poprawnym e-mailem)
              </span>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={reset}>
                Zmien plik
              </Button>
            </div>

            <div>
              <Label className="mb-2 block">Mapowanie kolumn</Label>
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
                        {(Object.keys(FIELD_LABELS) as FieldKey[]).map((k) => (
                          <SelectItem key={k || "skip"} value={k}>
                            {FIELD_LABELS[k]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>

            {emailIdx < 0 && (
              <p className="text-xs text-destructive">
                Wybierz kolumne z adresem e-mail przynajmniej dla jednej kolumny.
              </p>
            )}

            <div className="rounded-lg border border-border overflow-hidden">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40 px-3 py-1.5 border-b border-border">
                Podglad (pierwsze 5)
              </div>
              <div className="p-3 space-y-1 text-xs font-mono">
                {validRows.slice(0, 5).map((r, i) => (
                  <div key={i} className="truncate">
                    {r[emailIdx]}
                  </div>
                ))}
                {validRows.length === 0 && <div className="text-muted-foreground">-</div>}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Anuluj
          </Button>
          <Button
            onClick={doImport}
            disabled={busy || !parsed || emailIdx < 0 || validRows.length === 0}
          >
            {busy ? "Importowanie..." : `Importuj ${validRows.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
