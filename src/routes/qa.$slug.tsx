// Szczegóły sesji Q&A + lista pytań + formularz. URL: /qa/$slug
// Pytania idą WYŁĄCZNIE przez RPC ask_qa_question (status sesji, rate limit
// 5/h, sanitizowany author_display - nigdy pełny e-mail, powiadomienie
// hosta). Lista przez list_qa_questions: porządek priorytet Pro (flaga
// qa_priority) > głosy > starszeństwo, licznik głosów w jednej podróży.
import { createFileRoute, Link, notFound, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  MessageSquare,
  Sparkles,
  ThumbsUp,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  askQaQuestion,
  fetchPublicQaSessionBySlug,
  fetchPublicQaQuestions,
  fetchQaSummaryPost,
  type PublicQaSession,
} from "@/lib/community/publicQueries";
import { useCommunityModules } from "@/lib/community/useCommunityModules";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { CommunityDisabled } from "@/components/community/CommunityDisabled";
import { getPublicTenantId } from "@/lib/community/tenant";
import { cn } from "@/lib/utils";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead, splitUrl, SITE_NAME } from "@/lib/seo/meta";
import { breadcrumbListJsonLd, qaPageJsonLd, safeJsonLd } from "@/lib/seo/jsonld";

import { ensureI18n as ensureCommunityI18n } from "@/lib/i18n-community";

/** Skraca tytuł do limitu SERP (<60 zn.) bez ucinania w połowie wyrazu. */
function clampTitle(value: string, max = 60): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 24 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

interface QaSessionHeadQuestion {
  id: string;
  body: string;
  answer: string | null;
  authorName: string | null;
  createdAt: string | null;
  answeredAt: string | null;
  upvotes: number;
}

interface QaSessionHeadData {
  titlePl: string;
  titleEn: string;
  introPl: string | null;
  introEn: string | null;
  openedAt: string | null;
  closedAt: string | null;
  /** Wyłącznie pytania z opublikowaną odpowiedzią - tylko takie trafiają
   *  do markupu QAPage (pytanie bez odpowiedzi jest nieważne w rich results). */
  answered: QaSessionHeadQuestion[];
}

/**
 * Klucze cache sesji i jej pytań - JEDNO źródło dla loadera i dla widoku.
 * Rozjazd tych dwóch miejsc nie psuje niczego widocznie: zasiew po prostu
 * przestaje być odczytany i round-trip po hydratacji wraca po cichu.
 */
export const qaSessionQueryKey = (slug: string) => ["public-qa-session", slug] as const;
export const qaQuestionsQueryKey = (sessionId: string | null) =>
  ["public-qa-questions", sessionId] as const;

export const Route = createFileRoute("/qa/$slug")({
  component: QaDetail,
  // ── DWIE RÓŻNE PRAWDY, DWIE RÓŻNE ODPOWIEDZI ─────────────────────────────
  // Loader ROZDZIELA „tej sesji nie ma" od „backend nie odpowiada":
  //   * slug, którego nie ma w widocznym obszarze roboczym -> `notFound()`,
  //     czyli HTTP 404. Wcześniej wychodziło stąd HTTP 200 z komunikatem
  //     `community.common.loadError`, więc każdy literówkowy i każdy usunięty
  //     adres zostawał w indeksie jako strona bez treści - nierozróżnialny
  //     od awarii;
  //   * awaria odczytu -> `null`, czyli HTTP 200 z brandowym fallbackiem.
  //     404 przy blipie bazy WYPISAŁBY z indeksu działające sesje, więc ta
  //     gałąź świadomie NIE jest 404 (ten sam błąd popełnia `programs.$slug`).
  //
  // Loader ZASIEWA też cache react-query tymi samymi kluczami, których używa
  // komponent (`["public-qa-session", slug]`, `["public-qa-questions", id]`).
  // Wcześniej wołał fetchery WPROST, więc oba odczyty leciały drugi raz
  // z przeglądarki po hydratacji - a to treść NAD ZGIĘCIEM (tytuł sesji,
  // lista pytań). Zasiew jest w `ensureQueryData`, więc dehydrowany ładunek
  // SSR niesie je do klienta, zamiast dwóch round-tripów.
  loader: async ({ context, params }): Promise<QaSessionHeadData | null> => {
    let session: PublicQaSession | null;
    try {
      session = await context.queryClient.ensureQueryData({
        queryKey: qaSessionQueryKey(params.slug),
        queryFn: () => fetchPublicQaSessionBySlug(params.slug),
      });
    } catch {
      return null;
    }
    if (!session) throw notFound();
    // Stała, żeby domknięcie `queryFn` nie potrzebowało `!` - zawężenie
    // z `if` nie przechodzi przez granicę funkcji przy zmiennej `let`.
    const found = session;
    let answered: QaSessionHeadQuestion[] = [];
    try {
      const questions = await context.queryClient.ensureQueryData({
        queryKey: qaQuestionsQueryKey(found.id),
        queryFn: () => fetchPublicQaQuestions(found.id),
      });
      answered = questions
        .filter((q) => (q.answer_body ?? "").trim().length > 0)
        .slice(0, 20)
        .map((q) => ({
          id: q.id,
          body: q.body,
          answer: q.answer_body,
          authorName: q.is_anonymous ? null : q.author_display,
          createdAt: q.created_at,
          answeredAt: q.answered_at,
          upvotes: q.votes,
        }));
    } catch {
      /* markup Q&A jest opcjonalny - brak pytań nie może psuć trasy */
    }
    return {
      titlePl: found.title_pl,
      titleEn: found.title_en,
      introPl: found.intro_pl,
      introEn: found.intro_en,
      openedAt: found.opens_at,
      closedAt: found.closes_at,
      answered,
    };
  },
  notFoundComponent: () => <QaSessionNotFound />,
  head: ({ params, loaderData }) => {
    const url = getRequestUrl() || `/qa/${params.slug}`;
    const lang = activeLang(url);
    const sessionTitle = lang === "en" ? loaderData?.titleEn : loaderData?.titlePl;
    const sessionIntro = lang === "en" ? loaderData?.introEn : loaderData?.introPl;
    const fallbackTitle = lang === "en" ? "Q&A session" : "Sesja Q&A";
    const title = clampTitle(sessionTitle?.trim() || fallbackTitle);
    const description =
      sessionIntro?.trim() ||
      (lang === "en"
        ? "Community Q&A session - ask, upvote, and read expert answers."
        : "Sesja Q&A - zadawaj pytania, głosuj i czytaj odpowiedzi ekspertów.");
    const head = buildContentHead({
      url,
      lang,
      type: "article",
      title,
      documentTitle: clampTitle(`${title} - ${SITE_NAME}`),
      description,
    });
    const { origin } = splitUrl(url);
    const path = `/qa/${params.slug}`;
    const qaPage = qaPageJsonLd({
      origin,
      lang,
      path,
      name: title,
      description,
      datePublished: loaderData?.openedAt ?? null,
      dateModified: loaderData?.closedAt ?? loaderData?.openedAt ?? null,
      questions: (loaderData?.answered ?? []).map((q) => ({
        id: q.id,
        body: q.body,
        answer: q.answer,
        authorName: q.authorName,
        createdAt: q.createdAt,
        answeredAt: q.answeredAt,
        upvotes: q.upvotes,
      })),
    });
    const breadcrumbs = breadcrumbListJsonLd(
      [
        { label: lang === "en" ? "Q&A sessions" : "Sesje Q&A", href: "/qa" },
        { label: title, href: path },
      ],
      origin,
      lang,
    );
    return {
      ...head,
      scripts: [
        ...(qaPage ? [{ type: "application/ld+json", children: safeJsonLd(qaPage) }] : []),
        { type: "application/ld+json", children: safeJsonLd(breadcrumbs) },
      ],
    };
  },
});

/**
 * 404 sesji Q&A. Tekst idzie ze słownika community (ten sam, którego używa
 * widok), więc odwiedzający `/en/qa/...` nie dostaje polskiego komunikatu.
 */
function QaSessionNotFound() {
  ensureCommunityI18n();
  const { t } = useTranslation();
  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">
      <p className="text-muted-foreground">{t("community.qa.sessionNotFound")}</p>
      <Link to="/qa" className="mt-4 inline-block text-sm text-primary">
        {t("community.qa.backToList")}
      </Link>
    </div>
  );
}

function QaDetail() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureCommunityI18n();
  const { slug } = useParams({ from: "/qa/$slug" });
  const { t, i18n } = useTranslation();
  const lang = (i18n.language.startsWith("en") ? "en" : "pl") as "pl" | "en";
  const modules = useCommunityModules();
  const { user } = useAuth();
  const qc = useQueryClient();

  const sessionQ = useQuery({
    queryKey: qaSessionQueryKey(slug),
    queryFn: () => fetchPublicQaSessionBySlug(slug),
    enabled: modules.qa_enabled,
  });

  const sessionId = sessionQ.data?.id ?? null;
  const questionsQ = useQuery({
    queryKey: qaQuestionsQueryKey(sessionId),
    queryFn: () => fetchPublicQaQuestions(sessionId!),
    enabled: !!sessionId,
  });

  // Podsumowanie sesji jako treść: RLS pokazuje wyłącznie opublikowany wpis
  // (szkic z redakcyjnej kolejki nie wycieka do banera).
  const summaryPostId = sessionQ.data?.post_id ?? null;
  const summaryQ = useQuery({
    queryKey: ["qa-summary-post", summaryPostId],
    queryFn: () => fetchQaSummaryPost(summaryPostId!),
    enabled: !!summaryPostId,
    staleTime: 60_000,
  });

  const askM = useMutation({
    mutationFn: ({ body, anonymous }: { body: string; anonymous: boolean }) =>
      askQaQuestion({ sessionId: sessionId!, body, anonymous }),
    onSuccess: () => {
      toast.success(t("community.qa.submitted"));
      void qc.invalidateQueries({ queryKey: qaQuestionsQueryKey(sessionId) });
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("rate limited")) toast.error(t("community.qa.rateLimited"));
      else if (msg.includes("session closed")) toast.error(t("community.qa.sessionNotOpen"));
      else toast.error(t("community.qa.submitError"));
    },
  });

  const voteM = useMutation({
    mutationFn: async (questionId: string) => {
      if (!user) throw new Error("no user");
      // Insert pod RLS "qa votes own insert" (tylko pytania approved/answered
      // w publicznym tenancie); duplikat głosu = PK conflict, ignorowany.
      const tenant_id = await getPublicTenantId();
      const { error } = await supabase
        .from("qa_question_votes")
        .insert({ question_id: questionId, user_id: user.id, tenant_id });
      if (error && !String(error.message).toLowerCase().includes("duplicate")) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: qaQuestionsQueryKey(sessionId) }),
    onError: () => toast.error(t("community.qa.voteError")),
  });

  const [body, setBody] = useState("");
  const [anon, setAnon] = useState(false);

  if (!modules.qa_enabled) return <CommunityDisabled />;
  if (sessionQ.isLoading) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-12">{t("community.common.loading")}</div>
    );
  }
  if (!sessionQ.data) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <p className="text-muted-foreground">{t("community.common.loadError")}</p>
        <Link to="/qa" className="mt-4 inline-block text-sm text-primary">
          {t("community.qa.backToList")}
        </Link>
      </div>
    );
  }

  const s = sessionQ.data;
  const title = lang === "en" ? s.title_en || s.title_pl : s.title_pl || s.title_en;
  const intro = lang === "en" ? s.intro_en : s.intro_pl;
  // RPC i tak wymusza status='open' - formularz pokazujemy tylko wtedy.
  const canAsk = !!user && s.status === "open";

  return (
    <div className="container mx-auto max-w-3xl px-4 py-12 md:py-16">
      <Link
        to="/qa"
        className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("community.qa.backToList")}
      </Link>

      <header className="mb-8">
        <h1 className="text-4xl font-bold tracking-tight">{title}</h1>
        {intro && <p className="mt-3 whitespace-pre-line text-muted-foreground">{intro}</p>}
      </header>

      {/* Wiedza nie ginie po zamknięciu sesji: link do opublikowanego
          podsumowania (publish_qa_session_summary) nad listą pytań. */}
      {summaryQ.data && (
        <section className="mb-8 rounded-lg border border-primary/40 bg-primary/5 p-5">
          <p className="flex items-center gap-2 text-sm font-medium">
            <BookOpenCheck className="h-4 w-4 text-primary" aria-hidden="true" />
            {t("community.qa.summaryAvailable")}
          </p>
          <Button asChild size="sm" className="mt-3">
            <Link to="/post/$slug" params={{ slug: summaryQ.data.slug }}>
              {t("community.qa.summaryRead")}
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        </section>
      )}

      <section className="mb-10 rounded-lg border border-border bg-card p-5">
        <h2 className="mb-3 text-lg font-semibold">{t("community.qa.ask")}</h2>
        {!user && <p className="text-sm text-muted-foreground">{t("community.qa.signInHint")}</p>}
        {user && s.status !== "open" && (
          <p className="text-sm text-muted-foreground">{t("community.qa.sessionNotOpen")}</p>
        )}
        {canAsk && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (body.trim().length < 5) return;
              askM.mutate(
                { body: body.trim(), anonymous: anon },
                {
                  onSuccess: () => {
                    setBody("");
                    setAnon(false);
                  },
                },
              );
            }}
          >
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("community.qa.askPlaceholder")}
              rows={4}
              maxLength={2000}
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="qa-anon"
                  checked={anon}
                  onCheckedChange={(v) => setAnon(v === true)}
                />
                <Label htmlFor="qa-anon" className="text-sm">
                  {t("community.qa.askAnonymously")}
                </Label>
              </div>
              <Button type="submit" disabled={askM.isPending || body.trim().length < 5}>
                {t("community.qa.submit")}
              </Button>
            </div>
          </form>
        )}
      </section>

      <section>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <MessageSquare className="h-4 w-4" aria-hidden="true" />
          {t("community.qa.questions")}
        </h2>
        {questionsQ.data && questionsQ.data.length === 0 && (
          <p className="text-muted-foreground">{t("community.qa.noQuestions")}</p>
        )}
        <ul className="space-y-4">
          {(questionsQ.data ?? []).map((q) => {
            const author = q.is_anonymous ? t("community.qa.anonymous") : (q.author_display ?? "");
            return (
              <li key={q.id} className="rounded-lg border border-border bg-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {q.is_priority && (
                      <span className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                        <Sparkles className="h-3 w-3" aria-hidden="true" />
                        {t("community.qa.priorityBadge")}
                      </span>
                    )}
                    <p className="whitespace-pre-line text-sm text-foreground">{q.body}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => user && !q.my_vote && voteM.mutate(q.id)}
                    disabled={!user || voteM.isPending || q.my_vote}
                    aria-pressed={q.my_vote}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-60",
                      q.my_vote
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:border-primary/60",
                    )}
                    aria-label={
                      q.my_vote
                        ? `${t("community.qa.voted")} - ${t("community.qa.votes", { count: q.votes })}`
                        : t("community.qa.votes", { count: q.votes })
                    }
                    title={
                      !user
                        ? t("community.qa.signInHint")
                        : q.my_vote
                          ? t("community.qa.voted")
                          : t("community.qa.votes", { count: q.votes })
                    }
                  >
                    <ThumbsUp
                      className={cn("h-3.5 w-3.5", q.my_vote && "fill-current")}
                      aria-hidden="true"
                    />
                    <span className="tabular-nums">{q.votes}</span>
                  </button>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {author}
                  {" · "}
                  {new Date(q.created_at).toLocaleDateString(lang === "en" ? "en-GB" : "pl-PL")}
                </div>
                {q.status === "answered" && q.answer_body && (
                  <div className="mt-3 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">
                      {t("community.qa.answered")}
                    </div>
                    <p className="whitespace-pre-line">{q.answer_body}</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
