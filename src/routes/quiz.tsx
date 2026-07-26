import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/quiz")({
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
    <section className="flex h-full flex-col" aria-label="EuroChallenge Quiz">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3 py-2 sm:px-4">
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
      </header>

      <div className="relative flex-1 min-h-0 bg-background">
        <iframe
          src="https://nes-quiz.com/embed"
          className="absolute inset-0 h-full w-full border-0"
          allow="clipboard-write"
          loading="lazy"
          title="EuroChallenge Quiz"
        />
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
    </section>
  );
}
