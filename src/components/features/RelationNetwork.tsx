// Sieć powiązań - deterministyczny układ kołowy (chord-style): węzły
// rozmieszczone na okręgu, krawędzie jako łuki wygięte ku środkowi, grubość =
// siła powiązania, kolor węzła = grupa. Deterministyczny (kąt z indeksu), więc
// SSR i klient dają identyczny rysunek - żadnej symulacji fizycznej. Najechanie
// na węzeł podświetla jego krawędzie; pełne relacje niesie tabela dostępności.
import { useMemo, useState } from "react";
import type { RelationNetworkConfig, FeatureLang } from "@/lib/features/types";
import { pickBi } from "@/lib/features/types";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { useRevealOnScroll, revealClassName } from "@/hooks/useRevealOnScroll";
import { FeatureFrame, FeatureDataTable, FEATURE_TABLE_CLS } from "./FeatureFrame";

const L = {
  pl: {
    empty: "Brak powiązań do wyświetlenia.",
    a: "Węzeł A",
    b: "Węzeł B",
    strength: "Siła",
    relation: "Relacja",
    data: "Pokaż powiązania",
  },
  en: {
    empty: "No relations to display.",
    a: "Node A",
    b: "Node B",
    strength: "Strength",
    relation: "Relation",
    data: "Show relations",
  },
} as const;

interface Props {
  config: RelationNetworkConfig;
  lang: FeatureLang;
  className?: string;
}

interface Node {
  key: string;
  label: string;
  x: number;
  y: number;
  angle: number;
  colorSlot: number;
}

export function RelationNetwork({ config, lang, className }: Props) {
  const t = L[lang];
  const { ref: widthRef, width } = useContainerWidth<HTMLDivElement>(720);
  const { ref: revealRef, state } = useRevealOnScroll<HTMLDivElement>(config.animate);
  const [active, setActive] = useState<string | null>(null);

  const layout = useMemo(() => {
    // Zbiór węzłów z krawędzi (klucz po tekście PL).
    const keys: string[] = [];
    const label = new Map<string, string>();
    for (const e of config.edges) {
      for (const n of [e.a, e.b]) {
        if (!label.has(n.pl)) {
          keys.push(n.pl);
          label.set(n.pl, pickBi(n, lang));
        }
      }
    }
    if (keys.length === 0) return null;

    // Grupy -> slot koloru (kolejność pojawienia).
    const groupOfNode = new Map<string, string>();
    for (const g of config.groups) groupOfNode.set(g.node.pl, g.group.pl);
    const groupSlot = new Map<string, number>();
    const colorForNode = (k: string): number => {
      const g = groupOfNode.get(k);
      if (!g) return 1;
      if (!groupSlot.has(g)) groupSlot.set(g, (groupSlot.size % 8) + 1);
      return groupSlot.get(g)!;
    };

    const H = config.height;
    const cx = width / 2;
    const cy = H / 2;
    const R = Math.max(40, Math.min(cx, cy) - 70);
    const nodes = new Map<string, Node>();
    keys.forEach((k, i) => {
      const angle = (i / keys.length) * Math.PI * 2 - Math.PI / 2;
      nodes.set(k, {
        key: k,
        label: label.get(k) ?? k,
        x: cx + Math.cos(angle) * R,
        y: cy + Math.sin(angle) * R,
        angle,
        colorSlot: colorForNode(k),
      });
    });

    const edges = config.edges.map((e) => {
      const a = nodes.get(e.a.pl)!;
      const b = nodes.get(e.b.pl)!;
      // Punkt kontrolny przyciągnięty do środka -> łuk (mniej przecięć w oku).
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const qx = mx + (cx - mx) * 0.5;
      const qy = my + (cy - my) * 0.5;
      return {
        aKey: a.key,
        bKey: b.key,
        d: `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${qx.toFixed(1)} ${qy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`,
        width: 0.8 + e.strength * 0.9,
        label: pickBi(e.label, lang),
        strength: e.strength,
        aLabel: a.label,
        bLabel: b.label,
      };
    });

    return { nodes: [...nodes.values()], edges, cx, cy, height: H };
  }, [config.edges, config.groups, config.height, lang, width]);

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
            {t.a}
          </th>
          <th scope="col" className={FEATURE_TABLE_CLS.th}>
            {t.b}
          </th>
          <th scope="col" className={FEATURE_TABLE_CLS.th}>
            {t.relation}
          </th>
          <th scope="col" className={FEATURE_TABLE_CLS.thNum}>
            {t.strength}
          </th>
        </tr>
      </thead>
      <tbody>
        {layout.edges.map((e, i) => (
          <tr key={i}>
            <th scope="row" className={`${FEATURE_TABLE_CLS.td} font-medium`}>
              {e.aLabel}
            </th>
            <td className={FEATURE_TABLE_CLS.td}>{e.bLabel}</td>
            <td className={FEATURE_TABLE_CLS.td}>{e.label}</td>
            <td className={FEATURE_TABLE_CLS.tdNum}>{e.strength}</td>
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
            className="block nes-network"
            role="img"
            aria-label={config.title || undefined}
          >
            <g>
              {layout.edges.map((e, i) => {
                const on = active === null || active === e.aKey || active === e.bKey;
                return (
                  <path
                    key={i}
                    d={e.d}
                    fill="none"
                    className="nes-network-edge nes-feature-reveal"
                    stroke="var(--chart-axis)"
                    strokeWidth={e.width}
                    data-dim={!on || undefined}
                    style={{ ["--nes-i" as string]: i }}
                  >
                    <title>
                      {e.aLabel} — {e.bLabel}
                      {e.label ? ` (${e.label})` : ""}
                    </title>
                  </path>
                );
              })}
            </g>
            <g>
              {layout.nodes.map((n) => {
                const on = active === null || active === n.key;
                // Etykieta po zewnętrznej stronie okręgu (kotwica wg półkola).
                const lx = n.x + Math.cos(n.angle) * 12;
                const ly = n.y + Math.sin(n.angle) * 12;
                const anchor =
                  Math.cos(n.angle) > 0.2 ? "start" : Math.cos(n.angle) < -0.2 ? "end" : "middle";
                return (
                  <g
                    key={n.key}
                    className="nes-network-node"
                    data-dim={!on || undefined}
                    onPointerEnter={() => setActive(n.key)}
                    onPointerLeave={() => setActive(null)}
                    tabIndex={0}
                    onFocus={() => setActive(n.key)}
                    onBlur={() => setActive(null)}
                  >
                    <circle cx={n.x} cy={n.y} r={6} fill={`var(--chart-${n.colorSlot})`} />
                    <text
                      x={lx}
                      y={ly}
                      textAnchor={anchor}
                      dominantBaseline="middle"
                      className="nes-network-label"
                    >
                      {n.label}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      </div>
    </FeatureFrame>
  );
}
