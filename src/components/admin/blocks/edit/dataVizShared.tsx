// WSPÓLNE KLOCKI EDYTORÓW WIZUALIZACJI DANYCH ("chart" i "data-map").
//
// PO CO OSOBNY PLIK. Do PR2 oba edytory żyły w jednym `DataVizBlocks.tsx`
// (ponad 1400 linii), a pomocniki formy - powłoka, grupy pól, pole liczby
// z własnym szkicem, odczyt napisu i liczby z treści - były w nim prywatne.
// Mapa danych dostaje teraz te same odniesienia, co wykres (źródła w stylu
// chicagowskim, pochodzenie liczb, podpis, data danych, `n`, trzy zdania),
// więc kopia w drugim pliku rozjechałaby się przy pierwszej poprawce.
//
// KONTRAKT ZAPISU. Edytory odniesień pracują na GOŁEJ treści bloku (`data`)
// i funkcji `write`, która przyjmuje zmiany w JEDNYM wywołaniu i USUWA klucz
// dla `undefined` - dokładnie jak `write` w edytorze wykresu. Dzięki temu
// usunięcie źródła i zdjęcie wskazania pasma idą jednym zapisem, a nie dwoma
// `onChange` z tego samego renderu, z których drugi nadpisałby pierwszy.
//
// Plik nie deklaruje `Props` ani nie jest edytorem bloku: dyspozytor
// (`BlockEditRenderer.tsx`) go nie woła, a bramka `blockEditContracts`
// liczy go jako jedyny poza `PageBreak.tsx` plik katalogu bez propsów bloku.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, TriangleAlert } from "lucide-react";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import "@/lib/i18n-charts-editor";
import type { Json } from "@/lib/blocks/types";
import {
  isProvenance,
  isReliability,
  MAX_CHART_SOURCES,
  PROVENANCES,
  RELIABILITIES,
  type Provenance,
  type Reliability,
} from "@/lib/charts/sources";
import { AdminSelect } from "../AdminSelect";

// ===== Powłoka i klasy pól =====

export function Shell({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-2 bg-muted/20">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

export const inputCls = "w-full text-xs bg-background border border-border rounded px-2 py-2 h-9";
export const areaCls =
  "w-full text-xs bg-background border border-border rounded px-2 py-2 min-h-[60px] resize-y";
export const cellCls =
  "w-full min-w-[72px] text-xs bg-background border border-border rounded px-2 py-1.5 h-8 tabular-nums";

/** Sekcja formy z podpisem - grupuje pola, których autor inaczej nie znajdzie. */
export function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 rounded-md border border-border/60 p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

/**
 * Ostrzeżenie dyscypliny. NIE BLOKUJE zapisu - mówi, co się psuje, i zostawia
 * decyzję autorowi. Blokada byłaby tu gorsza: reguły doboru formy mają
 * wyjątki, których kod nie zna, a zablokowany autor obchodzi walidację
 * zamiast czytać powód.
 */
export function Warning({ text }: { text: string }) {
  return (
    <p
      className="flex items-start gap-1.5 text-[11px] leading-snug"
      style={{ color: "var(--chart-negative-text)" }}
    >
      <TriangleAlert className="mt-px h-3 w-3 shrink-0" aria-hidden />
      <span>{text}</span>
    </p>
  );
}

// ===== Odczyt treści =====

export function asRecord(raw: Json | undefined): Record<string, Json> {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

/**
 * Napis z treści do pola formy. Liczba wraca jako tekst, a obiekt i tablica
 * jako PUSTKA - `String()` wpisałby redaktorowi w pole „[object Object]",
 * które pierwsza edycja utrwaliłaby w dokumencie.
 */
export function readText(raw: Json | undefined): string {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return "";
}

/** Liczba z pola tekstowego: przecinek dziesiętny dozwolony, pustka i śmieć = brak. */
export function parseDecimal(raw: string): number | null {
  const text = raw.trim().replace(",", ".");
  if (text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** Ta sama koercja co `num` w `parseChartConfig` - pole pokazuje to, co narysuje wykres. */
export function readDecimal(raw: Json | undefined): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") return parseDecimal(raw);
  return null;
}

/**
 * Pole liczby z WŁASNYM SZKICEM tekstu. Zapis idzie liczbą (kontrakt
 * `parseChartConfig`: `{ value: number }`, krawędzie pasma), ale pole
 * sterowane samą liczbą zjadałoby znaki w trakcie pisania: po „2," pokazałoby
 * z powrotem „2" i ułamka nie dałoby się wpisać. Wpis niebędący liczbą
 * zapisuje BRAK, bo tyle właśnie narysuje wykres - podgląd nad formą nie może
 * pokazywać starej liczby pod polem, w którym stoi co innego.
 *
 * Szkic ustępuje wartości z treści tylko wtedy, gdy ta zmieniła się z zewnątrz
 * (cofnięcie, wklejenie bloku) i mówi już co innego niż szkic - wzorzec
 * „poprzednia wartość w stanie", bez efektu i bez podwójnego renderu.
 */
export function DecimalInput({
  value,
  placeholder,
  onCommit,
}: {
  value: number | null;
  placeholder: string;
  onCommit: (next: number | null) => void;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (parseDecimal(draft) !== value) setDraft(value === null ? "" : String(value));
  }
  return (
    <input
      className={inputCls}
      inputMode="decimal"
      value={draft}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(e) => {
        setDraft(e.target.value);
        onCommit(parseDecimal(e.target.value));
      }}
    />
  );
}

// ===== Edytory odniesień: wspólny kontrakt =====

/**
 * Zapis z USUWANIEM: `undefined` znaczy „usuń klucz z treści", a nie
 * „zapisz undefined". Jedno wywołanie = jeden `onChange` bloku.
 */
export type DataWrite = (changes: Record<string, Json | undefined>) => void;

/** Treść bloku i jej zapis - wszystko, czego potrzebuje edytor odniesień. */
export interface DataFieldsProps {
  data: Record<string, Json>;
  write: DataWrite;
}

// ETYKIETY OPCJI SYSTEMU WYKRESÓW - klucze słownika JAWNIE, nie sklejane
// z wartości. `Record` po unii jest wyczerpujący: nowa litera pochodzenia
// albo stopień wiarygodności dopisane w `src/lib/charts` bez etykiety tutaj
// NIE SKOMPILUJĄ SIĘ, zamiast wyjść w liście wyboru jako surowy klucz.
const PROVENANCE_LABEL_KEYS: Record<Provenance, string> = {
  D: "provenances.D",
  W: "provenances.W",
  B: "provenances.B",
  E: "provenances.E",
  "?": "provenances.unknown",
};

const RELIABILITY_LABEL_KEYS: Record<Reliability, string> = {
  A: "reliabilities.A",
  B: "reliabilities.B",
  C: "reliabilities.C",
};

// ===== Pochodzenie liczb =====

/**
 * Litera pochodzenia liczb (D/W/B/E/?) albo BRAK klucza. Wartość spoza
 * dziedziny (stara wersja edytora, ręczna edycja JSON-a) pokazuje się jako
 * „brak", bo tyle narysuje parser.
 */
export function ProvenanceSelect({ data, write }: DataFieldsProps) {
  const bt = useBlocksI18n();
  const provenance = isProvenance(data.provenance) ? data.provenance : "";
  return (
    <AdminSelect
      className={inputCls}
      value={provenance}
      onChange={(e) => write({ provenance: e.target.value || undefined })}
      aria-label={bt.editor("chart", "provenance")}
    >
      <option value="">{bt.editor("chart", "provenances.none")}</option>
      {PROVENANCES.map((p) => (
        <option key={p} value={p}>
          {bt.editor("chart", PROVENANCE_LABEL_KEYS[p])}
        </option>
      ))}
    </AdminSelect>
  );
}

// ===== Podpis, dane demonstracyjne, data danych, n, trzy zdania =====

/** Flaga danych demonstracyjnych - silnik dokłada odznakę „demo". */
export function DemoCheckbox({ data, write }: DataFieldsProps) {
  const bt = useBlocksI18n();
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <input
        type="checkbox"
        checked={data.demo === true}
        onChange={(e) => write({ demo: e.target.checked })}
      />
      {bt.editor("chart", "demo")}
    </label>
  );
}

/**
 * Podpis pod rysunkiem. `label` nadpisuje napis domyślny („Podpis pod
 * wykresem") - edytor mapy podaje własne, przetłumaczone zdanie.
 */
export function CaptionField({ data, write, label }: DataFieldsProps & { label?: string }) {
  const bt = useBlocksI18n();
  const text = label ?? bt.editor("chart", "caption");
  return (
    <textarea
      className={areaCls}
      rows={2}
      value={readText(data.caption)}
      placeholder={text}
      aria-label={text}
      onChange={(e) => write({ caption: e.target.value })}
    />
  );
}

/** Data danych i liczebność próby w jednym wierszu. */
export function SourceDateSampleFields({ data, write }: DataFieldsProps) {
  const bt = useBlocksI18n();
  return (
    <div className="grid grid-cols-2 gap-2">
      <input
        className={inputCls}
        value={String(data.sourceDate ?? "")}
        placeholder={bt.editor("chart", "sourceDate")}
        onChange={(e) => write({ sourceDate: e.target.value })}
      />
      <input
        className={inputCls}
        inputMode="numeric"
        value={data.sampleSize == null ? "" : String(data.sampleSize)}
        placeholder={bt.editor("chart", "sampleSize")}
        onChange={(e) => {
          const raw = e.target.value.trim();
          write({ sampleSize: raw === "" ? null : Number(raw) });
        }}
      />
    </div>
  );
}

/**
 * Trzy zdania podpisu: co pokazuje, co zaskakuje, czego NIE pokazuje.
 * Brak trzeciego dostaje ostrzeżenie; `missingNotesText` nadpisuje jego
 * treść (domyślna mówi o wykresie).
 */
export function NotesFields({
  data,
  write,
  missingNotesText,
}: DataFieldsProps & { missingNotesText?: string }) {
  const bt = useBlocksI18n();
  const { t: ct } = useTranslation("translation", { keyPrefix: "charts" });
  return (
    <>
      <input
        className={inputCls}
        value={String(data.notesShows ?? "")}
        placeholder={bt.editor("chart", "notesShows")}
        onChange={(e) => write({ notesShows: e.target.value })}
      />
      <input
        className={inputCls}
        value={String(data.notesSurprising ?? "")}
        placeholder={bt.editor("chart", "notesSurprising")}
        onChange={(e) => write({ notesSurprising: e.target.value })}
      />
      <input
        className={inputCls}
        value={String(data.notesHidden ?? "")}
        placeholder={bt.editor("chart", "notesHidden")}
        onChange={(e) => write({ notesHidden: e.target.value })}
      />
      {!String(data.notesHidden ?? "").trim() && (
        <Warning text={missingNotesText ?? ct("editor.missingNotes")} />
      )}
    </>
  );
}

/**
 * Komplet pól podpisu w jednym miejscu: flaga demo, podpis, data danych, `n`
 * i trzy zdania. Edytor wykresu rozkłada te same klocki po dwóch grupach
 * (uczciwość i odniesienia), więc woła je osobno; ten zestaw jest dla
 * edytorów, które trzymają je razem.
 */
export function CaptionMetaFields({
  data,
  write,
  captionLabel,
  missingNotesText,
}: DataFieldsProps & { captionLabel?: string; missingNotesText?: string }) {
  return (
    <>
      <DemoCheckbox data={data} write={write} />
      <CaptionField data={data} write={write} label={captionLabel} />
      <SourceDateSampleFields data={data} write={write} />
      <NotesFields data={data} write={write} missingNotesText={missingNotesText} />
    </>
  );
}

// ===== Źródła (przypisy w stylu chicagowskim) =====

/** Pola tekstowe źródła w kolejności opisu bibliograficznego (Chicago). */
export const SOURCE_TEXT_FIELDS = [
  "author",
  "title",
  "container",
  "publisher",
  "published",
  "accessed",
  "url",
] as const;
export type SourceTextField = (typeof SOURCE_TEXT_FIELDS)[number];

const SOURCE_FIELD_LABEL_KEYS: Record<SourceTextField, string> = {
  author: "sourceAuthor",
  title: "sourceTitle",
  container: "sourceContainer",
  publisher: "sourcePublisher",
  published: "sourcePublished",
  accessed: "sourceAccessed",
  url: "sourceUrl",
};

export type SourceDraft = Record<SourceTextField, string> & {
  id: string;
  reliability: Reliability | "";
};

/**
 * Wiersze źródeł TAKIE, JAKIE SĄ w treści - także szkice bez tytułu i adresu,
 * które parser wykresu pomija. Autor musi widzieć wiersz, który właśnie
 * dodał, zanim wpisze w nim cokolwiek.
 */
export function readSources(raw: Json | undefined): SourceDraft[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_CHART_SOURCES).map((item) => {
    const o = asRecord(item);
    return {
      id: readText(o.id).trim(),
      author: readText(o.author),
      title: readText(o.title),
      container: readText(o.container),
      publisher: readText(o.publisher),
      published: readText(o.published),
      accessed: readText(o.accessed),
      url: readText(o.url),
      reliability: isReliability(o.reliability) ? o.reliability : "",
    };
  });
}

export function sourcesToJson(sources: SourceDraft[]): Json[] {
  return sources.map((s) => ({
    id: s.id,
    author: s.author,
    title: s.title,
    container: s.container,
    publisher: s.publisher,
    published: s.published,
    accessed: s.accessed,
    url: s.url,
    reliability: s.reliability === "" ? null : s.reliability,
  }));
}

/**
 * Identyfikator nowego źródła - JAWNY i stały. Bez niego parser nadaje
 * identyfikator pozycją, a ta zmienia się po usunięciu wiersza wyżej: pasmo
 * wskazywałoby wtedy cicho inne źródło niż to, które autor wybrał.
 */
export function nextSourceId(sources: readonly SourceDraft[]): string {
  const used = new Set(sources.map((s) => s.id));
  let n = sources.length + 1;
  while (used.has(`s${n}`)) n += 1;
  return `s${n}`;
}

/**
 * Lista źródeł z dodawaniem i usuwaniem. Renderuje sam fragment (nagłówek,
 * podpowiedź, wiersze, przycisk) - grupę pól daje wołający.
 *
 * `removeExtra` dokłada zmiany do TEGO SAMEGO zapisu, który usuwa źródło:
 * edytor wykresu zdejmuje w nim wskazanie pasma optimum na usuwane źródło,
 * żeby pasmo nie zostało z identyfikatorem prowadzącym donikąd. `hint`
 * nadpisuje podpowiedź domyślną (ta mówi o paśmie optimum).
 */
export function SourcesEditor({
  data,
  write,
  removeExtra,
  hint,
}: DataFieldsProps & {
  removeExtra?: (removed: SourceDraft) => Record<string, Json | undefined>;
  hint?: string;
}) {
  const bt = useBlocksI18n();
  const sources = readSources(data.sources);
  const setSources = (next: SourceDraft[], extra: Record<string, Json | undefined> = {}) =>
    write({ sources: next.length > 0 ? sourcesToJson(next) : undefined, ...extra });

  return (
    <>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground pt-1">
        {bt.editor("chart", "sourcesLabel")}
      </div>
      <p className="text-[10px] text-muted-foreground">
        {hint ?? bt.editor("chart", "sourcesHint")}
      </p>
      {sources.map((s, si) => (
        <div key={si} className="space-y-1.5 rounded border border-border/60 p-2">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {bt.editor("chart", "sourceN", { n: si + 1 })}
            </span>
            <button
              type="button"
              className="text-muted-foreground hover:text-destructive"
              aria-label={bt.editor("chart", "removeSource", {
                name: s.title || s.author || si + 1,
              })}
              onClick={() =>
                setSources(
                  sources.filter((_, i) => i !== si),
                  removeExtra ? removeExtra(s) : {},
                )
              }
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {SOURCE_TEXT_FIELDS.map((field) => (
              <input
                key={field}
                className={inputCls}
                inputMode={field === "url" ? "url" : undefined}
                value={s[field]}
                placeholder={bt.editor("chart", SOURCE_FIELD_LABEL_KEYS[field])}
                aria-label={bt.editor("chart", SOURCE_FIELD_LABEL_KEYS[field])}
                onChange={(e) =>
                  setSources(
                    sources.map((x, i) => (i === si ? { ...x, [field]: e.target.value } : x)),
                  )
                }
              />
            ))}
            <AdminSelect
              className={inputCls}
              value={s.reliability}
              onChange={(e) => {
                const next = e.target.value;
                setSources(
                  sources.map((x, i) =>
                    i === si ? { ...x, reliability: isReliability(next) ? next : "" } : x,
                  ),
                );
              }}
              aria-label={bt.editor("chart", "sourceReliability")}
            >
              <option value="">{bt.editor("chart", "reliabilities.none")}</option>
              {RELIABILITIES.map((r) => (
                <option key={r} value={r}>
                  {bt.editor("chart", RELIABILITY_LABEL_KEYS[r])}
                </option>
              ))}
            </AdminSelect>
          </div>
        </div>
      ))}
      {sources.length < MAX_CHART_SOURCES && (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-border hover:border-foreground/50"
          onClick={() =>
            setSources([
              ...sources,
              {
                id: nextSourceId(sources),
                author: "",
                title: "",
                container: "",
                publisher: "",
                published: "",
                accessed: "",
                url: "",
                reliability: "",
              },
            ])
          }
        >
          <Plus className="w-3.5 h-3.5" /> {bt.editor("chart", "addSource")}
        </button>
      )}
    </>
  );
}
