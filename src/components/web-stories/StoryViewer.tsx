// Fullscreen Web Story viewer: progress bars, autoplay, tap left/right,
// keyboard arrows, ESC close. Supports image / video / color backgrounds.
import { useEffect, useRef, useState, useCallback } from "react";
import { X, ChevronLeft, ChevronRight, Pause, Play } from "@/lib/lucide-shim";
import type { StoryPage } from "@/lib/web-stories/types";
import { pageCaption, pageCtaLabel, pageTitle } from "@/lib/web-stories/types";

interface Props {
  pages: StoryPage[];
  lang: "pl" | "en";
  onClose?: () => void;
  startIndex?: number;
}

export function StoryViewer({ pages, lang, onClose, startIndex = 0 }: Props) {
  const [idx, setIdx] = useState(Math.min(Math.max(0, startIndex), Math.max(0, pages.length - 1)));
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);
  const elapsedAtPauseRef = useRef<number>(0);

  const cur = pages[idx];
  const durationMs = Math.max(2, cur?.duration_seconds ?? 6) * 1000;

  const next = useCallback(() => {
    if (idx >= pages.length - 1) {
      onClose?.();
      return;
    }
    setIdx((i) => i + 1);
  }, [idx, pages.length, onClose]);

  const prev = useCallback(() => {
    setIdx((i) => Math.max(0, i - 1));
  }, []);

  // autoplay loop
  useEffect(() => {
    setProgress(0);
    elapsedAtPauseRef.current = 0;
    startedAtRef.current = performance.now();
    let active = true;
    const tick = (t: number) => {
      if (!active) return;
      if (paused) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const elapsed = t - startedAtRef.current + elapsedAtPauseRef.current;
      const p = Math.min(1, elapsed / durationMs);
      setProgress(p);
      if (p >= 1) {
        next();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      active = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [idx, paused, durationMs, next]);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === " ") {
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, onClose]);

  // pause toggle preserves elapsed
  useEffect(() => {
    if (paused) {
      elapsedAtPauseRef.current =
        elapsedAtPauseRef.current + (performance.now() - startedAtRef.current);
    } else {
      startedAtRef.current = performance.now();
    }
  }, [paused]);

  if (!cur) return null;

  const title = pageTitle(cur, lang);
  const caption = pageCaption(cur, lang);
  const ctaLabel = pageCtaLabel(cur, lang);
  const posClass =
    cur.text_position === "top"
      ? "top-16 bottom-auto"
      : cur.text_position === "center"
        ? "top-1/2 -translate-y-1/2 bottom-auto"
        : "bottom-10 top-auto";
  const alignClass =
    cur.text_align === "center"
      ? "text-center items-center"
      : cur.text_align === "right"
        ? "text-right items-end"
        : "text-left items-start";

  return (
    <div
      className="fixed inset-0 z-[100] bg-black text-white flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={lang === "en" ? "Web story" : "Historia"}
    >
      {/* Background */}
      <div className="absolute inset-0">
        {cur.background === "video" && cur.media_url ? (
          <video
            key={cur.id}
            src={cur.media_url}
            poster={cur.poster_url || undefined}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover"
          />
        ) : cur.background === "color" ? (
          <div className="w-full h-full" style={{ background: cur.color }} />
        ) : cur.media_url ? (
          <img src={cur.media_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-neutral-900" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/40 pointer-events-none" />
      </div>

      {/* Progress bars */}
      <div className="absolute top-3 left-3 right-3 flex gap-1 z-10">
        {pages.map((_, i) => (
          <div key={i} className="flex-1 h-0.5 bg-white/25 rounded overflow-hidden">
            <div
              className="h-full bg-white"
              style={{ width: i < idx ? "100%" : i === idx ? `${progress * 100}%` : "0%" }}
            />
          </div>
        ))}
      </div>

      {/* Top controls */}
      <div className="absolute top-6 right-3 flex gap-2 z-20">
        <button
          aria-label={
            paused ? (lang === "en" ? "Resume" : "Wznów") : lang === "en" ? "Pause" : "Pauza"
          }
          onClick={() => setPaused((p) => !p)}
          className="w-9 h-9 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center"
        >
          {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
        </button>
        <button
          aria-label={lang === "en" ? "Close" : "Zamknij"}
          onClick={() => onClose?.()}
          className="w-9 h-9 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tap zones */}
      <button
        aria-label={lang === "en" ? "Previous" : "Poprzednia"}
        onClick={prev}
        className="absolute left-0 top-0 bottom-0 w-1/3 z-10 flex items-center justify-start pl-2 opacity-0 hover:opacity-100 transition"
      >
        <ChevronLeft className="w-8 h-8" />
      </button>
      <button
        aria-label={lang === "en" ? "Next" : "Następna"}
        onClick={next}
        className="absolute right-0 top-0 bottom-0 w-1/3 z-10 flex items-center justify-end pr-2 opacity-0 hover:opacity-100 transition"
      >
        <ChevronRight className="w-8 h-8" />
      </button>

      {/* Caption */}
      <div className={`absolute left-6 right-6 z-10 flex flex-col gap-2 ${posClass} ${alignClass}`}>
        {title && (
          <h2 className="font-display text-2xl md:text-3xl drop-shadow-lg max-w-xl">{title}</h2>
        )}
        {caption && (
          <p className="text-sm md:text-base text-white/90 max-w-xl drop-shadow">{caption}</p>
        )}
        {ctaLabel && cur.cta_href && (
          <a
            href={cur.cta_href}
            className="mt-2 inline-flex px-4 py-2 rounded-full bg-white text-black text-sm font-medium hover:bg-white/90"
            target={cur.cta_href.startsWith("http") ? "_blank" : undefined}
            rel="noopener noreferrer"
          >
            {ctaLabel}
          </a>
        )}
      </div>
    </div>
  );
}
