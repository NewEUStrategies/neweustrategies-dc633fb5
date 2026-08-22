// Karta wpisu na liście czytelniczej (zapisane / obserwowane / rekomendacje).
//
// MOLEKUŁA: wszystko z propsów, zero zapytań. Trzy różne kształty wiersza
// (tabela `posts`, RPC rekomendacji, RPC feedu obserwowanych) mają wspólny
// podzbiór kolumn i to on jest kontraktem tej karty - dzięki temu jedna karta
// obsługuje trzy zakładki i wygląda w nich identycznie.
//
// `alt=""` przy okładce jest CELOWE: obraz jest dekoracyjny, a nazwę odnośnika
// niesie nagłówek karty - `alt` z tytułem czytałby ten sam tekst dwa razy.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { reasonBadgeKey } from "@/components/readingList/atoms/reasonBadge";
import { localizedTitle } from "@/components/readingList/atoms/savedTitle";

/** Wspólny podzbiór kolumn wpisu, jakiego potrzebuje karta. */
export interface ReadingListCardPost {
  id: string;
  slug: string;
  title_pl: string | null;
  title_en: string | null;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  cover_image_url: string | null;
}

export function ReadingListPostCard({
  post,
  lang,
  reasons,
}: {
  post: ReadingListCardPost;
  lang: "pl" | "en";
  reasons?: readonly string[];
}) {
  const { t } = useTranslation();
  const title = localizedTitle(post, lang);
  const excerpt = lang === "en" ? post.excerpt_en : post.excerpt_pl;
  // Badge tylko dla najistotniejszego powodu (autor > kategoria > tag > reszta),
  // żeby karta nie tonęła w metadanych.
  const badgeKey = reasonBadgeKey(reasons);
  return (
    <article className="group">
      <Link to="/post/$slug" params={{ slug: post.slug }} className="block">
        {post.cover_image_url && (
          <div className="aspect-[16/10] overflow-hidden rounded-lg mb-3 bg-muted">
            <img
              src={post.cover_image_url}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover group-hover:scale-105 transition"
            />
          </div>
        )}
        {badgeKey && (
          <Badge variant="secondary" className="mb-1.5 text-[10px]">
            {t(badgeKey)}
          </Badge>
        )}
        <h3 className="font-display text-lg leading-tight group-hover:text-brand transition mb-1">
          {title}
        </h3>
        {excerpt && <p className="text-sm text-muted-foreground line-clamp-2">{excerpt}</p>}
      </Link>
    </article>
  );
}
