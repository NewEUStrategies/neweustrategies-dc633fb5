// ARKUSZ DANYCH MAPY - jedna siatka dla bloku CMS i arkusza widgetu buildera.
//
// Do PR2 mapa miała dwie różne formy danych: blok - listę wyboru z setką
// krajów i pole liczby parsowane na każdym naciśnięciu klawisza („1," wracało
// jako „1", „-" kasowało komórkę), widget - surową textareę „ISO2; wartość",
// która gubiła literówki bez słowa. Ta siatka składa wspólne klocki edytora
// wykresu (`NumberCell`, klawiatura `gridKeyboard`, `GridMenu`,
// `PastePreviewDialog`, `ImportProblemList`) nad listą wierszy
// `MapGridRow` i oddaje KAŻDĄ zmianę jednym `onChange` - jedno działanie
// autora to jeden krok cofania w historii bloku albo buildera.
//
// WIERSZ = KRAJ. Komórka kodu przyjmuje kod ISO-2 ALBO nazwę (polską,
// angielską, alias: „Czechy", „Czech Republic", „UK") i przy zatwierdzeniu
// zamienia ją na kod - tymi samymi regułami co import pliku. Obok stoi nazwa
// kraju w JĘZYKU DOKUMENTU (z zasobu geometrii regionu), a w ostatniej
// kolumnie uwaga: nieznany kod, kraj powtórzony, kraj spoza regionu, brak
// wartości. Uwaga ma tekst i ikonę (nigdy sam kolor), komórka kodu wskazuje
// ją przez `aria-describedby`, a zatwierdzenie wiersza z uwagą ogłasza ją
// czytnikowi ekranu.
//
// PUSTA WARTOŚĆ TO BRAK DANYCH: kraj bez liczby mapa kreskuje. Wpis, który
// liczbą nie jest, NIE zamienia się w lukę - `NumberCell` zostawia go
// z `aria-invalid` i zdaniem, a treść trzyma poprzednią liczbę.
//
// WKLEJENIE (kontrakt PR2, „DataGrid behaviour" 3): zakres w środku siatki
// trafia od komórki kotwicy jednym zapisem (`applyMapPasteAt`), a problemy
// stoją pod siatką. Cała tabela wklejona w PUSTĄ siatkę albo w jej pierwszą
// komórkę (gdy rozpoznanie widzi nagłówek) otwiera podgląd z przełącznikami
// układu - nagłówek, obrót, format liczb, kolumna krajów i wartości.
//
// SIATKA BEZ WIERSZY pokazuje jeden wiersz-zachętę: świeży blok musi mieć
// komórkę, w którą da się wpisać kraj albo wkleić tabelę. Wiersz-zachęta
// trafia do treści dopiero z pierwszym wpisem.
import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import { AlertTriangle, Info, Plus } from "lucide-react";
import "@/lib/i18n-map-editor";
import {
  clipboardPayloadOf,
  readClipboardTable,
  type ClipboardTable,
} from "@/lib/charts/clipboardTable";
import {
  applyMapPasteAt,
  MAP_GRID_MAX_ROWS,
  type GridAnchor,
  type MapGridRow,
} from "@/lib/charts/gridModel";
import { analyseTable, type ImportProblem } from "@/lib/charts/importTable";
import { cn } from "@/lib/utils";
import { NumberCell } from "./GridCells";
import { GridMenu, type GridMenuItem } from "./GridMenu";
import { ImportProblemList } from "./ImportProblemList";
import { PastePreviewDialog } from "./PastePreviewDialog";
import type { TableLayout, TablePreviewSource } from "./tableLayout";
import { gridCellCls } from "./gridCellValue";
import {
  CHART_GRID_ATTR,
  GRID_FLUSH_EVENT,
  focusNearestGridCell,
  gridCellAttrs,
  handleGridKey,
  isMenuKey,
  type GridFlushDetail,
} from "./gridKeyboard";
import { useChartEditorT, type EditorLang } from "./chartEditorI18n";
import { mapTableValues } from "./mapTableLayout";
import {
  countryNameOf,
  EMPTY_MAP_ROW,
  mapCountryLookup,
  mapGridIsBlank,
  mapInsertRow,
  mapMoveRow,
  mapRemoveRow,
  mapRowsSignature,
  mapRowStatuses,
  mapSetCell,
  resolveCountryEntry,
  type MapCountry,
  type MapRowStatus,
  type MapRowStatusKind,
} from "./mapGridState";

/** Sterowanie siatką z zewnątrz - wklejenie na kanwie i import pliku otwierają ten sam podgląd. */
export interface MapDataGridHandle {
  openTablePreview: (
    rows: readonly (readonly string[])[],
    readProblems: readonly ImportProblem[],
    source: TablePreviewSource,
  ) => void;
}

interface Props {
  rows: readonly MapGridRow[];
  onChange: (next: readonly MapGridRow[]) => void;
  /**
   * Kraje zasobu geometrii WYBRANEGO REGIONU (nazwy PL/EN i skorowidz);
   * `undefined`, dopóki zasób się wczytuje - nazwy idą wtedy z `Intl`,
   * a uwaga „poza regionem" milczy.
   */
  countries: readonly MapCountry[] | undefined;
  /** Język DOKUMENTU: nazwy krajów i zapis liczb w komórkach. */
  docLang: "pl" | "en";
  /** Język napisów siatki; brak = język panelu. */
  lang?: EditorLang;
  /**
   * Opróżnienie odłożonego zapisu tuż przed cofnięciem (`GRID_FLUSH_EVENT`);
   * `true` = zapis naprawdę poszedł. Siatka mapy zapisuje każdą zmianę od
   * razu, więc wołający zwykle nie ma czego opróżniać.
   */
  onFlush?: () => boolean | void;
  className?: string;
}

/** Uwagi, które coś mówią - „ok" i wiersz pusty milczą. */
type UwagaKind = Exclude<MapRowStatusKind, "ok" | "empty">;

const STATUS_KEYS: Record<UwagaKind, string> = {
  unknown: "mapEditor.status.unknown",
  duplicate: "mapEditor.status.duplicate",
  outside: "mapEditor.status.outside",
  noValue: "mapEditor.status.noValue",
  noCountry: "mapEditor.status.noCountry",
};

/**
 * Waga uwagi: „warn" - wiersz NIE trafi na rysunek tak, jak autor go wpisał;
 * „info" - trafi, tylko inaczej niż kraj z liczbą (kreskowanie, nota pod mapą).
 */
const STATUS_WEIGHT: Record<UwagaKind, "warn" | "info"> = {
  unknown: "warn",
  duplicate: "warn",
  noCountry: "warn",
  outside: "info",
  noValue: "info",
};

const MENU_KEYS = {
  insertAbove: "mapEditor.menu.insertAbove",
  insertBelow: "mapEditor.menu.insertBelow",
  moveUp: "mapEditor.menu.moveUp",
  moveDown: "mapEditor.menu.moveDown",
  remove: "mapEditor.menu.remove",
} as const;

interface Podglad {
  rows: readonly (readonly string[])[];
  problems: readonly ImportProblem[];
  source: TablePreviewSource;
}

/** Wynik wklejenia pod siatką - z podpisem danych, które wklejenie dało. */
interface WynikWklejenia {
  problems: readonly ImportProblem[];
  sig: string;
}

/** Stała pustka dla zamkniętego podglądu - nowa tablica w każdym renderze zerowałaby jego układ. */
const BEZ_WIERSZY: readonly (readonly string[])[] = [];

/** Wiersz-zachęta pustej siatki - stała, żeby uwagi nie liczyły się w każdym renderze. */
const ZACHETA: readonly MapGridRow[] = [EMPTY_MAP_ROW];

function uwagaKind(s: MapRowStatus): UwagaKind | null {
  return s.kind === "ok" || s.kind === "empty" ? null : s.kind;
}

// ---------------------------------------------------------------------------
// Komórka kodu kraju
// ---------------------------------------------------------------------------

interface CountryCellProps {
  row: number;
  value: string;
  label: string;
  placeholder: string;
  invalid: boolean;
  describedBy?: string;
  /** Wpis -> kod do zapisu (kod ISO-2, nazwa, alias; nierozpoznany zostaje). */
  resolve: (text: string) => string;
  onCommit: (id: string) => void;
  onTablePaste: (table: ClipboardTable, anchor: GridAnchor) => void;
  onOpenMenu: () => void;
}

/**
 * Kod albo nazwa kraju. Pole ma SZKIC jak komórka liczby, bo nazwa pisana
 * litera po literze nie może być rozwiązywana w trakcie: „Cz" to już kod
 * ISO-2 Czech, a autor pisze „Czechy". Zapis idzie przy opuszczeniu pola,
 * Enterze albo Tabie, a pole pokazuje potem kod, którym mapa naprawdę rysuje.
 */
function CountryCell({
  row,
  value,
  label,
  placeholder,
  invalid,
  describedBy,
  resolve,
  onCommit,
  onTablePaste,
  onOpenMenu,
}: CountryCellProps) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  // Ostatnio zatwierdzony wpis - Enter zatwierdza i przenosi fokus, a utrata
  // fokusu zatwierdzałaby drugi raz ze starym domknięciem.
  const committed = useRef<string | null>(null);

  // Kod zmieniony Z ZEWNĄTRZ (cofnięcie, wklejenie, import) wymienia szkic.
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }

  const commit = (text: string) => {
    if (committed.current === text) return;
    committed.current = text;
    const id = resolve(text);
    setDraft(id);
    if (id !== value) onCommit(id);
  };

  return (
    <input
      {...gridCellAttrs(row, 0)}
      className={cn(gridCellCls, "min-w-[96px]")}
      value={draft}
      placeholder={placeholder}
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      autoComplete="off"
      spellCheck={false}
      onChange={(e) => {
        committed.current = null;
        setDraft(e.target.value);
      }}
      onBlur={() => commit(draft)}
      onKeyDown={(e) => {
        // Ctrl+Z przy niezatwierdzonym wpisie cofa sam wpis - zdarzenie nie
        // idzie dalej, do historii bloku albo buildera.
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
          if (draft !== value) {
            e.preventDefault();
            e.stopPropagation();
            committed.current = null;
            setDraft(value);
          }
          return;
        }
        if (isMenuKey(e)) {
          e.preventDefault();
          onOpenMenu();
          return;
        }
        handleGridKey(e, () => commit(draft));
      }}
      onPaste={(e) => {
        const table = readClipboardTable(clipboardPayloadOf(e));
        if (table === null) return;
        e.preventDefault();
        onTablePaste(table, { row, col: 0 });
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Siatka
// ---------------------------------------------------------------------------

function MapDataGridInner(
  { rows, onChange, countries, docLang, lang, onFlush, className }: Props,
  ref: Ref<MapDataGridHandle>,
) {
  const t = useChartEditorT(lang);
  const baseId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState<number | null>(null);
  const [podglad, setPodglad] = useState<Podglad | null>(null);
  const [wynik, setWynik] = useState<WynikWklejenia | null>(null);
  const [ogloszenie, setOgloszenie] = useState("");
  const menuOrigin = useRef<GridAnchor | null>(null);

  const lookup = useMemo(() => mapCountryLookup(countries), [countries]);
  // Wiersz-zachęta, gdy siatka jest pusta - patrz nagłówek pliku.
  const widoczne = rows.length === 0 ? ZACHETA : rows;
  const statusy = useMemo(() => mapRowStatuses(widoczne, lookup.ids), [widoczne, lookup.ids]);
  const podpis = mapRowsSignature(rows);
  const wynikAktualny = wynik !== null && wynik.sig === podpis ? wynik : null;
  const pelne = rows.length >= MAP_GRID_MAX_ROWS;

  const flushRef = useRef(onFlush);
  flushRef.current = onFlush;
  useEffect(() => {
    const el = rootRef.current;
    if (el === null) return;
    const h = (e: Event) => {
      const wyslano = flushRef.current?.() === true;
      if (wyslano && e instanceof CustomEvent) (e.detail as GridFlushDetail).flushed = true;
    };
    el.addEventListener(GRID_FLUSH_EVENT, h);
    return () => el.removeEventListener(GRID_FLUSH_EVENT, h);
  }, []);

  const otworzPodglad = (
    table: readonly (readonly string[])[],
    problems: readonly ImportProblem[],
    source: TablePreviewSource,
  ) => setPodglad({ rows: table, problems, source });

  useImperativeHandle(ref, () => ({ openTablePreview: otworzPodglad }), []);

  /** Zapis tylko wtedy, gdy dane naprawdę się zmieniły - inaczej pusty krok historii. */
  const zmien = (next: readonly MapGridRow[]) => {
    if (mapRowsSignature(next) !== podpis) onChange(next);
  };

  const tekstUwagi = (s: MapRowStatus): string => {
    const kind = uwagaKind(s);
    if (kind === null) return "";
    return t(STATUS_KEYS[kind], s.kind === "duplicate" ? { row: s.row } : undefined);
  };

  /** Zapowiedź uwagi wiersza po zatwierdzeniu - czytnik ekranu słyszy ją bez szukania. */
  const oglosUwage = (next: readonly MapGridRow[], index: number) => {
    const s = mapRowStatuses(next, lookup.ids)[index];
    const tekst = s === undefined ? "" : tekstUwagi(s);
    setOgloszenie(
      tekst === "" ? "" : t("mapEditor.grid.statusLive", { n: index + 1, status: tekst }),
    );
  };

  const zapiszKomorke = (index: number, patch: Partial<MapGridRow>) => {
    const next = mapSetCell(widoczne, index, patch);
    zmien(next);
    oglosUwage(next, index);
  };

  const nazwaKraju = (id: string) => countryNameOf(id, docLang, lookup.names);
  const nazwaWiersza = (i: number): string => {
    const r = widoczne[i];
    return (
      (r !== undefined ? nazwaKraju(r.id) || r.id.trim() : "") ||
      t("mapEditor.grid.rowN", { n: i + 1 })
    );
  };

  const otworzMenu = (i: number, origin: GridAnchor) => {
    menuOrigin.current = origin;
    setMenu(i);
  };

  const wrocDoKomorki = () => {
    const root = rootRef.current;
    const origin = menuOrigin.current;
    if (root === null || origin === null) return;
    const aktywny = root.ownerDocument.activeElement;
    if (aktywny !== null && aktywny !== root.ownerDocument.body && aktywny.isConnected) return;
    focusNearestGridCell(root, origin.row, origin.col);
  };

  const potem = (row: number) => {
    if (menuOrigin.current !== null) menuOrigin.current = { ...menuOrigin.current, row };
  };

  const wklej = (table: ClipboardTable, anchor: GridAnchor) => {
    const readProblems: ImportProblem[] = table.truncated ? [{ code: "pasteTruncated" }] : [];
    const szerokosc = table.rows.reduce((w, r) => Math.max(w, r.length), 0);
    const pierwszaKomorka = anchor.row <= 0 && anchor.col <= 0;
    const calaTabela =
      szerokosc >= 2 &&
      (mapGridIsBlank(rows) || (pierwszaKomorka && analyseTable(table.rows).headerRow));
    if (calaTabela) {
      otworzPodglad(table.rows, readProblems, "paste");
      return;
    }
    const wynikWklejenia = applyMapPasteAt(widoczne, table.rows, anchor, lookup.index);
    zmien(wynikWklejenia.rows);
    setWynik({
      problems: [...readProblems, ...wynikWklejenia.problems],
      sig: mapRowsSignature(wynikWklejenia.rows),
    });
  };

  const zastosujPodglad = (layout: TableLayout) => {
    if (podglad === null) return;
    const dane = mapTableValues(podglad.rows, lookup.index, layout);
    const next = dane.values.map((v) => ({ id: v.id, value: v.value }));
    zmien(next);
    setWynik({ problems: [...podglad.problems, ...dane.problems], sig: mapRowsSignature(next) });
    setPodglad(null);
  };

  const menuWiersza = (i: number): GridMenuItem[] => [
    {
      id: "insertAbove",
      label: t(MENU_KEYS.insertAbove),
      unavailable: pelne,
      onSelect: () => zmien(mapInsertRow(widoczne, i)),
    },
    {
      id: "insertBelow",
      label: t(MENU_KEYS.insertBelow),
      unavailable: pelne,
      onSelect: () => {
        potem(i + 1);
        zmien(mapInsertRow(widoczne, i + 1));
      },
    },
    {
      id: "moveUp",
      label: t(MENU_KEYS.moveUp),
      unavailable: i === 0,
      onSelect: () => {
        potem(i - 1);
        zmien(mapMoveRow(widoczne, i, -1));
      },
    },
    {
      id: "moveDown",
      label: t(MENU_KEYS.moveDown),
      unavailable: i >= widoczne.length - 1,
      onSelect: () => {
        potem(i + 1);
        zmien(mapMoveRow(widoczne, i, 1));
      },
    },
    {
      id: "remove",
      label: t(MENU_KEYS.remove),
      unavailable: rows.length === 0,
      destructive: true,
      onSelect: () => zmien(mapRemoveRow(widoczne, i)),
    },
  ];

  const przycisk =
    "inline-flex items-center gap-1.5 rounded border border-border px-2 py-1.5 text-xs hover:border-foreground/50 disabled:cursor-default disabled:opacity-40 disabled:hover:border-border";

  return (
    <div ref={rootRef} {...{ [CHART_GRID_ATTR]: "" }} className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={przycisk}
          disabled={pelne}
          onClick={() => zmien(mapInsertRow(widoczne, widoczne.length))}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> {t("mapEditor.grid.addRow")}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table
          className="w-full border-separate border-spacing-1"
          aria-label={t("mapEditor.grid.label")}
        >
          <thead>
            <tr>
              <th className="w-12 px-0 text-[10px] font-medium text-muted-foreground">#</th>
              <th className="px-1 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                {t("mapEditor.grid.code")}
              </th>
              <th className="px-1 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                {t("mapEditor.grid.country")}
              </th>
              <th className="px-1 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                {t("mapEditor.grid.value")}
              </th>
              <th className="px-1 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                {t("mapEditor.grid.status")}
              </th>
            </tr>
          </thead>
          <tbody>
            {widoczne.map((r, i) => {
              const status = statusy[i] ?? { kind: "empty" };
              const kind = uwagaKind(status);
              const uwagaId = kind === null ? undefined : `${baseId}-uwaga-${i}`;
              const nazwa = nazwaKraju(r.id);
              return (
                <tr key={i} data-map-row={i} data-map-status={status.kind}>
                  <td className="px-0 text-center text-[10px] text-muted-foreground">
                    <div className="flex items-center justify-center gap-0.5">
                      <span className="tabular-nums">{i + 1}</span>
                      <GridMenu
                        label={t("mapEditor.grid.menu", { name: nazwaWiersza(i) })}
                        items={menuWiersza(i)}
                        open={menu === i}
                        onOpenChange={(o) =>
                          o ? otworzMenu(i, { row: i, col: 0 }) : setMenu(null)
                        }
                        onCloseFocus={wrocDoKomorki}
                      />
                    </div>
                  </td>
                  <td className="w-32 align-top">
                    <CountryCell
                      row={i}
                      value={r.id}
                      label={t("mapEditor.grid.codeCell", { n: i + 1 })}
                      placeholder={t("mapEditor.grid.codePlaceholder")}
                      invalid={kind === "unknown"}
                      describedBy={uwagaId}
                      resolve={(text) => resolveCountryEntry(text, lookup.index)}
                      onCommit={(id) => zapiszKomorke(i, { id })}
                      onTablePaste={wklej}
                      onOpenMenu={() => otworzMenu(i, { row: i, col: 0 })}
                    />
                  </td>
                  <td className="min-w-[8rem] px-1 align-middle text-xs">
                    {nazwa !== "" ? nazwa : <span className="text-muted-foreground">-</span>}
                  </td>
                  <td className="w-32 align-top">
                    <NumberCell
                      row={i}
                      col={1}
                      value={r.value}
                      lang={docLang}
                      label={t("mapEditor.grid.cell", { country: nazwaWiersza(i) })}
                      invalidText={t("mapEditor.grid.invalidNumber")}
                      placeholder={t("mapEditor.grid.valuePlaceholder")}
                      onCommit={(value) => zapiszKomorke(i, { value })}
                      onTablePaste={wklej}
                      onOpenMenu={() => otworzMenu(i, { row: i, col: 1 })}
                    />
                  </td>
                  <td className="min-w-[10rem] px-1 align-middle">
                    {kind !== null && (
                      <span
                        id={uwagaId}
                        data-map-note={kind}
                        className={cn(
                          "flex items-start gap-1 text-[11px] leading-snug",
                          STATUS_WEIGHT[kind] === "info" && "text-muted-foreground",
                        )}
                        style={
                          STATUS_WEIGHT[kind] === "warn"
                            ? { color: "var(--chart-negative-text)" }
                            : undefined
                        }
                      >
                        {STATUS_WEIGHT[kind] === "warn" ? (
                          <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />
                        ) : (
                          <Info className="mt-px h-3 w-3 shrink-0" aria-hidden />
                        )}
                        <span>{tekstUwagi(status)}</span>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pelne && (
        <p className="text-[10px] text-muted-foreground">
          {t("mapEditor.grid.limitRows", { max: MAP_GRID_MAX_ROWS })}
        </p>
      )}
      <p className="text-[10px] text-muted-foreground">{t("mapEditor.grid.pasteHint")}</p>
      <p aria-live="polite" className="sr-only">
        {ogloszenie}
      </p>
      {wynikAktualny !== null && (
        <div aria-live="polite" className="space-y-1">
          <p className="text-[11px] text-muted-foreground">{t("mapEditor.grid.pasted")}</p>
          <ImportProblemList problems={wynikAktualny.problems} lang={lang} />
        </div>
      )}

      <PastePreviewDialog
        open={podglad !== null}
        rows={podglad?.rows ?? BEZ_WIERSZY}
        mode="map"
        source={podglad?.source ?? "paste"}
        readProblems={podglad?.problems}
        countryIndex={lookup.index}
        lang={lang}
        onApply={zastosujPodglad}
        onCancel={() => setPodglad(null)}
      />
    </div>
  );
}

export const MapDataGrid = forwardRef(MapDataGridInner);
