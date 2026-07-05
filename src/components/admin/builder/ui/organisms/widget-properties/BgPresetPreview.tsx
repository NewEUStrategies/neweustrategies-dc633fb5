// Full-width live preview for a background preset. Renders a subtle,
// GPU-friendly SVG/CSS animation matching the preset's `animation` key.
// Purely presentational; respects prefers-reduced-motion via the shared
// keyframes (opacity/transform only).
import type { CSSProperties } from "react";
import type { BgPreset, BgAnimationKey } from "./BgPresets";

interface Props {
  preset: BgPreset;
  className?: string;
  style?: CSSProperties;
}

/**
 * Delicate animated layer on top of the preset's base gradient.
 * Each animation kind is intentionally low-contrast and slow (>= 8s)
 * so it reads as "premium ambient" rather than "loading spinner".
 */
function AnimationLayer({ kind, seed }: { kind: BgAnimationKey; seed: string }) {
  if (kind === "aurora") {
    return (
      <svg
        aria-hidden
        viewBox="0 0 400 60"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full"
      >
        <defs>
          <linearGradient id={`au-${seed}`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="rgba(255,255,255,0)" />
            <stop offset="50%" stopColor="rgba(255,255,255,.35)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </linearGradient>
        </defs>
        {[0, 1, 2].map((i) => (
          <path
            key={i}
            d={`M0,${20 + i * 8} Q100,${5 + i * 6} 200,${25 + i * 4} T400,${20 + i * 6}`}
            fill="none"
            stroke={`url(#au-${seed})`}
            strokeWidth={1.2}
            style={{
              transformOrigin: "center",
              animation: `bgp-aurora ${12 + i * 3}s ease-in-out ${i * 1.5}s infinite`,
            }}
          />
        ))}
      </svg>
    );
  }

  if (kind === "mesh-drift") {
    return (
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(40% 80% at 20% 50%, rgba(255,255,255,.10), transparent 70%), radial-gradient(45% 80% at 80% 50%, rgba(255,255,255,.08), transparent 70%)",
          animation: "bgp-mesh 16s ease-in-out infinite alternate",
          mixBlendMode: "screen",
        }}
      />
    );
  }

  if (kind === "floating-dots") {
    // Connected constellation dots + subtle lines.
    const pts = [
      [8, 30],
      [22, 18],
      [36, 40],
      [50, 22],
      [64, 34],
      [78, 20],
      [92, 38],
    ] as const;
    return (
      <svg
        aria-hidden
        viewBox="0 0 100 60"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full"
      >
        <g stroke="rgba(255,255,255,.20)" strokeWidth={0.15} fill="none">
          {pts.slice(0, -1).map(([x, y], i) => {
            const [nx, ny] = pts[i + 1];
            return <line key={i} x1={x} y1={y} x2={nx} y2={ny} />;
          })}
        </g>
        {pts.map(([x, y], i) => (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={0.6}
            fill="rgba(255,255,255,.85)"
            style={{ animation: `bgp-twinkle ${3.5 + (i % 4) * 0.9}s ease-in-out ${i * 0.3}s infinite` }}
          />
        ))}
      </svg>
    );
  }

  if (kind === "wave-lines") {
    return (
      <svg
        aria-hidden
        viewBox="0 0 400 60"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full"
      >
        <g fill="rgba(255,255,255,.10)">
          <path d="M0,40 C80,20 160,60 240,38 C320,18 400,44 480,32 L480,60 L0,60 Z">
            <animateTransform
              attributeName="transform"
              type="translate"
              from="0 0"
              to="-80 0"
              dur="14s"
              repeatCount="indefinite"
            />
          </path>
        </g>
        <g fill="rgba(255,255,255,.06)">
          <path d="M0,46 C80,30 160,62 240,44 C320,28 400,50 480,40 L480,60 L0,60 Z">
            <animateTransform
              attributeName="transform"
              type="translate"
              from="-40 0"
              to="40 0"
              dur="18s"
              repeatCount="indefinite"
            />
          </path>
        </g>
      </svg>
    );
  }

  if (kind === "noise-shimmer") {
    return (
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(rgba(255,255,255,.09) 1px, transparent 1px)",
          backgroundSize: "3px 3px",
          animation: "bgp-shimmer 6s ease-in-out infinite",
          mixBlendMode: "overlay",
        }}
      />
    );
  }

  if (kind === "orbits") {
    return (
      <svg
        aria-hidden
        viewBox="0 0 100 60"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full"
      >
        <g fill="none" stroke="rgba(255,255,255,.18)" strokeWidth={0.15}>
          <ellipse cx="50" cy="30" rx="30" ry="12" />
          <ellipse
            cx="50"
            cy="30"
            rx="40"
            ry="18"
            style={{ transformOrigin: "50% 30%", animation: "bgp-orbit 22s linear infinite" }}
          />
          <ellipse
            cx="50"
            cy="30"
            rx="22"
            ry="9"
            style={{ transformOrigin: "50% 30%", animation: "bgp-orbit-rev 18s linear infinite" }}
          />
        </g>
        <circle cx="50" cy="30" r="0.9" fill="rgba(255,255,255,.9)" />
      </svg>
    );
  }

  return null;
}

export function BgPresetPreview({ preset, className, style }: Props) {
  return (
    <div
      className={`relative w-full h-full overflow-hidden ${className ?? ""}`}
      style={{ background: preset.thumb, ...style }}
    >
      <AnimationLayer kind={preset.animation} seed={preset.id} />
      {/* Inline keyframes so the picker is self-contained. */}
      <style>{`
        @keyframes bgp-aurora {
          0%,100% { transform: translateX(0) scaleY(1); opacity:.75 }
          50%     { transform: translateX(6%) scaleY(1.15); opacity:1 }
        }
        @keyframes bgp-mesh {
          0%   { transform: translate3d(-3%,0,0) }
          100% { transform: translate3d(3%,0,0) }
        }
        @keyframes bgp-twinkle {
          0%,100% { opacity:.25; transform: scale(.9) }
          50%     { opacity:1;   transform: scale(1.25) }
        }
        @keyframes bgp-shimmer {
          0%,100% { opacity:.35 }
          50%     { opacity:.8 }
        }
        @keyframes bgp-orbit {
          from { transform: rotate(0deg) }
          to   { transform: rotate(360deg) }
        }
        @keyframes bgp-orbit-rev {
          from { transform: rotate(360deg) }
          to   { transform: rotate(0deg) }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-bgp-anim] * { animation: none !important }
        }
      `}</style>
    </div>
  );
}
