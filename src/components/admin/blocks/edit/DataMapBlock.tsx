// Admin edytor bloku "data-map" (kartogram). Lista kraj - wartość + import
// z pliku + PODGLĄD NA ŻYWO nad formą - autor widzi dokładnie ten sam render,
// który trafi na stronę publiczną (wspólny silnik src/components/charts).
//
// Do PR2 żył w `DataVizBlocks.tsx` razem z edytorem wykresu; tamten plik
// re-eksportuje go dalej, więc dyspozytor i testy importują go jak dotąd.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import type { Block, Json } from "@/lib/blocks/types";
import { Plus, Trash2 } from "lucide-react";
import { AdminSelect } from "../AdminSelect";
import { parseDataMapConfig, parseMapRegion } from "@/lib/charts/parse";
import { MAP_REGIONS, mapRegionLabelKey, type MapRegion } from "@/lib/charts/types";
import { geoAssetQueryOptions } from "@/lib/charts/geoQuery";
import { ChoroplethMap } from "@/components/charts/ChoroplethMap";
import { DataImportControl } from "@/components/admin/blocks/DataImportControl";
import { buildCountryIndex, tableToMapValues } from "@/lib/charts/importTable";
import { cellCls, inputCls, Shell } from "./dataVizShared";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

interface MapRowDraft {
  id: string;
  value: number | null;
}

function readMapValues(raw: Json | undefined): MapRowDraft[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const o = (item ?? {}) as Record<string, Json>;
    const v = o.value;
    return {
      id: String(o.id ?? "").toUpperCase(),
      value: typeof v === "number" && Number.isFinite(v) ? v : null,
    };
  });
}

export function DataMapBlock({ block, onChange }: Props) {
  const bt = useBlocksI18n();
  // Region idzie przez parser bloku, a nie przez porównanie z dwoma literałami:
  // ta sama droga, co w renderze publicznym, więc podgląd nad formą pokazuje
  // DOKŁADNIE to, co zobaczy czytelnik - także wtedy, gdy w treści siedzi
  // region z nowszej wersji edytora.
  const region: MapRegion = parseMapRegion(block.data.region);
  const rows = readMapValues(block.data.values);
  const previewConfig = useMemo(() => parseDataMapConfig(block.data), [block.data]);

  // Lista krajów z tego samego statycznego zasobu, który rysuje mapę -
  // zero dodatkowych danych w bundlu, opcje zawsze zgodne z geometrią.
  const geo = useQuery(geoAssetQueryOptions(region));
  const countryOptions = useMemo(
    () =>
      (geo.data?.countries ?? [])
        .map((c) => ({ id: c.id, label: `${c.pl} (${c.id})` }))
        .sort((a, b) => a.label.localeCompare(b.label, "pl")),
    [geo.data],
  );

  const patch = (data: Record<string, Json>) =>
    onChange({ ...block, data: { ...block.data, ...data } });

  const setRows = (next: MapRowDraft[]) =>
    patch({ values: next.map((r) => ({ id: r.id, value: r.value })) });

  return (
    <Shell label={bt.editor("dataMap", "shellLabel")}>
      <div className="pointer-events-none">
        <ChoroplethMap config={{ ...previewConfig, animate: false }} lang="pl" className="my-0" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <AdminSelect
          className={inputCls}
          value={region}
          onChange={(e) => patch({ region: e.target.value })}
        >
          {/* Opcje WYPROWADZONE ze źródła regionów - wcześniej stały tu dwa
              ręcznie wpisane `<option>`, więc dołożenie regionu wymagało
              dotknięcia edytora i było o jedno przeoczenie od regionu, którego
              autor nie mógł wybrać, choć silnik już go umiał narysować. */}
          {MAP_REGIONS.map((r) => (
            <option key={r} value={r}>
              {bt.editor("dataMap", mapRegionLabelKey(r))}
            </option>
          ))}
        </AdminSelect>
        <input
          className={inputCls}
          value={String(block.data.unit ?? "")}
          placeholder={bt.editor("dataMap", "unit")}
          onChange={(e) => patch({ unit: e.target.value })}
        />
      </div>
      <input
        className={inputCls}
        value={String(block.data.title ?? "")}
        placeholder={bt.editor("dataMap", "title")}
        onChange={(e) => patch({ title: e.target.value })}
      />
      <input
        className={inputCls}
        value={String(block.data.description ?? "")}
        placeholder={bt.editor("common", "subtitle")}
        onChange={(e) => patch({ description: e.target.value })}
      />

      {/* Skorowidz nazw powstaje z TEGO SAMEGO zasobu, który rysuje mapę,
          więc kraj spoza wybranego regionu wyjdzie jako nierozpoznany
          zamiast wejść do danych i nigdy się nie narysować. */}
      <DataImportControl
        hint={bt.editor("dataImport", "hintMap")}
        onRows={(rowsIn) => {
          const wynik = tableToMapValues(rowsIn, buildCountryIndex(geo.data?.countries ?? []));
          patch({ values: wynik.values.map((v) => ({ id: v.id, value: v.value })) });
          return wynik.problems;
        }}
      />

      <div className="space-y-1.5">
        {rows.map((row, ri) => (
          <div key={ri} className="flex items-center gap-2">
            <AdminSelect
              className={`${inputCls} flex-1`}
              value={row.id}
              onChange={(e) =>
                setRows(rows.map((r, i) => (i === ri ? { ...r, id: e.target.value } : r)))
              }
            >
              <option value="">{bt.editor("dataMap", "selectCountry")}</option>
              {countryOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
              {/* Zachowaj kod spoza listy (np. zanim zasób się wczyta). */}
              {row.id && !countryOptions.some((o) => o.id === row.id) && (
                <option value={row.id}>{row.id}</option>
              )}
            </AdminSelect>
            <input
              className={`${cellCls} w-28`}
              inputMode="decimal"
              value={row.value === null ? "" : String(row.value)}
              placeholder={bt.editor("dataMap", "value")}
              onChange={(e) => {
                const raw = e.target.value.trim().replace(",", ".");
                const v = raw === "" ? null : Number(raw);
                setRows(
                  rows.map((r, i) =>
                    i === ri ? { ...r, value: v === null || !Number.isFinite(v) ? null : v } : r,
                  ),
                );
              }}
            />
            <button
              type="button"
              className="text-muted-foreground hover:text-destructive"
              aria-label={bt.editor("dataMap", "removeRow", { name: row.id || ri + 1 })}
              onClick={() => setRows(rows.filter((_, i) => i !== ri))}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-border hover:border-foreground/50"
          onClick={() => setRows([...rows, { id: "", value: null }])}
        >
          <Plus className="w-3.5 h-3.5" /> {bt.editor("dataMap", "addCountry")}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={block.data.showLegend !== false}
            onChange={(e) => patch({ showLegend: e.target.checked })}
          />
          {bt.editor("common", "legend")}
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={block.data.animate !== false}
            onChange={(e) => patch({ animate: e.target.checked })}
          />
          {bt.editor("common", "animate")}
        </label>
      </div>
      <input
        className={inputCls}
        value={String(block.data.source ?? "")}
        placeholder={bt.editor("dataMap", "source")}
        onChange={(e) => patch({ source: e.target.value })}
      />
    </Shell>
  );
}
