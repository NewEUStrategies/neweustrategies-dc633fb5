// Foxiz-style Review Box editor.
//
// Odczyt `block.data` idzie przez TE SAME czytniki, co renderer publiczny
// (`components/blocks/renderer/data.ts`), a ocena łączna liczy się jak w
// `ReviewBlockView` (tylko kryteria z nazwą) - panel pokazuje to, co zobaczy
// czytelnik, a nie „NaN" czy „[object Object]" z importu.
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import { toJson } from "@/lib/content-model/json";
import type { Block, Json } from "@/lib/blocks/types";
import { num, objList, str } from "@/components/blocks/renderer/data";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Star } from "lucide-react";
import { AdminSelect } from "../AdminSelect";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

interface Criterion {
  label: string;
  score: number;
}

/** Skale, które daje lista wyboru; inna (z importu) dochodzi jako dodatkowa opcja. */
const SCALES: readonly number[] = [5, 10];

function readCriteria(block: Block): Criterion[] {
  return objList(block.data, "criteria", (o) => ({
    label: str(o, "label"),
    score: num(o, "score", 0),
  }));
}

export function ReviewBlock({ block, onChange }: Props) {
  const bt = useBlocksI18n();
  const title = str(block.data, "title");
  const summary = str(block.data, "summary");
  const ctaLabel = str(block.data, "ctaLabel");
  const ctaHref = str(block.data, "ctaHref");
  const scale = Math.max(5, Math.min(10, num(block.data, "scale", 10)));
  const scaleOptions = SCALES.includes(scale) ? SCALES : [...SCALES, scale].sort((a, b) => a - b);
  const criteria = readCriteria(block);

  const rated = criteria.filter((c) => c.label.trim());
  const total = rated.length ? rated.reduce((a, c) => a + c.score, 0) / rated.length : 0;

  const patch = (key: string, value: Json) =>
    onChange({ ...block, data: { ...block.data, [key]: value } });
  const patchCriteria = (next: Criterion[]) => patch("criteria", toJson(next));

  return (
    <div className="not-prose rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <Star className="w-3.5 h-3.5" /> Review Box
        <span className="ml-auto text-sm font-semibold text-foreground">
          {total.toFixed(1)} / {scale}
        </span>
      </div>
      <Input
        placeholder={bt.editor("review", "title")}
        value={title}
        onChange={(e) => patch("title", e.target.value)}
      />
      <textarea
        placeholder={bt.editor("review", "summary")}
        value={summary}
        onChange={(e) => patch("summary", e.target.value)}
        className="w-full rounded border border-border bg-background px-3 py-2 text-sm min-h-[60px]"
      />
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{bt.editor("review", "criteriaScale", { scale })}</span>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1">
              {bt.editor("review", "scale")}
              <AdminSelect
                value={scale}
                onChange={(e) => patch("scale", Number(e.target.value))}
                className="bg-background border border-border rounded px-1 py-0.5"
              >
                {scaleOptions.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </AdminSelect>
            </label>
          </div>
        </div>
        {criteria.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              placeholder={bt.editor("review", "criterion", { n: i + 1 })}
              value={c.label}
              onChange={(e) => {
                const next = [...criteria];
                next[i] = { ...c, label: e.target.value };
                patchCriteria(next);
              }}
              className="flex-1"
            />
            <input
              type="range"
              min={0}
              max={scale}
              step={0.1}
              value={c.score}
              onChange={(e) => {
                const next = [...criteria];
                next[i] = { ...c, score: Number(e.target.value) };
                patchCriteria(next);
              }}
              className="w-32"
            />
            <span className="w-10 text-sm tabular-nums text-right">{c.score.toFixed(1)}</span>
            <button
              type="button"
              onClick={() => patchCriteria(criteria.filter((_, j) => j !== i))}
              className="p-1 hover:bg-accent rounded text-muted-foreground"
              aria-label={bt.editor("review", "removeCriterion")}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => patchCriteria([...criteria, { label: "", score: 8 }])}
          className="text-xs flex items-center gap-1 text-foreground hover:underline"
        >
          <Plus className="w-3.5 h-3.5" /> {bt.editor("review", "addCriterion")}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input
          placeholder={bt.editor("review", "ctaLabel")}
          value={ctaLabel}
          onChange={(e) => patch("ctaLabel", e.target.value)}
        />
        <Input
          placeholder={bt.editor("review", "ctaHref")}
          value={ctaHref}
          onChange={(e) => patch("ctaHref", e.target.value)}
        />
      </div>
    </div>
  );
}
