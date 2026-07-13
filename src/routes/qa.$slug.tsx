// Szczegóły sesji Q&A + lista pytań + formularz. URL: /qa/$slug
// Pytania idą WYŁĄCZNIE przez RPC ask_qa_question (status sesji, rate limit
// 5/h, sanitizowany author_display - nigdy pełny e-mail, powiadomienie
// hosta). Lista przez list_qa_questions: porządek priorytet Pro (flaga
// qa_priority) > głosy > starszeństwo, licznik głosów w jednej podróży.
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, MessageSquare, Sparkles, ThumbsUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  askQaQuestion,
  fetchPublicQaSessionBySlug,
  fetchPublicQaQuestions,
} from "@/lib/community/publicQueries";
import { useCommunityModules } from "@/lib/community/useCommunityModules";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { CommunityDisabled } from "@/components/community/CommunityDisabled";
import { getPublicTenantId } from "@/lib/community/tenant";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead } from "@/lib/seo/meta";
import "@/lib/i18n-community";

export const Route = createFileRoute("/qa/$slug")({
  component: QaDetail,
  head: ({ params }) => {
    const url = getRequestUrl() || `/qa/${params.slug}`;
    const lang = activeLang(url);
    return buildContentHead({
      url,
      lang,
      type: "article",
      title: lang === "en" ? "Q&A session" : "Sesja Q&A",
      description:
        lang === "en"
          ? "Community Q&A session - ask, upvote, and read expert answers."
          : "Sesja Q&A - zadawaj pytania, głosuj i czytaj odpowiedzi ekspertów.",
    });
  },
});

function QaDetail() {
  const { slug } = useParams({ from: "/qa/$slug" });
  const { t, i18n } = useTranslation();
  const lang = (i18n.language.startsWith("en") ? "en" : "pl") as "pl" | "en";
  const modules = useCommunityModules();
  const { user } = useAuth();
  const qc = useQueryClient();

  const sessionQ = useQuery({
    queryKey: ["public-qa-session", slug],
    queryFn: () => fetchPublicQaSessionBySlug(slug),
    enabled: modules.qa_enabled,
  });

  const sessionId = sessionQ.data?.id ?? null;
  const questionsQ = useQuery({
    queryKey: ["public-qa-questions", sessionId],
    queryFn: () => fetchPublicQaQuestions(sessionId!),
    enabled: !!sessionId,
  });

  const askM = useMutation({
    mutationFn: ({ body, anonymous }: { body: string; anonymous: boolean }) =>
      askQaQuestion({ sessionId: sessionId!, body, anonymous }),
    onSuccess: () => {
      toast.success(t("community.qa.submitted"));
      void qc.invalidateQueries({ queryKey: ["public-qa-questions", sessionId] });
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
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["public-qa-questions", sessionId] }),
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
                    onClick={() => user && voteM.mutate(q.id)}
                    disabled={!user || voteM.isPending}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:border-primary/60 disabled:opacity-50"
                    aria-label={t("community.qa.votes", { count: q.votes })}
                    title={t("community.qa.votes", { count: q.votes })}
                  >
                    <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
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
