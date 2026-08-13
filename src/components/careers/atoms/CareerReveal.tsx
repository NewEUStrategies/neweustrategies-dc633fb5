// Atom: wejście sekcji przy scrollu. Sam wrapper NIE ukrywa treści - klasa
// `crs-reveal` chowa element wyłącznie pod `@media (scripting: enabled)` i przy
// braku `prefers-reduced-motion` (patrz styles.css), więc czytelnik bez JS,
// crawler i osoba z ograniczonym ruchem zawsze widzą stan końcowy.
import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";
import { useInView } from "@/hooks/use-in-view";

export function CareerReveal({
  children,
  className,
  /** Numer porządkowy w grupie - przesuwa start animacji (stagger). */
  index = 0,
}: {
  children: ReactNode;
  className?: string;
  index?: number;
}) {
  const { ref, inView } = useInView<HTMLDivElement>({ rootMargin: "0px 0px -8% 0px" });
  return (
    <div
      ref={ref}
      className={cn("crs-reveal", inView && "crs-reveal--in", className)}
      style={{ "--crs-delay": `${Math.min(index, 8) * 70}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}
