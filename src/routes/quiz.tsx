import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Header } from "@/components/Header";

export const Route = createFileRoute("/quiz")({
  // Strona quizu ma własny układ: renderujemy globalny header NES,
  // ale zamiast standardowego <main> wklejamy pełnoekranowy, niescrollujący
  // obszar z iframe'em oraz kompaktowy pasek powrotu.
  staticData: { ownChrome: true },
  head: () => ({
    meta: [
      { title: "EuroChallenge Quiz — New European Strategies" },
      {
        name: "description",
        content:
          "Sprawdź swoją wiedzę w EuroChallenge Quiz. Interaktywne pytania o Europie, gospodarce i polityce międzynarodowej.",
      },
      {
        property: "og:title",
        content: "EuroChallenge Quiz — New European Strategies",
      },
      {
        property: "og:description",
        content:
          "Sprawdź swoją wiedzę w EuroChallenge Quiz. Interaktywne pytania o Europie, gospodarce i polityce międzynarodowej.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: QuizPage,
});

function QuizPage() {
  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background" aria-label="EuroChallenge Quiz">
      {/* Globalny header New European Strategies */}
      <Header adPageType="all" />

      {/* Kompaktowy pasek powrotu i tytułu quizu */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3 py-2 sm:px-4">
        <div className="min-w-0">
          <h1 className="truncate font-display text-sm font-semibold leading-tight text-foreground sm:text-base">
            EuroChallenge Quiz
          </h1>
          <p className="truncate text-[11px] leading-tight text-muted-foreground sm:text-xs">
            Sprawdź swoją wiedzę o Europie, gospodarce i polityce międzynarodowej.
          </p>
        </div>
        <Link
          to="/"
          className="inline-flex shrink-0 items-center gap-1 rounded-[6px] bg-secondary px-2 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Powrót</span>
        </Link>
      </div>

      {/* Obszar quizu: responsywnie dopasowuje się do pozostałej wysokości
          viewportu, nie wymaga scrollowania. Na dużych ekranach centrujemy
          i ograniczamy szerokość, aby quiz nie rozciągał się nieproporcjonalnie. */}
      <div className="relative flex flex-1 min-h-0 items-center justify-center p-2 sm:p-3 lg:p-4">
        <div className="relative h-full w-full max-w-5xl overflow-hidden rounded-[6px] border border-border bg-black shadow-lg">
          <iframe
            src="https://nes-quiz.com/embed"
            className="absolute inset-0 h-full w-full border-0"
            allow="clipboard-write"
            loading="eager"
            title="EuroChallenge Quiz"
          />
        </div>
      </div>

      <p className="shrink-0 px-3 py-1.5 text-center text-[10px] leading-tight text-muted-foreground/80 sm:text-xs">
        Quiz dostarczany przez zewnętrzną platformę{" "}
        <a
          href="https://nes-quiz.com"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground"
        >
          nes-quiz.com
        </a>
        .
      </p>
    </div>
  );
}
