// Atom: link z hover-podglądem (Radix HoverCard + CSS, bez framer-motion).
// Respektuje `prefers-reduced-motion`, ładuje obrazek dopiero po otwarciu.

import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import { useCallback, useId, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface LinkPreviewProps {
  children: ReactNode;
  url: string;
  imageSrc: string;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
  /** Wyłączone => zwykły link (opcjonalna funkcjonalność). */
  enabled?: boolean;
  openDelay?: number;
  closeDelay?: number;
}

export function LinkPreview({
  children,
  url,
  imageSrc,
  alt,
  width = 200,
  height = 125,
  className,
  enabled = true,
  openDelay = 60,
  closeDelay = 100,
}: LinkPreviewProps) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const offsetRef = useRef<HTMLSpanElement | null>(null);
  const describedBy = useId();

  const handleMouseMove = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const offsetFromCenter = (event.clientX - rect.left - rect.width / 2) / 2;
    offsetRef.current?.style.setProperty("--lp-offset-x", `${offsetFromCenter.toFixed(1)}px`);
  }, []);

  const anchorClass = cn(
    "text-primary underline underline-offset-4 decoration-primary/40 transition-colors hover:decoration-primary",
    className,
  );

  if (!enabled) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className={anchorClass}>
        {children}
      </a>
    );
  }

  return (
    <HoverCardPrimitive.Root
      openDelay={openDelay}
      closeDelay={closeDelay}
      open={open}
      onOpenChange={setOpen}
    >
      <HoverCardPrimitive.Trigger asChild>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={anchorClass}
          onMouseMove={handleMouseMove}
          aria-describedby={open ? describedBy : undefined}
        >
          {children}
        </a>
      </HoverCardPrimitive.Trigger>
      <HoverCardPrimitive.Portal>
        <HoverCardPrimitive.Content
          id={describedBy}
          side="top"
          align="center"
          sideOffset={10}
          className="z-50 outline-none"
        >
          <span
            ref={offsetRef}
            data-link-preview-card=""
            className={cn(
              "block overflow-hidden rounded-[var(--radius)] border border-border bg-card p-1 shadow-lg",
              "translate-x-[var(--lp-offset-x,0px)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95",
            )}
          >
            <img
              src={imageSrc}
              alt={alt}
              width={width}
              height={height}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onLoad={() => setLoaded(true)}
              className={cn(
                "block rounded-[calc(var(--radius)-2px)] bg-muted object-cover transition-opacity duration-200",
                loaded ? "opacity-100" : "opacity-0",
              )}
              style={{ width, height }}
            />
          </span>
        </HoverCardPrimitive.Content>
      </HoverCardPrimitive.Portal>
    </HoverCardPrimitive.Root>
  );
}
