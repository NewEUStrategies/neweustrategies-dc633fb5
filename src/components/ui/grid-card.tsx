// Card shell with a soft, masked grid backdrop (6px rounding, semantic tokens).
// The highlighted squares are derived deterministically from a seed string so
// SSR and hydration render the identical SVG (Math.random would mismatch).
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { GridPattern } from "@/components/ui/grid-pattern";

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Deterministic square coordinates for the decorative pattern. */
export function seededPattern(seed: string, length = 5): Array<[x: number, y: number]> {
  const base = hashSeed(seed);
  return Array.from({ length }, (_, i) => {
    const a = hashSeed(`${seed}:${i}`) + base;
    return [(a % 4) + 7, (Math.floor(a / 4) % 6) + 1] as [number, number];
  });
}

export interface GridCardProps {
  className?: string;
  children?: ReactNode;
  /** Seed for the decorative pattern - keep stable per card (e.g. the title). */
  seed?: string;
}

export function GridCard({ className, children, seed = "grid-card" }: GridCardProps) {
  return (
    <div
      className={cn(
        "relative isolate overflow-hidden rounded-[6px] border border-border bg-card transition-colors hover:border-brand/50",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-70">
        <GridPattern
          width={20}
          height={20}
          squares={seededPattern(seed)}
          className="[mask-image:radial-gradient(220px_circle_at_top_right,white,transparent)]"
        />
      </div>
      {children}
    </div>
  );
}
