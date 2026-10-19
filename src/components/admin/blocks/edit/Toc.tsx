import type { Block } from "@/lib/blocks/types";
import { Input } from "@/components/ui/input";
import { ListTree } from "lucide-react";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import { bool, num } from "@/components/blocks/renderer/data";
import { AdminSelect } from "../AdminSelect";
import { readText } from "./dataVizShared";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

export function TocBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const title = readText(block.data.title);
  // Głębokość czytana jak w rendererze (`num`, domyślnie 3) i obcięta do całości:
  // strona filtruje `poziom <= maxLevel`, więc 3,5 zbiera H2-H3. Granice 2-4 to
  // dziedzina listy niżej - wartość spoza niej pokazałaby pole i podpowiedź
  // („H2-HNaN") niezgodne z tym, co narysuje strona.
  const maxLevel = Math.max(2, Math.min(4, Math.floor(num(block.data, "maxLevel", 3))));
  const ordered = bool(block.data, "ordered", false);
  const sticky = bool(block.data, "sticky", false);

  return (
    <div className="not-prose rounded-md border border-border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <ListTree className="w-3.5 h-3.5" /> {i18n.editor("toc", "title")}
        <span className="ml-auto text-[10px] normal-case tracking-normal">
          {i18n.editor("toc", "autoHint", { max: maxLevel })}
        </span>
      </div>
      <Input
        placeholder={i18n.editor("toc", "titlePh")}
        value={title}
        onChange={(e) => onChange({ ...block, data: { ...block.data, title: e.target.value } })}
      />
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1">
          {i18n.editor("toc", "maxLevel")}:
          <AdminSelect
            value={maxLevel}
            onChange={(e) =>
              onChange({ ...block, data: { ...block.data, maxLevel: Number(e.target.value) } })
            }
            className="bg-background border border-border rounded px-1 py-0.5"
          >
            <option value={2}>H2</option>
            <option value={3}>H2-H3</option>
            <option value={4}>H2-H4</option>
          </AdminSelect>
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={ordered}
            onChange={(e) =>
              onChange({ ...block, data: { ...block.data, ordered: e.target.checked } })
            }
          />
          {i18n.editor("toc", "ordered")}
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={sticky}
            onChange={(e) =>
              onChange({ ...block, data: { ...block.data, sticky: e.target.checked } })
            }
          />
          {i18n.editor("toc", "sticky")}
        </label>
      </div>
    </div>
  );
}
