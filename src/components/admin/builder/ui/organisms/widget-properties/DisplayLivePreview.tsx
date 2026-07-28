// Live mini-preview for the Post List widget "Display" panel.
// Reflects showCover / showTitle / showExcerpt / authorDisplay + authorLabel_*
// instantly as the editor mutates widget content - no page reload required.
import { useTranslation } from "react-i18next";
import type { WidgetNode } from "@/lib/builder/types";

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
  const rawAuthor = s(c, "authorDisplay", "avatar");
  const authorDisplay: "avatar" | "label" | "none" =
    rawAuthor === "label" || rawAuthor === "none" ? rawAuthor : "avatar";
  const authorLabel =
    s(c, `authorLabel_${lang}`).trim() ||
    (lang === "pl" ? "Autor" : "By");

  const sampleTitle =
    lang === "pl" ? "Przykładowy tytuł wpisu" : "Sample post title";
  const sampleExcerpt =
    lang === "pl"
      ? "Krótki opis (excerpt) prezentowany pod tytułem."
      : "Short excerpt shown under the title.";
  const sampleAuthor = lang === "pl" ? "Jan Kowalski" : "John Smith";

  return (
    <div
      className="mt-3 rounded-md border border-border/70 bg-muted/30 p-2.5"
      data-testid="post-list-live-preview"
      aria-label={t("builder.postListEditor.livePreview", {
        defaultValue: "Podgląd na żywo",
      })}
    >
      <div className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {t("builder.postListEditor.livePreview", {
          defaultValue: "Podgląd na żywo",
        })}
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
          {variant === "ranked" && authorDisplay !== "none" && (
            <div
              className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground"
              data-testid="preview-author"
            >
              {authorDisplay === "avatar" && (
                <span
                  aria-hidden
                  className="h-4 w-4 shrink-0 rounded-[5px] bg-muted-foreground/30"
                  data-testid="preview-author-avatar"
                />
              )}
              {authorDisplay === "label" && (
                <span
                  className="opacity-70"
                  data-testid="preview-author-label"
                >
                  {authorLabel}:
                </span>
              )}
              <span
                className="truncate text-foreground"
                data-testid="preview-author-name"
              >
                {sampleAuthor}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
