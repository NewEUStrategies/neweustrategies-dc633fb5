// FAQ block - accordion + schema.org FAQPage JSON-LD.
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { safeJsonLd } from "@/lib/seo/jsonld";

interface Item {
  q: string;
  a: string;
}
interface Props {
  items: Item[];
  title?: string;
  lang?: "pl" | "en";
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

export function FaqBlockView({ items, title, lang = "pl" }: Props) {
  const [open, setOpen] = useState<number | null>(0);
  const L =
    lang === "pl"
      ? { fallback: "Najczęstsze pytania" }
      : { fallback: "Frequently Asked Questions" };
  const valid = items.filter((it) => it.q.trim() && it.a.trim());
  if (!valid.length) return null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: valid.map((it) => ({
      "@type": "Question",
      name: stripHtml(it.q),
      acceptedAnswer: { "@type": "Answer", text: stripHtml(it.a) },
    })),
  };

  return (
    <section className="not-prose my-6 rounded-lg border border-border bg-card overflow-hidden">
      <header className="px-4 py-3 border-b border-border bg-muted/40">
        <h3 className="text-sm font-semibold m-0">{title || L.fallback}</h3>
      </header>
      <ul className="divide-y divide-border">
        {valid.map((it, i) => {
          const isOpen = open === i;
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : i)}
                className="w-full flex items-center justify-between gap-3 text-left px-4 py-3 hover:bg-accent/50"
                aria-expanded={isOpen}
              >
                <span className="font-medium text-sm">{it.q}</span>
                <ChevronDown
                  className={`w-4 h-4 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </button>
              {isOpen && (
                <div className="px-4 pb-4 text-sm text-muted-foreground whitespace-pre-line">
                  {it.a}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <script
        type="application/ld+json"
        // safeJsonLd escapes </script> breakouts - user-authored Q&A cannot
        // terminate the element and inject live HTML (stored XSS).
        dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }}
      />
    </section>
  );
}
