// Oś czasu (digital feature): pionowa linia z datowanymi wydarzeniami.
// Kanał dostępności: uporządkowana lista <ol> - czytana liniowo przez czytniki
// ekranu, marker jest czysto dekoracyjny. Animacja wejścia współdzieli hook
// useRevealOnScroll (ten sam co wykresy).
import type { TimelineConfig, FeatureLang } from "@/lib/features/types";
import { pickBi } from "@/lib/features/types";
import { useRevealOnScroll, revealClassName } from "@/hooks/useRevealOnScroll";
import { FeatureFrame } from "./FeatureFrame";

const L = {
  pl: { empty: "Brak wydarzeń na osi czasu.", aria: "Oś czasu" },
  en: { empty: "No timeline events.", aria: "Timeline" },
} as const;

interface Props {
  config: TimelineConfig;
  lang: FeatureLang;
  className?: string;
}

export function Timeline({ config, lang, className }: Props) {
  const t = L[lang];
  const { ref, state } = useRevealOnScroll<HTMLOListElement>(config.animate);

  if (config.events.length === 0) {
    return (
      <div
        className={`not-prose my-6 rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground ${className ?? ""}`}
      >
        {t.empty}
      </div>
    );
  }

  return (
    <FeatureFrame
      title={config.title}
      description={config.description}
      source={config.source}
      className={className}
      ariaLabel={t.aria}
    >
      <ol ref={ref} className={`relative ml-3 space-y-0 ${revealClassName(state)}`}>
        {/* Pionowa linia biegnąca przez wszystkie punkty. */}
        <span
          aria-hidden
          className="absolute left-0 top-1 bottom-1 w-px bg-border"
          style={{ transform: "translateX(-0.5px)" }}
        />
        {config.events.map((ev, i) => {
          const color = ev.colorSlot ? `var(--chart-${ev.colorSlot})` : "var(--brand)";
          return (
            <li
              key={i}
              className="nes-feature-reveal relative pl-6 pb-6 last:pb-0"
              style={{ ["--nes-i" as string]: i }}
            >
              <span
                aria-hidden
                className="absolute left-0 top-1 h-2.5 w-2.5 -translate-x-1/2 rounded-full ring-4 ring-card"
                style={{ background: color }}
              />
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground tabular-nums">
                {ev.date}
              </div>
              <div className="mt-0.5 font-display text-base font-semibold leading-snug text-foreground">
                {pickBi(ev.title, lang)}
              </div>
              {pickBi(ev.description, lang) && (
                <p className="mt-1 text-sm text-muted-foreground">{pickBi(ev.description, lang)}</p>
              )}
            </li>
          );
        })}
      </ol>
    </FeatureFrame>
  );
}
