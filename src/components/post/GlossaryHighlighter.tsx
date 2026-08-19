// Auto-podlinkowanie słowniczka (A7): pierwsze wystąpienie każdego terminu
// w treści wpisu dostaje kropkowane podkreślenie + tooltip z definicją
// (mechanika dymków jak FootnoteTooltips - handlery capture na kontenerze,
// jeden overlay). Działa na WYRENDEROWANYM DOM, więc obejmuje wszystkie
// silniki treści (bloki, builder, richtext) bez modyfikowania rendererów.
//
// Ten plik jest ORGANIZMEM: spina warstwę danych (query słowniczka) z regułą
// oznaczania i z prezentacją dymka. Sama reguła - chodzenie po węzłach
// tekstowych artykułu i ich podmiana - żyje w czystym module
// `lib/post/glossaryHighlight` i tam jest testowana (granice słów, linki,
// nagłówki, runda mark -> unmark bajt w bajt).
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { glossaryTermsQueryOptions } from "@/lib/queries/glossary";
import { glossaryLabels, markFirstOccurrences, unmarkAll } from "@/lib/post/glossaryHighlight";

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

  const labels = useMemo(() => glossaryLabels(terms ?? [], lang), [terms, lang]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || labels.length === 0) return;
    // Poczekaj aż strumieniowane sekcje się ustabilizują (jeden rAF wystarcza
    // dla SSR-hydratacji; treść lazy dostreamowana zostanie pominięta - trade
    // świadomy: skan raz, bez MutationObservera na gorącej ścieżce czytania).
    const raf = window.requestAnimationFrame(() => markFirstOccurrences(root, labels));
    return () => {
      window.cancelAnimationFrame(raf);
      unmarkAll(root);
    };
  }, [containerRef, labels, scanKey]);

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
