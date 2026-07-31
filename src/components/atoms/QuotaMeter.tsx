// Atom: dostępny wskaźnik zużycia miesięcznego limitu ("wykorzystano X z N").
// Semantyka WAI-ARIA `role="meter"` (wartość w znanym zakresie) z aria-valuetext,
// więc czytniki ekranu ogłaszają stan słownie, nie procentowo. Prezentacyjnie:
// małe limity (do 12) rysują segment na artykuł - czytelnik widzi dosłownie
// "ile kresek zostało" - większe przechodzą w ciągły pasek. Tonacja wyłącznie
// z tokenów semantycznych (brand / brand-ink / destructive), zero własnych barw.
// Reużywany przez MeterBanner (warstwa treści) i Paywall (wariant exhausted).

type QuotaTone = "ok" | "low" | "exhausted";

/** Tonacja wskaźnika: spokojna, ostrzegawcza (ostatni artykuł / >=80% zużycia), wyczerpana. */
function quotaTone(used: number, limit: number): QuotaTone {
  if (limit <= 0) return "ok";
  const remaining = Math.max(limit - used, 0);
  if (remaining <= 0) return "exhausted";
  return remaining === 1 || used / limit >= 0.8 ? "low" : "ok";
}

const FILL_BY_TONE: Record<QuotaTone, string> = {
  ok: "bg-brand",
  low: "bg-brand-ink",
  exhausted: "bg-destructive",
};

/** Powyżej tej liczby segmenty zlewają się wizualnie - przechodzimy w ciągły pasek. */
const MAX_SEGMENTS = 12;

interface QuotaMeterProps {
  used: number;
  limit: number;
  /** Etykieta wskaźnika dla technologii asystujących (rola meter bez etykiety jest niema). */
  label: string;
  /** Słowny opis wartości, np. "Wykorzystano 2 z 5". */
  valueText: string;
  size?: "sm" | "md";
  className?: string;
}

export function QuotaMeter({
  used,
  limit,
  label,
  valueText,
  size = "sm",
  className,
}: QuotaMeterProps) {
  if (limit <= 0) return null;
  const clampedUsed = Math.min(Math.max(used, 0), limit);
  const tone = quotaTone(clampedUsed, limit);
  const fill = FILL_BY_TONE[tone];
  const heightCls = size === "md" ? "h-2" : "h-1.5";
  const pct = Math.round((clampedUsed / limit) * 100);

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={limit}
      aria-valuenow={clampedUsed}
      aria-valuetext={valueText}
      data-testid="quota-meter"
      data-tone={tone}
      className={className}
    >
      {limit <= MAX_SEGMENTS ? (
        <div className="flex gap-1" aria-hidden="true">
          {Array.from({ length: limit }, (_, i) => (
            <span
              key={i}
              className={[
                heightCls,
                "min-w-0 flex-1 rounded-full transition-colors duration-300 motion-reduce:transition-none",
                i < clampedUsed ? fill : "bg-border",
              ].join(" ")}
            />
          ))}
        </div>
      ) : (
        <div
          className={`${heightCls} w-full overflow-hidden rounded-full bg-border`}
          aria-hidden="true"
        >
          <div
            className={`h-full rounded-full ${fill} transition-[width] duration-500 motion-reduce:transition-none`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
