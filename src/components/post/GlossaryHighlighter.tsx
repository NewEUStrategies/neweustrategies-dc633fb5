// Auto-podlinkowanie słowniczka (A7): pierwsze wystąpienie każdego terminu
// w treści wpisu dostaje kropkowane podkreślenie + tooltip z definicją
// (mechanika dymków jak FootnoteTooltips - handlery capture na kontenerze,
// jeden overlay). Działa na WYRENDEROWANYM DOM, więc obejmuje wszystkie
// silniki treści (bloki, builder, richtext) bez modyfikowania rendererów.
//
// Zasady oznaczania:
//   - tylko pierwsze wystąpienie terminu w artykule (bez "choinki"),
//   - dopasowanie bez rozróżniania wielkości liter, na granicach słów
//     (litery/cyfry po obu stronach dyskwalifikują - "TSI" nie łapie "eTSI"),
//   - pomijamy linki, kod, nagłówki i istniejące oznaczenia,
//   - terminy dłuższe najpierw (zachłannie - "akt delegowany" przed "akt").
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { glossaryTermsQueryOptions, type GlossaryTerm } from "@/lib/queries/glossary";

const SKIP_CLOSEST = "a, code, pre, h1, h2, h3, h4, [data-glossary-term], [data-fn]";
/** Znak "słowotwórczy" - litera/cyfra Unicode (granice dopasowania). */
const WORDish = /[\p{L}\p{N}]/u;

function markFirstOccurrences(root: HTMLElement, terms: GlossaryTerm[], lang: "pl" | "en"): void {
  const remaining = new Map<string, GlossaryTerm>();
  for (const term of terms) {
    const label = (lang === "en" ? term.term_en || term.term_pl : term.term_pl).trim();
    if (label.length >= 2) remaining.set(label.toLowerCase(), term);
  }
  if (remaining.size === 0) return;
  // Dłuższe terminy mają pierwszeństwo w obrębie jednego węzła tekstowego.
  const ordered = () => [...remaining.keys()].sort((a, b) => b.length - a.length);

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (!node.textContent || node.textContent.trim().length < 2) {
        return NodeFilter.FILTER_REJECT;
      }
      const parent = node.parentElement;
      if (!parent || parent.closest(SKIP_CLOSEST)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) textNodes.push(n as Text);

  for (const textNode of textNodes) {
    if (remaining.size === 0) break;
    let node: Text | null = textNode;
    // Po każdym oznaczeniu kontynuujemy w "ogonie" podzielonego węzła.
    while (node && remaining.size > 0) {
      const text = node.textContent ?? "";
      const lower = text.toLowerCase();
      let hit: { key: string; index: number } | null = null;
      for (const key of ordered()) {
        let from = 0;
        while (from <= lower.length - key.length) {
          const idx = lower.indexOf(key, from);
          if (idx === -1) break;
          const before = idx > 0 ? text[idx - 1] : "";
          const after = idx + key.length < text.length ? text[idx + key.length] : "";
          if (!WORDish.test(before) && !WORDish.test(after)) {
            if (!hit || idx < hit.index) hit = { key, index: idx };
            break;
          }
          from = idx + 1;
        }
      }
      if (!hit) break;
      const term = remaining.get(hit.key);
      remaining.delete(hit.key);
      if (!term) break;
      const range = node.splitText(hit.index);
      const tail = range.splitText(hit.key.length);
      const span = document.createElement("span");
      span.dataset.glossaryTerm = term.slug;
      span.className = "glossary-term";
      span.tabIndex = 0;
      range.parentNode?.replaceChild(span, range);
      span.appendChild(range);
      node = tail;
    }
  }
}

/** Zdejmuje oznaczenia (cleanup przy zmianie języka/artykułu). */
function unmarkAll(root: HTMLElement): void {
  for (const span of [...root.querySelectorAll("span[data-glossary-term]")]) {
    const parent = span.parentNode;
    if (!parent) continue;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
    parent.normalize();
  }
}

export function GlossaryHighlighter({
  containerRef,
  lang,
  scanKey,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  lang: "pl" | "en";
  /** Zmiana klucza (wpis/język) wymusza ponowny skan. */
  scanKey: string;
}) {
  const { data: terms } = useQuery(glossaryTermsQueryOptions());
  const [active, setActive] = useState<{ slug: string; x: number; y: number } | null>(null);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || !terms || terms.length === 0) return;
    // Poczekaj aż strumieniowane sekcje się ustabilizują (jeden rAF wystarcza
    // dla SSR-hydratacji; treść lazy dostreamowana zostanie pominięta - trade
    // świadomy: skan raz, bez MutationObservera na gorącej ścieżce czytania).
    const raf = window.requestAnimationFrame(() => markFirstOccurrences(root, terms, lang));
    return () => {
      window.cancelAnimationFrame(raf);
      unmarkAll(root);
    };
  }, [containerRef, terms, lang, scanKey]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const enter = (e: Event) => {
      const el = (e.target as Element).closest?.("span[data-glossary-term]") as HTMLElement | null;
      if (!el) return;
      if (hideTimer.current) {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
      const rect = el.getBoundingClientRect();
      setActive({
        slug: el.dataset.glossaryTerm ?? "",
        x: rect.left + rect.width / 2,
        y: rect.top,
      });
    };
    const leave = () => {
      hideTimer.current = window.setTimeout(() => setActive(null), 200);
    };
    root.addEventListener("mouseenter", enter, true);
    root.addEventListener("focusin", enter, true);
    root.addEventListener("mouseleave", leave, true);
    root.addEventListener("focusout", leave, true);
    return () => {
      root.removeEventListener("mouseenter", enter, true);
      root.removeEventListener("focusin", enter, true);
      root.removeEventListener("mouseleave", leave, true);
      root.removeEventListener("focusout", leave, true);
    };
  }, [containerRef]);

  if (!active || !terms) return null;
  const term = terms.find((item) => item.slug === active.slug);
  if (!term) return null;
  const label = lang === "en" ? term.term_en || term.term_pl : term.term_pl;
  const definition = lang === "en" ? term.definition_en || term.definition_pl : term.definition_pl;

  return (
    <div
      role="tooltip"
      data-glossary-tooltip
      className="pointer-events-none fixed z-50 max-w-sm rounded-md border border-border bg-popover text-popover-foreground text-xs leading-snug px-3 py-2 shadow-lg -translate-x-1/2 -translate-y-full"
      style={{ left: active.x, top: active.y - 8 }}
    >
      <p className="font-semibold mb-0.5">{label}</p>
      <p>{definition}</p>
      <p className="mt-1 text-[10px] text-muted-foreground">
        <Link to="/glossary" className="pointer-events-auto underline underline-offset-2">
          {lang === "en" ? "Glossary" : "Słowniczek"}
        </Link>
      </p>
    </div>
  );
}
