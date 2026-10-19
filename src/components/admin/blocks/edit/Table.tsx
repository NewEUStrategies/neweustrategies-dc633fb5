import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import { toJson } from "@/lib/content-model/json";
import type { Block } from "@/lib/blocks/types";
import { bool } from "@/components/blocks/renderer/data";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

function readRows(block: Block): string[][] {
  const raw = block.data.rows;
  if (!Array.isArray(raw)) return [[""]];
  return raw.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? "")) : [""]));
}

/** Metadane komórek z importu (spans/aligns) - trzymane równolegle do `rows`. */
function readMeta<T>(block: Block, key: "spans" | "aligns", fallback: T): T[][] {
  const raw = block.data[key];
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => (Array.isArray(r) ? r.map((c) => (c as T) ?? fallback) : []));
}

export function TableBlockEdit({ block, onChange }: Props) {
  const bt = useBlocksI18n();
  const rows = readRows(block);
  // Jak `renderTable`: nagłówek włącza wyłącznie `true`, nie napis „false".
  const header = bool(block.data, "header", false);
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const spans = readMeta<[number, number]>(block, "spans", [1, 1]);
  const aligns = readMeta<string>(block, "aligns", "");
  const hasMeta = spans.length > 0 || aligns.length > 0;

  const set = (nextRows: string[][], mapMeta?: <T>(meta: T[][], filler: T) => T[][]) => {
    const data: Record<string, ReturnType<typeof toJson>> = {
      ...block.data,
      rows: toJson(nextRows),
    };
    if (hasMeta && mapMeta) {
      if (spans.length) data.spans = toJson(mapMeta<[number, number]>(spans, [1, 1]));
      if (aligns.length) data.aligns = toJson(mapMeta<string>(aligns, ""));
    }
    onChange({ ...block, data });
  };

  const updateCell = (r: number, c: number, v: string) => {
    set(rows.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? v : cell)) : row)));
  };

  const addRow = () =>
    set([...rows, Array(cols).fill("")], (meta, filler) => [...meta, Array(cols).fill(filler)]);
  const addCol = () =>
    set(
      rows.map((r) => [...r, ""]),
      (meta, filler) => meta.map((r) => [...r, filler]),
    );
  // Ostatniego wiersza ani ostatniej kolumny się nie usuwa - i wtedy NIE ma
  // zapisu: identyczna tabela przez `onChange` brudziła dokument i historię.
  const removeRow = (i: number) => {
    if (rows.length <= 1) return;
    set(
      rows.filter((_, j) => j !== i),
      (meta) => meta.filter((_, j) => j !== i),
    );
  };
  const removeCol = (i: number) => {
    if (rows.every((r) => r.length <= 1)) return;
    set(
      rows.map((r) => (r.length > 1 ? r.filter((_, j) => j !== i) : r)),
      (meta) => meta.map((r) => (r.length > 1 ? r.filter((_, j) => j !== i) : r)),
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={header}
            onChange={(e) =>
              onChange({ ...block, data: { ...block.data, header: e.target.checked } })
            }
          />
          {bt.editor("table", "headerRow")}
        </label>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className={header && r === 0 ? "bg-muted/50 font-semibold" : ""}>
                {row.map((cell, c) => (
                  <td key={c} className="border border-border p-0 align-top">
                    <input
                      type="text"
                      value={cell}
                      onChange={(e) => updateCell(r, c, e.target.value)}
                      className="w-full bg-transparent px-2 py-1 outline-none focus:bg-accent/40"
                    />
                  </td>
                ))}
                <td className="border-l border-border w-8 text-center">
                  <button
                    type="button"
                    onClick={() => removeRow(r)}
                    className="text-muted-foreground hover:text-destructive p-1"
                    title={bt.editor("table", "removeRow")}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c} className="border-t border-border text-center">
                  <button
                    type="button"
                    onClick={() => removeCol(c)}
                    className="text-muted-foreground hover:text-destructive p-1"
                    title={bt.editor("table", "removeCol")}
                  >
                    <Trash2 className="w-3 h-3 inline" />
                  </button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={addRow}>
          <Plus className="w-3 h-3 mr-1" /> {bt.editor("table", "addRow")}
        </Button>
        <Button size="sm" variant="outline" onClick={addCol}>
          <Plus className="w-3 h-3 mr-1" /> {bt.editor("table", "addCol")}
        </Button>
      </div>
    </div>
  );
}
