// Box "Cytuj tę analizę" pod wpisem - trzy formaty (Chicago 17, APA 7, BibTeX)
// z kopiowaniem do schowka. Czysto prezentacyjny: całe formatowanie mieszka w
// src/lib/citations/format.ts (testowane jednostkowo), a dane wchodzą propsami.
//
// Data dostępu (urldate w BibTeX, "Udostępniono" przy braku daty publikacji)
// jest dokładana dopiero PO montażu: publiczne strony są edge-cache'owane,
// więc data "wypieczona" w SSR mogłaby być sprzed wielu dni. SSR renderuje
// cytowanie bez pól dostępu, klient uzupełnia je efektem - bez niezgodności
// hydratacji (aktualizacja przez setState, nie przez rozjazd render/HTML).
//
// i18n: lokalny słownik per `lang` (wzorzec FloatingShareBar) - język strony
// publicznej płynie z URL przez props, nigdy z globalnego singletona i18next,
// więc edge-cache nie może zserwować złego języka.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Check, Copy, Quote } from "@/lib/lucide-shim";
import { buildCitations, type CitationAuthor, type CitationLang } from "@/lib/citations/format";
import { SITE_NAME } from "@/lib/seo/meta";

type CitationFormatKey = "chicago" | "apa" | "bibtex";

const FORMAT_ORDER: readonly CitationFormatKey[] = ["chicago", "apa", "bibtex"];

const FORMAT_LABELS: Readonly<Record<CitationFormatKey, string>> = {
  chicago: "Chicago",
  apa: "APA",
  bibtex: "BibTeX",
};

const COPY_TEXTS = {
  pl: {
    heading: "Cytuj tę analizę",
    copy: "Kopiuj",
    copied: "Skopiowano",
    copyAria: "Kopiuj cytowanie w formacie",
  },
  en: {
    heading: "Cite this analysis",
    copy: "Copy",
    copied: "Copied",
    copyAria: "Copy citation in format",
  },
} as const;

export interface CitationBoxProps {
  title: string;
  lang: CitationLang;
  publishedAt: string | null;
  authors: readonly CitationAuthor[];
  /** Kanoniczny, absolutny URL analizy (z override'em SEO, bez query). */
  url: string;
  /** Nazwa wydawcy; domyślnie stała marki. */
  siteName?: string;
}

export function CitationBox({
  title,
  lang,
  publishedAt,
  authors,
  url,
  siteName = SITE_NAME,
}: CitationBoxProps) {
  const t = COPY_TEXTS[lang];
  const headingId = useId();

  // Data dostępu czytelnika - wyłącznie po stronie klienta (patrz nagłówek).
  const [accessedOn, setAccessedOn] = useState<string | null>(null);
  useEffect(() => {
    setAccessedOn(new Date().toISOString().slice(0, 10));
  }, []);

  const citations = useMemo(
    () =>
      buildCitations({
        authors,
        title,
        siteName,
        publishedAt,
        url,
        lang,
        accessedOn,
      }),
    [authors, title, siteName, publishedAt, url, lang, accessedOn],
  );

  const [copiedKey, setCopiedKey] = useState<CitationFormatKey | null>(null);
  const copyResetTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current);
    },
    [],
  );

  const onCopy = async (key: CitationFormatKey): Promise<void> => {
    try {
      await navigator.clipboard.writeText(citations[key]);
      setCopiedKey(key);
      if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current);
      copyResetTimer.current = window.setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // Schowek może być zablokowany (kontekst niezabezpieczony, brak zgody);
      // czytelnik wciąż może zaznaczyć i skopiować tekst ręcznie.
    }
  };

  return (
    <section aria-labelledby={headingId} className="border-t border-border pt-6">
      <div className="flex items-center gap-2 mb-3">
        <Quote className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
        <h2 id={headingId} className="text-xs uppercase tracking-wide text-muted-foreground">
          {t.heading}
        </h2>
      </div>
      <Tabs defaultValue="chicago">
        <TabsList className="h-8">
          {FORMAT_ORDER.map((key) => (
            <TabsTrigger key={key} value={key} className="text-xs px-3">
              {FORMAT_LABELS[key]}
            </TabsTrigger>
          ))}
        </TabsList>
        {FORMAT_ORDER.map((key) => (
          <TabsContent key={key} value={key} className="mt-3">
            <figure className="rounded border border-border bg-muted/30 p-4 flex flex-col gap-3">
              {key === "bibtex" ? (
                <pre className="text-xs font-mono leading-relaxed overflow-x-auto whitespace-pre">
                  {citations[key]}
                </pre>
              ) : (
                <p className="text-sm leading-relaxed break-words">{citations[key]}</p>
              )}
              <figcaption className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void onCopy(key)}
                  aria-label={`${t.copyAria} ${FORMAT_LABELS[key]}`}
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border border-border hover:bg-muted/60 transition"
                >
                  {copiedKey === key ? (
                    <Check className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  <span aria-live="polite">{copiedKey === key ? t.copied : t.copy}</span>
                </button>
              </figcaption>
            </figure>
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}
