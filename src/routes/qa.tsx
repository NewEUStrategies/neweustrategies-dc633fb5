// Lista publicznych sesji Q&A. URL: /qa
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { HelpCircle, Clock } from "lucide-react";
import { fetchPublicQaSessions, type PublicQaSession } from "@/lib/community/publicQueries";
import { useCommunityModules } from "@/lib/community/useCommunityModules";
import { CommunityDisabled } from "@/components/community/CommunityDisabled";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead } from "@/lib/seo/meta";
import { ensureI18n as ensureCommunityI18n } from "@/lib/i18n-community";
export const Route = createFileRoute("/qa")({
  component: QaListPage,
  head: () => {
    const url = getRequestUrl() || "/qa";
    const lang = activeLang(url);
    return buildContentHead({
      url,
      lang,
      type: "website",
      title: lang === "en" ? "Q&A sessions" : "Sesje Q&A",
      description:
        lang === "en"
          ? "Ask questions to experts and upvote the best community questions."
          : "Zadawaj pytania ekspertom i głosuj na najlepsze pytania społeczności.",
    });
  },
});

function statusBadge(status: string, t: (k: string) => string) {
  if (status === "open" || status === "answering") return t("community.qa.openSession");
  if (status === "closed") return t("community.qa.closedSession");
  return t("community.qa.scheduledSession");
}

function QaListPage() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureCommunityI18n();
  const { t, i18n } = useTranslation();
  const lang = (i18n.language.startsWith("en") ? "en" : "pl") as "pl" | "en";
  const modules = useCommunityModules();
  const query = useQuery({
    queryKey: ["public-qa-sessions"],
    queryFn: fetchPublicQaSessions,
    enabled: modules.qa_enabled,
  });

  if (!modules.qa_enabled) return <CommunityDisabled />;

  return (
    <div className="container mx-auto max-w-4xl px-4 py-12 md:py-16">
      <header className="mb-10">
        <h1 className="text-4xl font-bold tracking-tight">{t("community.qa.title")}</h1>
        <p className="mt-3 text-muted-foreground">{t("community.qa.subtitle")}</p>
      </header>

      {query.isLoading && <p className="text-muted-foreground">{t("community.common.loading")}</p>}
      {query.isError && <p className="text-destructive">{t("community.common.loadError")}</p>}

      {query.data && query.data.length === 0 && (
        <p className="text-muted-foreground">{t("community.qa.empty")}</p>
      )}

      <ul className="grid gap-4 md:grid-cols-2">
        {(query.data ?? []).map((s) => (
          <QaCard key={s.id} session={s} lang={lang} statusLabel={statusBadge(s.status, t)} />
        ))}
      </ul>
    </div>
  );
}

function QaCard({
  session,
  lang,
  statusLabel,
}: {
  session: PublicQaSession;
  lang: "pl" | "en";
  statusLabel: string;
}) {
  const { t } = useTranslation();
  const title =
    lang === "en" ? session.title_en || session.title_pl : session.title_pl || session.title_en;
  const intro = lang === "en" ? session.intro_en : session.intro_pl;
  const fmt = (v: string | null) =>
    v
      ? new Date(v).toLocaleString(lang === "en" ? "en-GB" : "pl-PL", {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : null;

  return (
    <li className="group relative rounded-lg border border-border bg-card p-5 transition hover:border-primary/60">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
          {statusLabel}
        </span>
        {session.opens_at && (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {fmt(session.opens_at)}
          </span>
        )}
      </div>
      <h2 className="text-lg font-semibold leading-snug">
        <Link
          to="/qa/$slug"
          params={{ slug: session.slug }}
          className="after:absolute after:inset-0"
        >
          {title}
        </Link>
      </h2>
      {intro && <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{intro}</p>}
      <span className="mt-4 inline-block text-sm font-medium text-primary">
        {t("community.qa.viewSession")} -&gt;
      </span>
    </li>
  );
}
