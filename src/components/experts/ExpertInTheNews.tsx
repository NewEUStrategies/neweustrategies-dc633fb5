// Sekcja „W mediach" (In the News): cytowania, wywiady i wystąpienia eksperta.
// Dane z media_mentions (publiczne). Zewnętrzne linki otwierane w nowej karcie.
import { useTranslation } from "react-i18next";
import { ExternalLink, Newspaper } from "lucide-react";
import { formatDate } from "@/lib/i18n/format";
import type { MediaMention } from "@/lib/experts/types";

export function ExpertInTheNews({
  mentions,
  lang,
}: {
  mentions: MediaMention[];
  lang: "pl" | "en";
}) {
  const { t } = useTranslation();
  if (mentions.length === 0) return null;

  return (
    <section className="grid gap-3">
      <h2 className="flex items-center gap-2 font-display text-2xl">
        <Newspaper className="h-5 w-5 text-[var(--brand)]" aria-hidden />
        {t("expert.inTheNews")}
      </h2>
      <ul className="divide-y divide-border/60 rounded-[10px] border border-border/60 bg-card">
        {mentions.map((m) => {
          const cover = m.cover_url?.trim() ? m.cover_url : null;
          const inner = (
            <>
              {cover ? (
                <img
                  src={cover}
                  alt=""
                  loading="lazy"
                  className="h-16 w-24 shrink-0 rounded-md border border-border/60 object-cover"
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                  <span className="text-[var(--brand)]">{m.outlet}</span>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t(`expert.mediaKind.${m.kind}`)}
                  </span>
                </p>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">{m.title}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground/80">
                <time dateTime={m.published_on}>{formatDate(m.published_on, lang)}</time>
                {m.url && <ExternalLink className="h-3.5 w-3.5" aria-hidden />}
              </div>
            </>
          );
          return (
            <li key={m.id}>
              {m.url ? (
                <a
                  href={m.url}
                  target="_blank"
                  rel="noreferrer nofollow"
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  {inner}
                </a>
              ) : (
                <div className="flex items-center gap-3 px-4 py-3">{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
