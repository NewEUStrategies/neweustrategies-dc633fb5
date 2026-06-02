import type { Block } from "@/lib/blocks/types";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

function readRows(block: Block): string[][] {
  const raw = block.data.rows;
  if (!Array.isArray(raw)) return [[""]];
  return raw.map((r) => Array.isArray(r) ? r.map((c) => String(c ?? "")) : [""]);
}

export function TableBlockEdit({ block, onChange }: Props) {
  const rows = readRows(block);
  const header = Boolean(block.data.header);
  const cols = Math.max(1, ...rows.map((r) => r.length));

  const set = (rows: string[][]) => onChange({ ...block, data: { ...block.data, rows: rows as unknown as never } });

  const updateCell = (r: number, c: number, v: string) => {
    set(rows.map((row, i) => i === r ? row.map((cell, j) => j === c ? v : cell) : row));
  };

  const addRow = () => set([...rows, Array(cols).fill("")]);
  const addCol = () => set(rows.map((r) => [...r, ""]));
  const removeRow = (i: number) => set(rows.length > 1 ? rows.filter((_, j) => j !== i) : rows);
  const removeCol = (i: number) => set(rows.map((r) => r.length > 1 ? r.filter((_, j) => j !== i) : r));

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={header}
            onChange={(e) => onChange({ ...block, data: { ...block.data, header: e.target.checked } })}
          />
          Pierwszy wiersz = nagłówek
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
                  <button type="button" onClick={() => removeRow(r)} className="text-muted-foreground hover:text-destructive p-1" title="Usuń wiersz">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c} className="border-t border-border text-center">
                  <button type="button" onClick={() => removeCol(c)} className="text-muted-foreground hover:text-destructive p-1" title="Usuń kolumnę">
                    <Trash2 className="w-3 h-3 inline" />
                  </button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={addRow}><Plus className="w-3 h-3 mr-1" /> Wiersz</Button>
        <Button size="sm" variant="outline" onClick={addCol}><Plus className="w-3 h-3 mr-1" /> Kolumna</Button>
      </div>
    </div>
  );
}
