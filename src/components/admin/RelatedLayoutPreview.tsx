// Wizualne miniatury layoutów sekcji "Powiązane wpisy" (SVG, semantyczne tokeny).
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { RelatedLayout } from "@/lib/relatedPosts";

type Props = {
  value: RelatedLayout;
  onChange: (v: RelatedLayout) => void;
};

const LABELS: Record<RelatedLayout, { pl: string; en: string; desc_pl: string; desc_en: string }> =
  {
    grid: {
      pl: "Grid",
      en: "Grid",
      desc_pl: "Równa siatka miniatur",
      desc_en: "Equal thumbnail grid",
    },
    list: { pl: "Lista", en: "List", desc_pl: "Kompaktowe wiersze", desc_en: "Compact rows" },
    slider: {
      pl: "Slider",
      en: "Slider",
      desc_pl: "Poziome przewijanie",
      desc_en: "Horizontal scroll",
    },
    cards: {
      pl: "Karty",
      en: "Cards",
      desc_pl: "Kolor kategorii + ikona",
      desc_en: "Category color + icon",
    },
    magazine: {
      pl: "Magazyn",
      en: "Magazine",
      desc_pl: "Hero + lista boczna",
      desc_en: "Hero + side list",
    },
    timeline: {
      pl: "Oś czasu",
      en: "Timeline",
      desc_pl: "Chronologia z kropkami",
      desc_en: "Chronological dots",
    },
  };

const ORDER: RelatedLayout[] = ["grid", "list", "slider", "cards", "magazine", "timeline"];

function Thumb({ layout }: { layout: RelatedLayout }) {
  const stroke = "hsl(var(--border))";
  const soft = "hsl(var(--muted))";
  const ink = "hsl(var(--foreground) / 0.55)";
  const accent = "hsl(var(--primary))";
  switch (layout) {
    case "grid":
      return (
        <svg viewBox="0 0 120 70" className="w-full h-full">
          {[0, 1, 2].map((c) =>
            [0, 1].map((r) => (
              <g key={`${c}-${r}`}>
                <rect
                  x={6 + c * 38}
                  y={6 + r * 32}
                  width={32}
                  height={18}
                  rx={2}
                  fill={soft}
                  stroke={stroke}
                />
                <rect x={6 + c * 38} y={26 + r * 32} width={22} height={2} fill={ink} />
                <rect
                  x={6 + c * 38}
                  y={30 + r * 32}
                  width={16}
                  height={2}
                  fill={ink}
                  opacity={0.5}
                />
              </g>
            )),
          )}
        </svg>
      );
    case "list":
      return (
        <svg viewBox="0 0 120 70" className="w-full h-full">
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <rect
                x={6}
                y={6 + i * 15}
                width={20}
                height={11}
                rx={2}
                fill={soft}
                stroke={stroke}
              />
              <rect x={30} y={8 + i * 15} width={60} height={2.5} fill={ink} />
              <rect x={30} y={13 + i * 15} width={40} height={2} fill={ink} opacity={0.5} />
            </g>
          ))}
        </svg>
      );
    case "slider":
      return (
        <svg viewBox="0 0 120 70" className="w-full h-full">
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <rect
                x={6 + i * 32}
                y={10}
                width={28}
                height={38}
                rx={2}
                fill={soft}
                stroke={stroke}
              />
              <rect x={6 + i * 32} y={50} width={20} height={2} fill={ink} />
            </g>
          ))}
          <rect x={48} y={60} width={24} height={3} rx={1.5} fill={accent} />
          <rect x={40} y={60} width={6} height={3} rx={1.5} fill={ink} opacity={0.3} />
          <rect x={74} y={60} width={6} height={3} rx={1.5} fill={ink} opacity={0.3} />
        </svg>
      );
    case "cards":
      return (
        <svg viewBox="0 0 120 70" className="w-full h-full">
          {[
            { x: 6, c: "hsl(var(--primary) / 0.18)" },
            { x: 44, c: "hsl(var(--accent) / 0.28)" },
            { x: 82, c: "hsl(var(--secondary) / 0.6)" },
          ].map((card, i) => (
            <g key={i}>
              <rect x={card.x} y={8} width={32} height={54} rx={4} fill={card.c} stroke={stroke} />
              <circle cx={card.x + 8} cy={16} r={3.5} fill={accent} />
              <rect x={card.x + 4} y={40} width={24} height={2.5} fill={ink} />
              <rect x={card.x + 4} y={45} width={16} height={2} fill={ink} opacity={0.5} />
              <rect
                x={card.x + 4}
                y={52}
                width={10}
                height={3}
                rx={1.5}
                fill={accent}
                opacity={0.7}
              />
            </g>
          ))}
        </svg>
      );
    case "magazine":
      return (
        <svg viewBox="0 0 120 70" className="w-full h-full">
          <rect x={6} y={6} width={64} height={58} rx={2} fill={soft} stroke={stroke} />
          <rect x={10} y={46} width={40} height={3} fill={ink} />
          <rect x={10} y={52} width={28} height={2} fill={ink} opacity={0.5} />
          <rect x={10} y={10} width={18} height={4} rx={2} fill={accent} />
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect
                x={74}
                y={6 + i * 20}
                width={16}
                height={16}
                rx={2}
                fill={soft}
                stroke={stroke}
              />
              <rect x={93} y={9 + i * 20} width={22} height={2.5} fill={ink} />
              <rect x={93} y={14 + i * 20} width={16} height={2} fill={ink} opacity={0.5} />
            </g>
          ))}
        </svg>
      );
    case "timeline":
      return (
        <svg viewBox="0 0 120 70" className="w-full h-full">
          <line x1={16} y1={8} x2={16} y2={64} stroke={stroke} strokeWidth={1} />
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <circle cx={16} cy={14 + i * 20} r={3.5} fill={accent} />
              <rect x={26} y={10 + i * 20} width={20} height={2.5} fill={ink} opacity={0.6} />
              <rect x={26} y={15 + i * 20} width={70} height={2.5} fill={ink} />
              <rect x={26} y={20 + i * 20} width={54} height={2} fill={ink} opacity={0.5} />
            </g>
          ))}
        </svg>
      );
  }
}

export function RelatedLayoutPreview({ value, onChange }: Props) {
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith("en") ? "en" : "pl";
  return (
    <div
      role="radiogroup"
      aria-label={lang === "en" ? "Related posts layout" : "Układ powiązanych wpisów"}
      className="grid grid-cols-2 sm:grid-cols-3 gap-3"
    >
      {ORDER.map((k) => {
        const active = value === k;
        const meta = LABELS[k];
        return (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(k)}
            className={cn(
              "group text-left rounded-lg border bg-card p-3 transition-all",
              "hover:shadow-md hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "border-primary ring-2 ring-primary/40 shadow-md" : "border-border",
            )}
          >
            <div className="aspect-[12/7] w-full rounded-md bg-background/60 overflow-hidden mb-2 ring-1 ring-inset ring-border/50">
              <Thumb layout={k} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">
                  {lang === "en" ? meta.en : meta.pl}
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {lang === "en" ? meta.desc_en : meta.desc_pl}
                </div>
              </div>
              {active && (
                <span className="text-[10px] font-semibold uppercase tracking-wide text-primary shrink-0">
                  {lang === "en" ? "Active" : "Aktywny"}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
