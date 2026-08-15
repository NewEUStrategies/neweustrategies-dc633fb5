// Widget "Interaktywne koło" - do 8 pozycji rozłożonych na okręgu (semi lub
// full). Hover / klik / autoplay przenosi treść (tytuł + opis) do środka.
// Ikony są rozwiązywane przez DynamicIcon (kebab-case z pickera oraz
// PascalCase z legacy defaults), a wszystkie opcje edytora (rozmiary, kolory,
// animacja, autoplay, skala aktywnej pozycji) są w pełni zsynchronizowane
// z rendererem - zmiana w panelu widoczna jest natychmiast w podglądzie.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { WidgetNode, WidgetContent } from "@/lib/builder/types";
import { safeUrl, sanitizeHtml } from "@/lib/sanitize";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
import { getStr, getNum, type Lang } from "./frame";

interface Item {
  icon?: string;
  label_pl?: string;
  label_en?: string;
  title_pl?: string;
  title_en?: string;
  desc_pl?: string;
  desc_en?: string;
  href?: string;
}

function itemsOf(c: WidgetContent): Item[] {
  const raw = (c as Record<string, unknown>).items;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is Item => typeof x === "object" && x !== null && !Array.isArray(x));
}

function loc(v: Record<string, unknown>, key: string, lang: Lang): string {
  const primary = v[`${key}_${lang}`];
  const fallback = v[`${key}_pl`] ?? v[`${key}_en`] ?? v[key];
  const val = typeof primary === "string" && primary ? primary : fallback;
  return typeof val === "string" ? val : "";
}

/**
 * Rozkłada N pozycji na łuku wokół środka. Dla `semi` używamy górnego półkola
 * (kąty od π do 2π), dla `full` - pełnego okręgu. Zwraca pozycje jako procenty
 * względem kontenera 100%×100% (top-left origin), tak by grafika była responsywna.
 */
function computePositions(n: number, layout: "semi" | "full"): { x: number; y: number }[] {
  if (n <= 0) return [];
  const cx = 50;
  const cy = 50;
  const radius = 42;
  const positions: { x: number; y: number }[] = [];
  if (layout === "full") {
    for (let i = 0; i < n; i++) {
      const angle = -Math.PI / 2 + (i / n) * 2 * Math.PI;
      positions.push({
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      });
    }
    return positions;
  }
  // Semi: górny półokrąg - kąty od π do 2π (czyli od lewej do prawej u góry).
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const angle = Math.PI + t * Math.PI;
    positions.push({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  }
  return positions;
}

type AnimationMode = "none" | "rotate" | "pulse";

export function InteractiveCircleWidget({ node, lang }: { node: WidgetNode; lang: Lang }) {
  const c = (node.content ?? {}) as WidgetContent;
  const cRaw = c as unknown as Record<string, unknown>;
  const items = itemsOf(c).slice(0, 8);

  const layout: "semi" | "full" = getStr(c, "layout") === "full" ? "full" : "semi";
  const trigger: "hover" | "click" = getStr(c, "trigger") === "click" ? "click" : "hover";
  const size = Math.max(280, Math.min(900, getNum(c, "size", 480)));
  const itemSize = Math.max(40, Math.min(140, getNum(c, "itemSize", 72)));
  const circleThickness = Math.max(1, Math.min(8, getNum(c, "circleThickness", 2)));
  const activeScale = Math.max(1, Math.min(1.6, getNum(c, "activeScale", 1.15)));
  const animation = ((): AnimationMode => {
    const v = getStr(c, "animation");
    return v === "rotate" || v === "pulse" ? v : "none";
  })();
  const autoplay = getStr(c, "autoplay") === "on";
  const intervalMs = Math.max(1500, Math.min(15000, getNum(c, "intervalMs", 4000)));

  const circleColor = getStr(c, "circleColor");
  const itemBg = getStr(c, "itemBg");
  const itemColor = getStr(c, "itemColor");
  const activeBg = getStr(c, "activeBg");
  const activeColor = getStr(c, "activeColor");

  const title = loc(cRaw, "title", lang);
  const desc = loc(cRaw, "desc", lang);

  const [active, setActive] = useState(0);
  useEffect(() => {
    // Reset gdy zmniejszy się liczba pozycji poniżej aktualnego indeksu.
    if (active > items.length - 1) setActive(0);
  }, [items.length, active]);

  // Autoplay - zatrzymuje się na hover/focus by nie walczyć z użytkownikiem.
  const pausedRef = useRef(false);
  useEffect(() => {
    if (!autoplay || items.length < 2) return;
    const id = window.setInterval(() => {
      if (pausedRef.current) return;
      setActive((i) => (i + 1) % items.length);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [autoplay, intervalMs, items.length]);

  const positions = useMemo(() => computePositions(items.length, layout), [items.length, layout]);

  const containerHeight = layout === "semi" ? size * 0.62 : size;

  // UWAGA na pozorna "poprawke": `title` / `desc` renderuja sie juz wyzej jako
  // naglowek i wstep NAD kolem (bezwarunkowo). Uzycie ich dodatkowo jako
  // fallbacku srodka pokazywaloby ten sam tekst dwa razy na jednym ekranie.
  // Srodek pokazuje wiec tresc aktywnej pozycji, a tresc widgetu tylko wtedy,
  // gdy nie ma zadnej pozycji (stan pusty).
  const activeItem = items[active] ?? items[0];
  const activeTitle = activeItem
    ? loc(activeItem as Record<string, unknown>, "title", lang)
    : title;
  const activeDesc = activeItem ? loc(activeItem as Record<string, unknown>, "desc", lang) : desc;

  const arcCls =
    animation === "rotate" && layout === "full"
      ? "animate-[spin_18s_linear_infinite] origin-center"
      : animation === "pulse"
        ? "animate-pulse"
        : "";

  return (
    <div
      className="w-full flex flex-col items-center text-center"
      onMouseEnter={() => (pausedRef.current = true)}
      onMouseLeave={() => (pausedRef.current = false)}
      onFocusCapture={() => (pausedRef.current = true)}
      onBlurCapture={() => (pausedRef.current = false)}
    >
      {title && <h3 className="font-display mb-2 mt-0 text-foreground">{title}</h3>}
      {desc && (
        <p
          className="cms-post-excerpt max-w-2xl mx-auto mb-6"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(desc) }}
        />
      )}

      <div className="relative" style={{ width: "100%", maxWidth: size, height: containerHeight }}>
        {/* Circle / semicircle */}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className={`absolute inset-0 w-full h-full pointer-events-none ${arcCls}`}
          aria-hidden
        >
          {layout === "full" ? (
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke={circleColor || "currentColor"}
              strokeWidth={circleThickness}
              vectorEffect="non-scaling-stroke"
              style={circleColor ? undefined : { color: "hsl(var(--border))" }}
            />
          ) : (
            <path
              d="M 8 50 A 42 42 0 0 1 92 50"
              fill="none"
              stroke={circleColor || "currentColor"}
              strokeWidth={circleThickness}
              vectorEffect="non-scaling-stroke"
              style={circleColor ? undefined : { color: "hsl(var(--border))" }}
            />
          )}
        </svg>

        {/* Center panel with the active item's title/description (animowany crossfade). */}
        <div
          className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center justify-center text-center px-6"
          style={{
            top: layout === "semi" ? "62%" : "50%",
            transform: "translate(-50%, -50%)",
            width: "min(100%, 22rem)",
          }}
        >
          <div
            key={`${active}-${activeTitle}`}
            className="animate-fade-in"
            style={{ animationDuration: "260ms" }}
          >
            {activeTitle && <h4 className="font-display text-foreground m-0">{activeTitle}</h4>}
            {activeDesc && (
              <p
                className="cms-post-excerpt mt-2 mb-0"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(activeDesc) }}
              />
            )}
          </div>
        </div>

        {/* Items along the arc */}
        {items.map((it, i) => {
          const pos = positions[i];
          if (!pos) return null;
          const isActive = i === active;
          const iconName = it.icon || "star";
          const label = loc(it as Record<string, unknown>, "label", lang) || `#${i + 1}`;

          const bg = isActive ? activeBg || "hsl(var(--primary))" : itemBg || "hsl(var(--card))";
          const fg = isActive
            ? activeColor || "hsl(var(--primary-foreground))"
            : itemColor || "hsl(var(--primary))";

          const btnStyle: CSSProperties = {
            position: "absolute",
            left: `${pos.x}%`,
            top: `${pos.y}%`,
            width: itemSize,
            height: itemSize,
            background: bg,
            color: fg,
            borderColor: circleColor || "hsl(var(--border))",
            transform: `translate(-50%, -50%) scale(${isActive ? activeScale : 1})`,
            transition:
              "transform 300ms cubic-bezier(.2,.8,.2,1), background-color 220ms ease, color 220ms ease, box-shadow 220ms ease",
            boxShadow: isActive
              ? `0 10px 24px -8px color-mix(in oklab, ${activeBg || "hsl(var(--primary))"} 55%, transparent), 0 0 0 4px color-mix(in oklab, ${activeBg || "hsl(var(--primary))"} 18%, transparent)`
              : "0 1px 2px rgba(0,0,0,.06)",
            zIndex: isActive ? 2 : 1,
          };

          const handleActivate = () => setActive(i);
          const hoverHandlers =
            trigger === "hover" ? { onMouseEnter: handleActivate, onFocus: handleActivate } : {};

          const inner = (
            <>
              {animation === "pulse" && isActive && (
                <span
                  aria-hidden
                  className="absolute inset-0 rounded-full animate-ping"
                  style={{
                    background: activeBg || "hsl(var(--primary))",
                    opacity: 0.35,
                  }}
                />
              )}
              <DynamicIcon name={iconName} size={Math.round(itemSize * 0.32)} aria-hidden />
              <span
                className="cms-meta mt-1 px-1 truncate max-w-full relative"
                style={{ color: fg }}
              >
                {label}
              </span>
            </>
          );

          const commonCls =
            "relative rounded-full border flex flex-col items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

          if (it.href) {
            const href = safeUrl(it.href);
            return (
              <a
                key={i}
                href={href}
                style={btnStyle}
                className={commonCls}
                onClick={handleActivate}
                {...hoverHandlers}
                aria-label={label}
              >
                {inner}
              </a>
            );
          }
          return (
            <button
              key={i}
              type="button"
              style={btnStyle}
              className={commonCls}
              onClick={handleActivate}
              {...hoverHandlers}
              aria-label={label}
              aria-pressed={isActive}
            >
              {inner}
            </button>
          );
        })}
      </div>
    </div>
  );
}
