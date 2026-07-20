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
  lang: string;
  className?: string;
}

const COPY_LABEL = { pl: "Kopiuj kod", en: "Copy code" } as const;
const COPIED_LABEL = { pl: "Skopiowano", en: "Copied" } as const;

export function CodeBlockView({ code, lang, className }: Props) {
  const tokens = useMemo(() => highlightCode(code, lang), [code, lang]);
  const [copied, setCopied] = useState(false);
  // Język dokumentu steruje copy przycisku; blok bywa renderowany poza
  // kontekstem i18n (druk, cache), więc czytamy atrybut zamiast hooka.
  const uiLang: "pl" | "en" =
    typeof document !== "undefined" && document.documentElement.lang === "en" ? "en" : "pl";

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
