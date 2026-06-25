// Foxiz-style Review Box editor.
import type { Block, Json } from "@/lib/blocks/types";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Star } from "lucide-react";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

interface Criterion { label: string; score: number }

function readCriteria(raw: Json | undefined): Criterion[] {
  if (!Array.isArray(raw)) return [];
  const out: Criterion[] = [];
  for (const x of raw) {
    if (x && typeof x === "object" && !Array.isArray(x)) {
      const o = x as Record<string, unknown>;
      out.push({ label: String(o.label ?? ""), score: Number(o.score ?? 0) });
    }
  }
  return out;
}

export function ReviewBlock({ block, onChange }: Props) {
  const title = String(block.data.title ?? "");
  const summary = String(block.data.summary ?? "");
  const ctaLabel = String(block.data.ctaLabel ?? "");
  const ctaHref = String(block.data.ctaHref ?? "");
  const scale = Math.max(5, Math.min(10, Number(block.data.scale ?? 10)));
  const criteria = readCriteria(block.data.criteria);

  const total = criteria.length
    ? criteria.reduce((a, c) => a + c.score, 0) / criteria.length
    : 0;

  const patch = (key: string, value: Json) => onChange({ ...block, data: { ...block.data, [key]: value } });
  const patchCriteria = (next: Criterion[]) => patch("criteria", next as unknown as Json);

  return (
    <div className="not-prose rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <Star className="w-3.5 h-3.5" /> Review Box
        <span className="ml-auto text-sm font-semibold text-foreground">
          {total.toFixed(1)} / {scale}
        </span>
      </div>
      <Input
        placeholder="Tytuł recenzji"
        value={title}
        onChange={(e) => patch("title", e.target.value)}
      />
      <textarea
        placeholder="Podsumowanie / werdykt"
        value={summary}
        onChange={(e) => patch("summary", e.target.value)}
        className="w-full rounded border border-border bg-background px-3 py-2 text-sm min-h-[60px]"
      />
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Kryteria (skala 0-{scale})</span>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1">
              Skala:
              <select
                value={scale}
                onChange={(e) => patch("scale", Number(e.target.value))}
                className="bg-background border border-border rounded px-1 py-0.5"
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
              </select>
            </label>
          </div>
        </div>
        {criteria.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              placeholder={`Kryterium ${i + 1}`}
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
              aria-label="Usuń kryterium"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => patchCriteria([...criteria, { label: "", score: 8 }])}
          className="text-xs flex items-center gap-1 text-primary hover:underline"
        >
          <Plus className="w-3.5 h-3.5" /> Dodaj kryterium
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input
          placeholder="Etykieta CTA (np. Kup książkę)"
          value={ctaLabel}
          onChange={(e) => patch("ctaLabel", e.target.value)}
        />
        <Input
          placeholder="Link CTA (https://...)"
          value={ctaHref}
          onChange={(e) => patch("ctaHref", e.target.value)}
        />
      </div>
    </div>
  );
}
