// Unified public 404 surface. Single source of bilingual copy (errorCopy) plus
// nawigacyjne skróty (Analizy, Cennik, Quiz, Kontakt), współdzielone przez
// renderer stron dynamicznych ($), archiwa taksonomii/autorów i root router,
// żeby „nie znaleziono" nigdy nie rozjechało się w treści ani stylu.
// Renders a plain container (NOT a <main>) - SiteChrome already provides the
// page's <main id="main-content"> landmark.
import { ArrowRight } from "lucide-react";
import { errorCopy } from "@/lib/errorCopy";
import { currentLang } from "@/lib/i18n/localeRuntime";
import { Button } from "@/components/ui/button";

/** Skróty prowadzą do realnych stron CMS; wersja EN żyje pod prefiksem /en. */
function suggestionHrefs(lang: string) {
  const prefix = lang === "en" ? "/en" : "";
  return {
    home: prefix || "/",
    analyses: `${prefix}/analizy`,
    pricing: `${prefix}/pricing`,
    quiz: "/quiz",
    contact: `${prefix}/kontakt`,
  };
}

export function PublicNotFound() {
  const copy = errorCopy();
  const lang = currentLang();
  const href = suggestionHrefs(lang);
  const suggestions = [
    { label: copy.notFoundLinks.home, to: href.home },
    { label: copy.notFoundLinks.analyses, to: href.analyses },
    { label: copy.notFoundLinks.pricing, to: href.pricing },
    { label: copy.notFoundLinks.quiz, to: href.quiz },
    { label: copy.notFoundLinks.contact, to: href.contact },
  ];

  return (
    <div className="flex flex-1 min-h-[70vh] items-center justify-center px-4 py-20">
      <div className="w-full max-w-xl text-center">
        <p className="font-display text-7xl font-bold leading-none tracking-tight text-brand sm:text-8xl">
          404
        </p>
        <h1 className="mt-6 font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {copy.notFoundTitle}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">{copy.notFoundBody}</p>

        <div className="mt-10 rounded-[6px] border border-border bg-card/60 p-5 text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {copy.notFoundSuggestionsTitle}
          </p>
          <ul className="mt-3 divide-y divide-border">
            {suggestions.map((s) => (
              <li key={s.label}>
                <a
                  href={s.to}
                  className="group flex items-center justify-between gap-3 py-2.5 text-sm text-foreground transition-colors hover:text-brand"
                >
                  <span>{s.label}</span>
                  <ArrowRight
                    aria-hidden
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-brand"
                  />
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row">
          <Button asChild className="rounded-[6px]">
            <a href={href.home}>{copy.goHome}</a>
          </Button>
          <Button asChild variant="outline" className="rounded-[6px]">
            <a href={href.contact}>{copy.contactSupport}</a>
          </Button>
        </div>
      </div>
    </div>
  );
}
