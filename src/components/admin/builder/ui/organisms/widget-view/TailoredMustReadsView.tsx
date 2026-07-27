// Widget: "Tailored must-reads" - personalizowane rekomendacje z imieniem
// odbiorcy w nagłówku (dla PL - wołacz). Dla niezalogowanych używa etykiety
// generic ("Dla ciebie" / "For you"), więc widget nie znika z układu.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { AppLink } from "@/components/atoms/AppLink";
import { WidgetMediaImage } from "@/components/atoms/WidgetMediaImage";
import { useAuth } from "@/hooks/useAuth";
import { useRecommendedPosts } from "@/hooks/useRecommendedPosts";
import { supabase } from "@/integrations/supabase/client";
import { toPlVocative } from "@/lib/i18n/plVocative";
import { localizedPath } from "@/lib/i18n/localePath";
import type { WidgetContent } from "@/lib/builder/types";
import { getNum, getStr } from "./frame";

type Lang = "pl" | "en";

const DEFAULT_LABEL_PL = "Twoje wybrane must-reads, {name}";
const DEFAULT_LABEL_EN = "Your tailored must-reads, {name}";
const FALLBACK_LABEL_PL = "Dla ciebie";
const FALLBACK_LABEL_EN = "For you";

function useCurrentUserFirstName(): string {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["profile-first-name", user?.id ?? "anon"],
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<string> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("first_name, display_name")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) return "";
      const first = (data?.first_name ?? "").trim();
      if (first) return first;
      const display = (data?.display_name ?? "").trim();
      return display.split(/\s+/)[0] ?? "";
    },
  });
  return (
    data ??
    (user?.user_metadata?.first_name as string | undefined) ??
    (user?.user_metadata?.full_name as string | undefined)?.split(/\s+/)[0] ??
    ""
  );
}

function renderLabel(template: string, name: string, lang: Lang): string {
  if (!name) {
    // Zwiń wyrażenia typu ", {name}" / " {name}!" gdy brak imienia.
    return template
      .replace(/[,\s]*\{name(?:\.[a-z]+)?\}[!.?]?/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  const nominative = name.trim();
  const vocative = lang === "pl" ? toPlVocative(nominative) : nominative;
  return template
    .replace(/\{name\.nominative\}/gi, nominative)
    .replace(/\{name\.vocative\}/gi, vocative)
    .replace(/\{name\}/gi, vocative);
}

type AuthorInfo = { display_name: string | null; slug: string | null; avatar_url: string | null };

function useAuthorsMap(authorIds: string[]) {
  const key = [...new Set(authorIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: ["tailored-authors", key],
    enabled: key.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Record<string, AuthorInfo>> => {
      const { data, error } = await supabase
        .from("profiles_public")
        .select("id, display_name, slug, avatar_url")
        .in("id", key);
      if (error) return {};
      const map: Record<string, AuthorInfo> = {};
      for (const row of (data ?? []) as Array<{ id: string } & AuthorInfo>) {
        map[row.id] = {
          display_name: row.display_name,
          slug: row.slug,
          avatar_url: row.avatar_url,
        };
      }
      return map;
    },
  });
}

export function TailoredMustReadsView({
  c,
  lang,
}: {
  c: WidgetContent;
  lang: Lang;
}) {
  const { t } = useTranslation();
  const firstName = useCurrentUserFirstName();
  const { user, loading: authLoading } = useAuth();

  const limit = Math.min(Math.max(getNum(c, "limit", 3), 1), 9);
  const columns = Math.min(Math.max(getNum(c, "columns", 3), 1), 4);
  const showKicker = getStr(c, "showKicker") !== "0";
  const showExcerpt = getStr(c, "showExcerpt") !== "0";
  const showAuthor = getStr(c, "showAuthor") !== "0";
  const audienceRaw = getStr(c, "audience") || "auth";
  const audience: "auth" | "all" | "guest" =
    audienceRaw === "all" || audienceRaw === "guest" ? audienceRaw : "auth";
  const kicker =
    getStr(c, `kicker_${lang}`) ||
    (lang === "pl" ? "Polecane dla ciebie" : "Recommended for you");

  const template =
    getStr(c, `label_${lang}`) ||
    (lang === "pl" ? DEFAULT_LABEL_PL : DEFAULT_LABEL_EN);
  const fallbackNoUser =
    getStr(c, `fallback_${lang}`) ||
    (lang === "pl" ? FALLBACK_LABEL_PL : FALLBACK_LABEL_EN);

  const heading = useMemo(() => {
    const rendered = renderLabel(template, firstName, lang);
    return rendered || fallbackNoUser;
  }, [template, firstName, lang, fallbackNoUser]);

  const { data: posts = [], isLoading } = useRecommendedPosts(limit, {
    enabled: !!user,
  });
  const { data: authorsMap = {} } = useAuthorsMap(
    posts.map((p) => p.author_id).filter((id): id is string => !!id),
  );

  // Reguły widoczności zgodne z ustawieniem "audience" w edytorze widgetu.
  // Domyślnie widget jest dostępny wyłącznie dla zalogowanych (rekomendacje
  // wymagają zainteresowań / historii). Nie renderujemy pustego bloku.
  if (authLoading) return null;
  if (audience === "auth" && !user) return null;
  if (audience === "guest" && user) return null;



  const gridCols =
    columns === 1
      ? "grid-cols-1"
      : columns === 2
        ? "grid-cols-1 sm:grid-cols-2"
        : columns === 4
          ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
          : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";

  return (
    <section className="w-full" data-widget="tailored-must-reads">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          {showKicker && (
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {kicker}
            </div>
          )}
          <h2 className="truncate font-display text-2xl font-bold leading-tight sm:text-3xl">
            {heading}
          </h2>
        </div>
      </header>

      {isLoading ? (
        <div className={`grid gap-6 ${gridCols}`}>
          {Array.from({ length: limit }).map((_, i) => (
            <div key={i} className="animate-pulse space-y-3">
              <div className="aspect-[16/9] w-full rounded-md bg-muted" />
              <div className="h-4 w-3/4 rounded bg-muted" />
              <div className="h-3 w-full rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : posts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {lang === "pl"
            ? "Zaczniemy polecać wpisy, gdy zaznaczysz swoje zainteresowania."
            : "We will start recommending posts once you pick your interests."}
        </p>
      ) : (
        <ul className={`grid gap-6 ${gridCols} list-none p-0 m-0`}>
          {posts.map((p) => {
            const title = (lang === "pl" ? p.title_pl : p.title_en) || p.title_pl || p.title_en;
            const excerpt =
              (lang === "pl" ? p.excerpt_pl : p.excerpt_en) || p.excerpt_pl || p.excerpt_en;
            const href = localizedPath(`/post/${p.slug}`, lang);
            const author = p.author_id ? authorsMap[p.author_id] : undefined;
            const authorName = author?.display_name?.trim() || "";
            const authorHref = author?.slug
              ? localizedPath(`/author/${author.slug}`, lang)
              : null;
            return (
              <li key={p.id} className="group flex flex-col gap-3">
                <AppLink
                  href={href}
                  className="relative block w-full overflow-hidden rounded-md"
                >
                  <WidgetMediaImage
                    src={p.cover_image_url}
                    alt={title ?? ""}
                    frameClassName="relative block aspect-[16/9] w-full overflow-hidden bg-muted"
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    foregroundClassName="absolute inset-0 block h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                </AppLink>
                <div className="flex min-w-0 flex-col gap-1.5">
                  {showAuthor && authorName ? (
                    authorHref ? (
                      <AppLink
                        href={authorHref}
                        className="inline-flex items-center gap-2 min-w-0 text-[12px] font-medium text-muted-foreground hover:text-primary transition-colors"
                      >
                        {author?.avatar_url ? (
                          <img
                            src={author.avatar_url}
                            alt=""
                            width={20}
                            height={20}
                            loading="lazy"
                            className="h-5 w-5 shrink-0 rounded-full object-cover"
                            style={{ borderRadius: 5 }}
                          />
                        ) : (
                          <span
                            aria-hidden
                            className="h-5 w-5 shrink-0 bg-muted"
                            style={{ borderRadius: 5 }}
                          />
                        )}
                        <span className="truncate">{authorName}</span>
                      </AppLink>
                    ) : (
                      <span className="inline-flex items-center gap-2 min-w-0 text-[12px] font-medium text-muted-foreground">
                        {author?.avatar_url ? (
                          <img
                            src={author.avatar_url}
                            alt=""
                            width={20}
                            height={20}
                            loading="lazy"
                            className="h-5 w-5 shrink-0 object-cover"
                            style={{ borderRadius: 5 }}
                          />
                        ) : null}
                        <span className="truncate">{authorName}</span>
                      </span>
                    )
                  ) : null}
                  <AppLink href={href} className="min-w-0">
                    <h3 className="line-clamp-3 font-display text-base font-semibold leading-snug transition-colors group-hover:text-primary sm:text-lg">
                      {title}
                    </h3>
                  </AppLink>
                  {showExcerpt && excerpt ? (
                    <p className="line-clamp-2 text-sm text-muted-foreground">{excerpt}</p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

