// Animowany licznik (Elementor "counter"): liczba rozwija się z 0 do
// wartości docelowej w czasie trwania animacji przy pierwszym wejściu w
// viewport. Respektuje prefers-reduced-motion (statyczna wartość) oraz
// i18n etykiety (label_pl/label_en).
import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import type { WidgetContent } from "@/lib/builder/types";
import { getStr, getNum, type Lang } from "./frame";

interface CounterWidgetProps {
  content: WidgetContent;
  lang: Lang;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function formatNumber(value: number, delimiter: string): string {
  const rounded = Math.round(value);
  if (!delimiter) return String(rounded);
  return String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, delimiter);
}

export function CounterWidget({ content, lang }: CounterWidgetProps): ReactElement {
  const target = Math.max(0, getNum(content, "value", 0));
  const from = Math.max(0, getNum(content, "from", 0));
  const duration = Math.max(200, getNum(content, "durationMs", 2000));
  const prefix = getStr(content, "prefix");
  const suffix = getStr(content, "suffix");
  const delimiter = getStr(content, "delimiter") || ",";
  const label =
    getStr(content, lang === "pl" ? "label_pl" : "label_en") ||
    getStr(content, "label_pl") ||
    getStr(content, "label_en");
  const alignRaw = getStr(content, "align") || "center";
  const align: "left" | "center" | "right" =
    alignRaw === "left" ? "left" : alignRaw === "right" ? "right" : "center";
  const accent = getStr(content, "accentColor");
  const numberSize = Math.max(20, getNum(content, "numberSize", 72));
  const labelSize = Math.max(10, getNum(content, "labelSize", 14));

  const [display, setDisplay] = useState<number>(from);
  const ref = useRef<HTMLDivElement | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setDisplay(target);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || startedRef.current) continue;
          startedRef.current = true;
          const start = performance.now();
          let raf = 0;
          const tick = (now: number) => {
            const t = Math.min(1, (now - start) / duration);
            setDisplay(from + (target - from) * easeOutCubic(t));
            if (t < 1) raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
          observer.disconnect();
          return () => cancelAnimationFrame(raf);
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [from, target, duration]);

  const style: CSSProperties = {
    textAlign: align,
    color: accent || undefined,
  };

  return (
    <div ref={ref} className="w-full py-4" style={style}>
      <div
        className="font-bold leading-none tabular-nums"
        style={{ fontSize: `${numberSize}px`, color: accent || undefined, fontFamily: "inherit" }}
        aria-label={`${prefix}${target}${suffix}${label ? ` ${label}` : ""}`}
      >
        {prefix}
        {formatNumber(display, delimiter)}
        {suffix}
      </div>
      {label ? (
        <div
          className="mt-2 uppercase tracking-wider text-muted-foreground"
          style={{ fontSize: `${labelSize}px`, fontFamily: "inherit" }}
        >
          {label}
        </div>
      ) : null}
    </div>
  );
}
