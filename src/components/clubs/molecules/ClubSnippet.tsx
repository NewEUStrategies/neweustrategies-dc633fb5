// Molekuła: fragment wyniku wyszukiwania z podświetleniem trafienia.
//
// `ts_headline` z Postgresa zwraca fragment ze znacznikami `<b>`. Do DOM-u
// tego NIE wstawiamy: `dangerouslySetInnerHTML` na treści pochodzącej od
// użytkownika to wektor XSS niezależnie od tego, że akurat ten generator jest
// bezpieczny - a jedna zmiana konfiguracji `ts_headline` w przyszłości
// wystarczy, żeby przestał być.
//
// Fragment rozbija czysta funkcja (`parseSnippet`), a trafienie rysuje
// `<mark>` - element, który czytniki ekranu ogłaszają jako wyróżnienie, więc
// niesie to samo znaczenie bez koloru.
import { parseSnippet } from "@/lib/clubs/workspaceTypes";

export function ClubSnippet({
  snippet,
  className,
}: {
  snippet: string | null;
  className?: string;
}) {
  const parts = parseSnippet(snippet);
  if (parts.length === 0) return null;
  return (
    <p className={className ?? "text-sm leading-relaxed text-muted-foreground"}>
      {parts.map((part, index) =>
        part.hit ? (
          <mark
            key={index}
            className="rounded-[3px] bg-primary/20 px-0.5 text-foreground [color-scheme:normal]"
          >
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </p>
  );
}
