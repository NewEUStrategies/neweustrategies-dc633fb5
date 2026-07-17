// Widget "Interaktywne koło" - do 8 pozycji rozłożonych na okręgu (semi lub
// full). Hover / klik przenosi treść (tytuł + opis) do środka. Ikony to
// dowolne ikony Lucide; kolory, teksty i etykiety są w pełni edytowalne.
// Renderer używa wyłącznie semantycznych tokenów (border/foreground/muted)
// oraz kolorów przekazanych z kontentu widgetu.
import { useMemo, useState, type CSSProperties } from "react";
import * as LucideIcons from "@/lib/lucide-shim";
import type { WidgetNode, WidgetContent } from "@/lib/builder/types";
import { safeUrl, sanitizeHtml } from "@/lib/sanitize";
import { getStr, getNum, type Lang } from "./frame";

type LucideCmp = React.ComponentType<{ size?: number; className?: string; color?: string }>;

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
  // Semi: górny półokrąg — kąty od π do 2π (czyli od lewej do prawej u góry).
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

export function InteractiveCircleWidget({ node, lang }: { node: WidgetNode; lang: Lang }) {
  const c = (node.content ?? {}) as WidgetContent;
  const cRaw = c as unknown as Record<string, unknown>;
  const items = itemsOf(c).slice(0, 8);

  const layout: "semi" | "full" = getStr(c, "layout") === "full" ? "full" : "semi";
  const trigger: "hover" | "click" = getStr(c, "trigger") === "click" ? "click" : "hover";
  const size = Math.max(280, Math.min(900, getNum(c, "size", 480)));
  const itemSize = Math.max(40, Math.min(140, getNum(c, "itemSize", 72)));
  const circleThickness = Math.max(1, Math.min(8, getNum(c, "circleThickness", 2)));

  const circleColor = getStr(c, "circleColor");
  const itemBg = getStr(c, "itemBg");
  const itemColor = getStr(c, "itemColor");
  const activeBg = getStr(c, "activeBg");
  const activeColor = getStr(c, "activeColor");

  const title = loc(cRaw, "title", lang);
  const desc = loc(cRaw, "desc", lang);

  const [active, setActive] = useState(0);

  const positions = useMemo(() => computePositions(items.length, layout), [items.length, layout]);

  const iconReg = LucideIcons as unknown as Record<string, LucideCmp | undefined>;
  const Fallback = LucideIcons.Star as LucideCmp;

  const containerHeight = layout === "semi" ? size * 0.62 : size;

  const activeItem = items[active] ?? items[0];
  const activeTitle = activeItem
    ? loc(activeItem as Record<string, unknown>, "title", lang)
    : title;
  const activeDesc = activeItem ? loc(activeItem as Record<string, unknown>, "desc", lang) : desc;

  return (
    <div className="w-full flex flex-col items-center text-center">
      {title && (
        <h3 className="font-display font-bold text-2xl md:text-3xl mb-2 mt-0 text-foreground">
          {title}
        </h3>
      )}
      {desc && (
        <p
          className="text-sm md:text-base text-muted-foreground max-w-2xl mx-auto mb-6"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(desc) }}
        />
      )}

      <div
        className="relative"
        style={{
          width: "100%",
          maxWidth: size,
          height: containerHeight,
        }}
      >
        {/* Okrąg / półokrąg */}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full pointer-events-none"
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

        {/* Środkowy panel z tytułem/opisem aktywnej pozycji */}
        <div
          className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center justify-center text-center px-6"
          style={{
            top: layout === "semi" ? "62%" : "50%",
            transform: layout === "semi" ? "translate(-50%, -50%)" : "translate(-50%, -50%)",
            width: "min(100%, 22rem)",
          }}
        >
          {activeTitle && (
            <h4 className="font-display font-bold text-xl md:text-2xl text-foreground m-0">
              {activeTitle}
            </h4>
          )}
          {activeDesc && (
            <p
              className="text-sm text-muted-foreground mt-2 mb-0"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(activeDesc) }}
            />
          )}
        </div>

        {/* Pozycje na łuku */}
        {items.map((it, i) => {
          const pos = positions[i];
          if (!pos) return null;
          const isActive = i === active;
          const Icon: LucideCmp = (it.icon && iconReg[it.icon]) || Fallback;
          const label = loc(it as Record<string, unknown>, "label", lang) || `#${i + 1}`;

          const bg = isActive ? activeBg || "hsl(var(--primary))" : itemBg || "hsl(var(--card))";
          const fg = isActive
            ? activeColor || "hsl(var(--primary-foreground))"
            : itemColor || "hsl(var(--primary))";

          const btnStyle: CSSProperties = {
            position: "absolute",
            left: `${pos.x}%`,
            top: `${pos.y}%`,
            transform: "translate(-50%, -50%)",
            width: itemSize,
            height: itemSize,
            background: bg,
            color: fg,
            borderColor: circleColor || "hsl(var(--border))",
          };

          const handleActivate = () => setActive(i);
          const hoverHandlers =
            trigger === "hover" ? { onMouseEnter: handleActivate, onFocus: handleActivate } : {};

          const content = (
            <>
              <Icon size={Math.round(itemSize * 0.32)} />
              <span
                className="text-[11px] font-medium mt-1 leading-tight px-1 truncate max-w-full"
                style={{ color: fg }}
              >
                {label}
              </span>
            </>
          );

          if (it.href) {
            const href = safeUrl(it.href);
            return (
              <a
                key={i}
                href={href}
                style={btnStyle}
                className="rounded-full border shadow-sm flex flex-col items-center justify-center transition-all duration-200 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                onClick={handleActivate}
                {...hoverHandlers}
                aria-label={label}
              >
                {content}
              </a>
            );
          }
          return (
            <button
              key={i}
              type="button"
              style={btnStyle}
              className="rounded-full border shadow-sm flex flex-col items-center justify-center transition-all duration-200 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              onClick={handleActivate}
              {...hoverHandlers}
              aria-label={label}
              aria-pressed={isActive}
            >
              {content}
            </button>
          );
        })}
      </div>
    </div>
  );
}
