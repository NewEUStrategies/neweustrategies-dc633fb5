// Hero background variants for archive layouts. Pure CSS/SVG, token-driven.
import type { HeroBgStyle } from "@/lib/archive-layout-settings";
import { heroImageBackground } from "@/lib/archive/heroImage";

export function HeroBackground({
  style,
  imageUrl,
  className = "",
}: {
  style: HeroBgStyle;
  imageUrl?: string | null;
  className?: string;
}) {
  const base = `absolute inset-0 -z-10 ${className}`;
  switch (style) {
    case "gradient":
      return (
        <div
          className={base}
          style={{
            background:
              "linear-gradient(135deg, color-mix(in oklab, var(--brand) 18%, transparent), color-mix(in oklab, var(--brand) 3%, transparent) 60%, transparent)",
          }}
        />
      );
    case "solid":
      return <div className={`${base} bg-muted/30`} />;
    case "image": {
      // Adres NIGDY nie trafia do CSS surowo: `heroImageBackground` sprawdza go
      // regułą lustrzaną do CHECK-u bazy i składa cytowany, escapowany
      // `url("…")`. Wcześniej stało tu `url(${imageUrl})` - nawias albo
      // cudzysłów w adresie rozrywał deklarację. Brak adresu albo adres spoza
      // reguły (`javascript:`, `data:`, '//host') schodzi na neutralne tło.
      // Obie warstwy są czysto dekoracyjne (tekst nagłówka stoi nad nimi), więc
      // bez `alt` i ukryte przed czytnikiem ekranu.
      const backgroundImage = heroImageBackground(imageUrl);
      return backgroundImage ? (
        <>
          <div
            aria-hidden
            data-hero-image=""
            className={base}
            style={{
              backgroundImage,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
          <div aria-hidden className={`${base} bg-background/60 backdrop-blur-sm`} />
        </>
      ) : (
        <div aria-hidden className={`${base} bg-muted/30`} />
      );
    }
    case "mesh":
      return (
        <div
          className={base}
          style={{
            background:
              "radial-gradient(600px 300px at 15% 20%, color-mix(in oklab, var(--brand) 25%, transparent), transparent 70%), radial-gradient(500px 260px at 85% 60%, color-mix(in oklab, var(--brand) 15%, transparent), transparent 70%)",
          }}
        />
      );
    case "pattern":
      return (
        <div className={base}>
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" aria-hidden>
            <defs>
              <pattern id="alp-grid" width="32" height="32" patternUnits="userSpaceOnUse">
                <path
                  d="M32 0H0V32"
                  fill="none"
                  stroke="currentColor"
                  strokeOpacity="0.08"
                  strokeWidth="1"
                />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#alp-grid)" />
          </svg>
        </div>
      );
    case "minimal":
    default:
      return <div className={`${base} bg-background`} />;
  }
}
