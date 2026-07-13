// Diagram Sankeya (przepływy: handel, energia, migracja) - dwuwarstwowy
// źródło -> cel. Węzły mają wysokość proporcjonalną do przepustowości, wstęgi
// szerokość proporcjonalną do wartości. Silnik czysto SVG (zero zależności),
// responsywny przez useContainerWidth. Pełne wartości zawsze niesie tabela
// danych - grafika jest wizualnym duplikatem.
import { useMemo, useState } from "react";
import type { SankeyConfig, FeatureLang } from "@/lib/features/types";
import { pickBi } from "@/lib/features/types";
import { formatChartValue } from "@/lib/charts/format";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { useRevealOnScroll, revealClassName } from "@/hooks/useRevealOnScroll";
import { FeatureFrame, FeatureDataTable, FEATURE_TABLE_CLS } from "./FeatureFrame";

const L = {
  pl: {
    empty: "Brak przepływów.",
    from: "Źródło",
    to: "Cel",
    value: "Wartość",
    data: "Pokaż dane",
  },
  en: { empty: "No flows.", from: "Source", to: "Target", value: "Value", data: "Show data" },
} as const;

interface Props {
  config: SankeyConfig;
  lang: FeatureLang;
  className?: string;
}

interface LayoutNode {
  key: string;
  label: string;
  y: number;
  height: number;
  total: number;
}

interface LayoutBand {
  d: string;
  width: number;
  colorSlot: number;
  from: string;
  to: string;
  value: number;
}

const NODE_W = 14;
const GAP = 10;
const PAD_Y = 6;

export function SankeyDiagram({ config, lang, className }: Props) {
  const t = L[lang];
  const { ref: widthRef, width } = useContainerWidth<HTMLDivElement>(720);
  const { ref: revealRef, state } = useRevealOnScroll<HTMLDivElement>(config.animate);
  const [active, setActive] = useState<number | null>(null);

  const layout = useMemo(() => {
    const flows = config.flows;
    if (flows.length === 0) return null;
    // Węzły źródłowe (lewa) i docelowe (prawa) - klucz po tekście PL (stabilny).
    const srcKeys: string[] = [];
    const dstKeys: string[] = [];
    const srcLabel = new Map<string, string>();
    const dstLabel = new Map<string, string>();
    const srcTotal = new Map<string, number>();
    const dstTotal = new Map<string, number>();
    for (const f of flows) {
      const sk = f.from.pl;
      const dk = f.to.pl;
      if (!srcLabel.has(sk)) {
        srcKeys.push(sk);
        srcLabel.set(sk, pickBi(f.from, lang));
      }
      if (!dstLabel.has(dk)) {
        dstKeys.push(dk);
        dstLabel.set(dk, pickBi(f.to, lang));
      }
      srcTotal.set(sk, (srcTotal.get(sk) ?? 0) + f.value);
      dstTotal.set(dk, (dstTotal.get(dk) ?? 0) + f.value);
    }
    const grandTotal = flows.reduce((s, f) => s + f.value, 0);
    const H = config.height;
    const usableSrc = H - PAD_Y * 2 - GAP * Math.max(0, srcKeys.length - 1);
    const usableDst = H - PAD_Y * 2 - GAP * Math.max(0, dstKeys.length - 1);
    const scaleSrc = usableSrc / grandTotal;
    const scaleDst = usableDst / grandTotal;

    const mkNodes = (
      keys: string[],
      label: Map<string, string>,
      total: Map<string, number>,
      scale: number,
    ): Map<string, LayoutNode> => {
      const m = new Map<string, LayoutNode>();
      let y = PAD_Y;
      for (const k of keys) {
        const total_ = total.get(k) ?? 0;
        const height = Math.max(2, total_ * scale);
        m.set(k, { key: k, label: label.get(k) ?? k, y, height, total: total_ });
        y += height + GAP;
      }
      return m;
    };
    const srcNodes = mkNodes(srcKeys, srcLabel, srcTotal, scaleSrc);
    const dstNodes = mkNodes(dstKeys, dstLabel, dstTotal, scaleDst);

    const rightX = width - NODE_W;
    // Kursory wypełniania wstęg wzdłuż wysokości każdego węzła.
    const srcCursor = new Map<string, number>();
    const dstCursor = new Map<string, number>();
    const bands: LayoutBand[] = flows.map((f, i) => {
      const sn = srcNodes.get(f.from.pl)!;
      const dn = dstNodes.get(f.to.pl)!;
      const bwSrc = f.value * scaleSrc;
      const bwDst = f.value * scaleDst;
      const sy = (srcCursor.get(f.from.pl) ?? sn.y) + bwSrc / 2;
      const dy = (dstCursor.get(f.to.pl) ?? dn.y) + bwDst / 2;
      srcCursor.set(f.from.pl, (srcCursor.get(f.from.pl) ?? sn.y) + bwSrc);
      dstCursor.set(f.to.pl, (dstCursor.get(f.to.pl) ?? dn.y) + bwDst);
      const x0 = NODE_W;
      const x1 = rightX;
      const mx = (x0 + x1) / 2;
      const d = `M${x0} ${sy} C${mx} ${sy} ${mx} ${dy} ${x1} ${dy}`;
      return {
        d,
        width: Math.max(1, (bwSrc + bwDst) / 2),
        colorSlot: (i % 8) + 1,
        from: sn.label,
        to: dn.label,
        value: f.value,
      };
    });

    return {
      src: [...srcNodes.values()],
      dst: [...dstNodes.values()],
      bands,
      rightX,
      height: H,
    };
  }, [config.flows, config.height, lang, width]);

  if (!layout) {
    return (
      <div
        className={`not-prose my-6 rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground ${className ?? ""}`}
      >
        {t.empty}
      </div>
    );
  }

  const table = (
    <table className={FEATURE_TABLE_CLS.table}>
      <thead>
        <tr>
          <th scope="col" className={FEATURE_TABLE_CLS.th}>
            {t.from}
          </th>
          <th scope="col" className={FEATURE_TABLE_CLS.th}>
            {t.to}
          </th>
          <th scope="col" className={FEATURE_TABLE_CLS.thNum}>
            {t.value}
          </th>
        </tr>
      </thead>
      <tbody>
        {layout.bands.map((b, i) => (
          <tr key={i}>
            <th scope="row" className={`${FEATURE_TABLE_CLS.td} font-medium`}>
              {b.from}
            </th>
            <td className={FEATURE_TABLE_CLS.td}>{b.to}</td>
            <td className={FEATURE_TABLE_CLS.tdNum}>
              {formatChartValue(b.value, lang, config.unit)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <FeatureFrame
      title={config.title}
      description={config.description}
      source={config.source}
      className={className}
      footer={<FeatureDataTable label={t.data}>{table}</FeatureDataTable>}
    >
      <div ref={revealRef} className={revealClassName(state)}>
        <div ref={widthRef} className="relative w-full">
          <svg
            width={width}
            height={layout.height}
            viewBox={`0 0 ${width} ${layout.height}`}
            className="block nes-sankey"
            role="img"
            aria-label={config.title || undefined}
          >
            {/* Wstęgi pod węzłami. */}
            <g>
              {layout.bands.map((b, i) => (
                <path
                  key={i}
                  d={b.d}
                  fill="none"
                  stroke={`var(--chart-${b.colorSlot})`}
                  strokeWidth={b.width}
                  className="nes-sankey-band nes-feature-reveal"
                  data-active={active === i || undefined}
                  data-dim={active !== null && active !== i ? true : undefined}
                  style={{ ["--nes-i" as string]: i }}
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                >
                  <title>
                    {b.from} → {b.to}: {formatChartValue(b.value, lang, config.unit)}
                  </title>
                </path>
              ))}
            </g>
            {/* Węzły + etykiety. */}
            {layout.src.map((n) => (
              <g key={`s-${n.key}`}>
                <rect
                  x={0}
                  y={n.y}
                  width={NODE_W}
                  height={n.height}
                  rx={2}
                  className="nes-sankey-node"
                />
                <text
                  x={NODE_W + 6}
                  y={n.y + n.height / 2}
                  dominantBaseline="middle"
                  className="nes-sankey-label"
                >
                  {n.label}
                </text>
              </g>
            ))}
            {layout.dst.map((n) => (
              <g key={`d-${n.key}`}>
                <rect
                  x={layout.rightX}
                  y={n.y}
                  width={NODE_W}
                  height={n.height}
                  rx={2}
                  className="nes-sankey-node"
                />
                <text
                  x={layout.rightX - 6}
                  y={n.y + n.height / 2}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="nes-sankey-label"
                >
                  {n.label}
                </text>
              </g>
            ))}
          </svg>
        </div>
      </div>
    </FeatureFrame>
  );
}
