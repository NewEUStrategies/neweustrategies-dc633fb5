// Six subtle background animation variants for the contact-form widget.
// All are GPU-friendly (transform/opacity), respect prefers-reduced-motion,
// and adapt to light/dark via currentColor + CSS vars from the host.
import type { CSSProperties } from "react";

export type ContactBgVariant =
  | "none" | "aurora" | "mesh-drift" | "floating-dots"
  | "wave-lines" | "noise-shimmer" | "orbits";

export function ContactFormBackground({ variant, style }: { variant: ContactBgVariant; style?: CSSProperties }) {
  if (!variant || variant === "none") return null;
  const base: CSSProperties = {
    position: "absolute", inset: 0, overflow: "hidden",
    pointerEvents: "none", borderRadius: "inherit", ...style,
  };

  if (variant === "aurora") {
    return (
      <div className="cf-bg cf-bg--aurora" style={base} aria-hidden>
        <span /><span /><span />
      </div>
    );
  }
  if (variant === "mesh-drift") {
    return <div className="cf-bg cf-bg--mesh" style={base} aria-hidden />;
  }
  if (variant === "floating-dots") {
    return (
      <div className="cf-bg cf-bg--dots" style={base} aria-hidden>
        {Array.from({ length: 18 }).map((_, i) => (
          <span key={i} style={{
            left: `${(i * 53) % 100}%`,
            top: `${(i * 37) % 100}%`,
            animationDelay: `${(i * 0.6) % 8}s`,
            animationDuration: `${10 + (i % 6) * 2}s`,
          }} />
        ))}
      </div>
    );
  }
  if (variant === "wave-lines") {
    return (
      <div className="cf-bg cf-bg--waves" style={base} aria-hidden>
        <svg viewBox="0 0 1200 400" preserveAspectRatio="none" width="100%" height="100%">
          <path d="M0,220 C300,160 600,280 1200,200 L1200,400 L0,400 Z" />
          <path d="M0,260 C300,200 600,320 1200,240 L1200,400 L0,400 Z" opacity="0.6" />
          <path d="M0,300 C300,240 600,360 1200,280 L1200,400 L0,400 Z" opacity="0.35" />
        </svg>
      </div>
    );
  }
  if (variant === "noise-shimmer") {
    return <div className="cf-bg cf-bg--shimmer" style={base} aria-hidden />;
  }
  if (variant === "orbits") {
    return (
      <div className="cf-bg cf-bg--orbits" style={base} aria-hidden>
        <span /><span /><span /><span />
      </div>
    );
  }
  return null;
}
