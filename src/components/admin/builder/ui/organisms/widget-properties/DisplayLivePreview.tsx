// Podgląd na żywo sekcji „Wyświetlanie" widgetu post-listy.
//
// Odzwierciedla showCover / showTitle / showExcerpt oraz PEŁNY kontrakt autora
// (obie osie widoczności, oba rozmiary, etykieta) natychmiast po zmianie w
// panelu - bez przeładowania strony.
//
// Byline rysuje TA SAMA molekuła, co kanwa i strona publiczna. Wcześniej
// podgląd miał własny, zaszyty na sztywno kwadracik 16 px i tekst 11 px, więc
// suwaki rozmiaru wyglądały na „dekoracyjne": treść się zmieniała, obraz nie.
import { useTranslation } from "react-i18next";
import type { WidgetNode } from "@/lib/builder/types";
import { AuthorByline } from "@/components/molecules/AuthorByline";
import { resolveAuthorDisplay } from "@/lib/builder/authorDisplay";
import { postListVariantHasByline } from "@/lib/builder/postListQuery";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
}

function s(c: WidgetNode["content"], k: string, dflt = ""): string {
  const v = c[k];
  return typeof v === "string" ? v : dflt;
}

export function DisplayLivePreview({ c, lang }: Props) {
  const { t } = useTranslation();
  const showCover = s(c, "showCover", "1") !== "0";
  const showTitle = s(c, "showTitle", "1") !== "0";
  const showExcerpt = s(c, "showExcerpt", "1") !== "0";
  const variant = s(c, "variant", "card");
  // Ta sama reguła, którą panel decyduje o pokazaniu sekcji „Autor" - podgląd
  // nie może twierdzić, że autora nie ma tam, gdzie widget go rysuje.
  const authorDisplay = resolveAuthorDisplay(c, lang);
  const showAuthor = postListVariantHasByline(variant) && authorDisplay.visible;

  const sampleTitle = lang === "pl" ? "Przykładowy tytuł wpisu" : "Sample post title";
  const sampleExcerpt =
    lang === "pl"
      ? "Krótki opis (excerpt) prezentowany pod tytułem."
      : "Short excerpt shown under the title.";
  const sampleAuthor = lang === "pl" ? "Jan Kowalski" : "John Smith";

  return (
    <div
      className="mt-3 rounded-md border border-border/70 bg-muted/30 p-2.5"
      data-testid="post-list-live-preview"
      aria-label={t("builder.postListEditor.livePreview")}
    >
      <div className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {t("builder.postListEditor.livePreview")}
      </div>
      <div className="flex gap-2.5">
        {showCover && (
          <div
            className="h-14 w-20 shrink-0 rounded-sm bg-gradient-to-br from-muted to-muted-foreground/20"
            data-testid="preview-cover"
            aria-hidden
          />
        )}
        <div className="min-w-0 flex-1">
          {showTitle && (
            <div
              className="truncate text-xs font-semibold text-foreground"
              data-testid="preview-title"
            >
              {sampleTitle}
            </div>
          )}
          {showExcerpt && (
            <div
              className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground"
              data-testid="preview-excerpt"
            >
              {sampleExcerpt}
            </div>
          )}
          {showAuthor && (
            <div className="mt-1 flex min-w-0 items-center" data-testid="preview-author">
              <AuthorByline
                name={sampleAuthor}
                display={authorDisplay}
                // Podgląd nie ma zdjęcia próbnego - molekuła rysuje wtedy
                // kafelek z inicjałem W DOKŁADNIE tym samym rozmiarze, co
                // realne zdjęcie na stronie.
                avatarUrl={null}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
