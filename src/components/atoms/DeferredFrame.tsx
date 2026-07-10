// Atom: <DeferredFrame> - viewport-deferred <iframe> host.
//
// Third-party embeds (OpenStreetMap / Google Maps) are among the heaviest
// things a page can load: each iframe boots a whole document with its own JS.
// `loading="lazy"` alone still lets some engines fetch early and always pays
// the subframe cost the moment it is near. This atom renders a zero-cost,
// box-reserving placeholder during SSR/first paint and mounts the real iframe
// only when the reader scrolls close (600px lookahead), so the embed is ready
// by the time it becomes visible - same UX, none of the upfront cost.
//
// CLS-safe: the wrapper carries the exact final size (style/className), and
// the placeholder + iframe both fill it absolutely.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

interface DeferredFrameProps {
  src: string;
  title: string;
  /** Wrapper sizing - give it the iframe's final box (height or aspect). */
  className?: string;
  style?: CSSProperties;
  /** Extra iframe attributes. */
  referrerPolicy?: React.HTMLAttributeReferrerPolicy;
  allowFullScreen?: boolean;
  /** Lookahead margin before the frame mounts. */
  rootMargin?: string;
  /** Placeholder content (icon/label) shown until the frame mounts. */
  placeholder?: ReactNode;
}

export function DeferredFrame({
  src,
  title,
  className,
  style,
  referrerPolicy,
  allowFullScreen,
  rootMargin = "600px 0px",
  placeholder,
}: DeferredFrameProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (mounted) return;
    const node = hostRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setMounted(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setMounted(true);
          obs.disconnect();
        }
      },
      { rootMargin },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [mounted, rootMargin]);

  return (
    <div ref={hostRef} className={`relative ${className ?? ""}`.trim()} style={style}>
      {mounted ? (
        <iframe
          src={src}
          title={title}
          loading="lazy"
          referrerPolicy={referrerPolicy}
          allowFullScreen={allowFullScreen}
          className="absolute inset-0 h-full w-full border-0"
        />
      ) : (
        <div
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center bg-muted/60 text-muted-foreground"
        >
          {placeholder}
        </div>
      )}
    </div>
  );
}
