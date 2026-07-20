// Podgląd szkicu po tokenie (B5): /preview/$token - dostęp bez konta dla
// prasy/partnerów/rady przed premierą. Treść zwraca server fn fetchPreviewPost
// (service role + twarda walidacja tokenu i expiry); trasa renderuje
// uproszczony widok czytelniczy (bez reklam, komentarzy, related) z wyraźnym
// banerem embarga i pełnym noindex.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { EyeOff } from "lucide-react";
import { fetchPreviewPost, type PreviewPostPayload } from "@/lib/content/previewTokens.functions";
import { ContentRenderer } from "@/components/content/ContentRenderer";
import { parseBuilderDoc } from "@/lib/builder/parse";
import type { BlocksDoc, LocalizedBlocks } from "@/lib/blocks/types";
import { PostContentStyle } from "@/components/PostContentStyle";
import { sanitizeHtml } from "@/lib/sanitize";

const COPY = {
  pl: {
    banner: "Podgląd roboczy pod embargiem - nie udostępniaj tego linku publicznie.",
    expires: "Link wygasa",
    notFound: "Link podglądu wygasł lub jest nieprawidłowy.",
    notFoundHint: "Poproś redakcję o nowy link.",
  },
  en: {
    banner: "Embargoed draft preview - do not share this link publicly.",
    expires: "Link expires",
    notFound: "This preview link has expired or is invalid.",
    notFoundHint: "Ask the editorial team for a fresh link.",
  },
} as const;

export const Route = createFileRoute("/preview/$token")({
  loader: async ({ params }) => {
    const post = await fetchPreviewPost({ data: { token: params.token } });
    return { post };
  },
  head: () => ({
    meta: [
      { title: "Preview" },
      // Podgląd nigdy nie może trafić do indeksu ani cache wyszukiwarek.
      { name: "robots", content: "noindex, nofollow, noarchive" },
    ],
  }),
  component: PreviewPage,
});

function PreviewPage() {
  const { post } = Route.useLoaderData() as { post: PreviewPostPayload | null };
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const c = COPY[lang];

  if (!post) {
    return (
      <div className="flex-1 max-w-2xl mx-auto px-4 py-24 text-center">
        <EyeOff className="w-8 h-8 mx-auto text-muted-foreground" aria-hidden="true" />
        <h1 className="mt-4 font-display text-2xl">{c.notFound}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{c.notFoundHint}</p>
      </div>
    );
  }

  const title = lang === "en" ? post.title_en || post.title_pl : post.title_pl || post.title_en;
  const excerpt = lang === "en" ? post.excerpt_en || post.excerpt_pl : post.excerpt_pl;
  const builderDoc = parseBuilderDoc(post.builder_data);
  const localized = (post.blocks_data as LocalizedBlocks | null) ?? null;
  const blocksDoc: BlocksDoc | null = localized
    ? (localized[lang] ?? localized.pl ?? localized.en ?? null)
    : null;
  const rawHtml = lang === "en" ? post.content_en || post.content_pl : post.content_pl;
  const expires = new Date(post.expires_at).toLocaleString(lang === "en" ? "en-GB" : "pl-PL");

  return (
    <div className="flex-1 bg-background text-foreground" data-page-template="preview">
      <PostContentStyle />
      <div
        role="status"
        className="sticky top-0 z-40 bg-amber-500/95 text-amber-950 text-sm px-4 py-2 text-center font-medium"
      >
        {c.banner} · {c.expires}: {expires}
      </div>
      <article className="max-w-3xl mx-auto px-4 py-10">
        {post.cover_image_url && (
          <img
            src={post.cover_image_url}
            alt=""
            className="w-full rounded-lg mb-6 object-cover max-h-[420px]"
          />
        )}
        <h1 className="font-display text-3xl lg:text-4xl mb-3">{title}</h1>
        {excerpt && <p className="text-lg text-muted-foreground mb-8">{excerpt}</p>}
        <div className="article-body">
          <ContentRenderer
            editor={post.editor}
            builderDoc={builderDoc}
            blocksDoc={blocksDoc}
            html={rawHtml ? sanitizeHtml(rawHtml) : ""}
            lang={lang}
          />
        </div>
      </article>
    </div>
  );
}
