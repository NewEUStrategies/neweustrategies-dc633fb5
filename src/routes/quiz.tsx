import { createFileRoute } from "@tanstack/react-router";

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
    <main className="min-h-screen bg-background py-12 md:py-16">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-4xl">
          <header className="mb-8 text-center">
            <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
              EuroChallenge Quiz
            </h1>
            <p className="mt-3 text-[15px] text-muted-foreground">
              Sprawdź swoją wiedzę o Europie, gospodarce i polityce
              międzynarodowej.
            </p>
          </header>

          <div className="overflow-hidden rounded-[6px] border border-border bg-card shadow-sm">
            <iframe
              src="https://nes-quiz.com/embed"
              width="100%"
              height="700px"
              style={{ border: 0 }}
              allow="clipboard-write"
              loading="lazy"
              title="EuroChallenge Quiz"
              className="block min-h-[500px] w-full md:min-h-[700px]"
            />
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Quiz dostarczany przez zewnętrzną platformę nes-quiz.com.
          </p>
        </div>
      </div>
    </main>
  );
}
