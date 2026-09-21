// Publiczny widok bloku "code": podświetlanie składni (lekki tokenizer bez
// zależności - lib/code/highlight), pasek z etykietą języka i kopiowaniem.
// Tokeny renderują się jako <span> (bez innerHTML), więc wynik jest
// deterministyczny między SSR a klientem i bezpieczny dla edge cache;
// jedyna interaktywność (kopiuj) nie dotyka markupu kodu.
import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { highlightCode, isHighlightableLang } from "@/lib/code/highlight";

interface Props {
  code: string;
  /** Język KODU (np. "ts", "sql") - nie język interfejsu. */
  lang: string;
  /**
   * Język INTERFEJSU dla etykiet przycisku kopiowania. Przekazywany przez
   * `BlockRenderer` (ma go w sygnaturze), nie odczytywany z DOM - patrz
   * komentarz przy `copyLabel` niżej.
   */
  uiLang?: "pl" | "en";
  className?: string;
}

const COPY_LABEL = { pl: "Kopiuj kod", en: "Copy code" } as const;
const COPIED_LABEL = { pl: "Skopiowano", en: "Copied" } as const;

export function CodeBlockView({ code, lang, uiLang = "pl", className }: Props) {
  const tokens = useMemo(() => highlightCode(code, lang), [code, lang]);
  const [copied, setCopied] = useState(false);
  // JĘZYK PRZYCHODZI PROPEM, nie z DOM.
  //
  // Stało tu `document.documentElement.lang === "en"` czytane W CIELE RENDERU.
  // Na serwerze `document` nie istnieje, więc SSR emitował ZAWSZE „Kopiuj kod",
  // a klient na trasie /en liczył „Copy code" - rozjazd tekstu, po którym
  // React 19 porzuca serwerowe poddrzewo i renderuje je od zera. Uzasadnienie
  // („blok bywa renderowany poza kontekstem i18n") było trafne co do problemu
  // i błędne co do rozwiązania: `lang` jest w sygnaturze `BlockRenderer`, więc
  // nie potrzebujemy ani hooka i18next, ani odczytu z przeglądarki.

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Starsze przeglądarki bez clipboard API - przycisk po prostu nie działa.
    }
  };

  const label = (lang ?? "").trim();

  return (
    <div className={`code-block not-prose ${className ?? ""}`.trim()}>
      <div className="code-block-bar">
        <span className="code-block-lang">
          {label ? (isHighlightableLang(label) ? label.toLowerCase() : label) : "text"}
        </span>
        <button
          type="button"
          className="code-block-copy"
          onClick={() => void copy()}
          aria-live="polite"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              {COPIED_LABEL[uiLang]}
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" aria-hidden="true" />
              {COPY_LABEL[uiLang]}
            </>
          )}
        </button>
      </div>
      <pre>
        <code data-lang={label}>
          {tokens.map((t, i) =>
            t.kind ? (
              <span key={i} className={`tok-${t.kind}`}>
                {t.text}
              </span>
            ) : (
              t.text
            ),
          )}
        </code>
      </pre>
    </div>
  );
}
