// Nota metodologiczna - rozwijalny blok (<details>) z zsanityzowanym HTML
// opisującym metodę, wersję i datę aktualizacji. Wzorzec CSIS: każdy "digital
// feature" niesie jawną metodologię obok danych. Treść sanityzowana przez
// sanitizeHtml (ten sam potok co reszta treści użytkownika).
import { useMemo } from "react";
import { FileText } from "@/lib/lucide-shim";
import type { MethodologyNoteConfig } from "@/lib/features/types";
import { sanitizeHtml } from "@/lib/sanitize";

interface Props {
  config: MethodologyNoteConfig;
  lang: "pl" | "en";
  className?: string;
}

const L = {
  pl: { version: "Wersja", updated: "Aktualizacja", fallback: "Nota metodologiczna" },
  en: { version: "Version", updated: "Updated", fallback: "Methodology note" },
} as const;

export function MethodologyNote({ config, lang, className }: Props) {
  const t = L[lang];
  const cleanHtml = useMemo(() => sanitizeHtml(config.html), [config.html]);
  const meta = [
    config.version ? `${t.version} ${config.version}` : "",
    config.updated ? `${t.updated}: ${config.updated}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <details
      open={config.defaultOpen}
      className={`nes-feature not-prose group my-6 rounded-2xl border border-border bg-card p-4 md:p-5 ${className ?? ""}`}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2">
        <FileText className="h-4 w-4 shrink-0 text-brand" aria-hidden />
        <span className="font-display text-base font-semibold text-foreground">
          {config.title || t.fallback}
        </span>
        {meta && <span className="ml-auto text-xs text-muted-foreground">{meta}</span>}
        <span
          aria-hidden
          className="ml-1 text-muted-foreground transition-transform group-open:rotate-90"
        >
          ▸
        </span>
      </summary>
      {cleanHtml ? (
        <div
          className="prose prose-sm mt-3 max-w-none border-t border-border/60 pt-3 text-muted-foreground [&_*]:text-inherit"
          dangerouslySetInnerHTML={{ __html: cleanHtml }}
        />
      ) : null}
    </details>
  );
}
