import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowLeft, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { AuthGate } from "@/components/profile/AuthGate";
import {
  scoreAnswers, answeredCount, isComplete, AXES, type PersonalityQuestion,
} from "@/lib/profile/personality";
import "@/lib/i18n-profile";
import "@/lib/i18n-profile-extras2";

export const Route = createFileRoute("/profile/personality")({
  component: () => (
    <AuthGate>
      <PersonalityRoute />
    </AuthGate>
  ),
});

const AXIS_COLOR: Record<string, string> = {
  openness: "bg-violet-500",
  conscientiousness: "bg-sky-500",
  extraversion: "bg-emerald-500",
  agreeableness: "bg-amber-500",
  neuroticism: "bg-rose-500",
};

function PersonalityRoute() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const lang = (i18n.language || "pl").startsWith("pl") ? "pl" : "en";
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitting, setSubmitting] = useState(false);

  const qQ = useQuery({
    queryKey: ["personality_questions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("personality_questions")
        .select("id,axis,reverse,text_pl,text_en,sort_order")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PersonalityQuestion[];
    },
  });

  const qPrev = useQuery({
    queryKey: ["personality_results", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("personality_results")
        .select("openness,conscientiousness,extraversion,agreeableness,neuroticism,taken_at,tenant_id")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error && error.code !== "PGRST116") throw error;
      return data ?? null;
    },
  });

  const profileQ = useQuery({
    queryKey: ["profile-tenant", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const questions = qQ.data ?? [];
  const done = answeredCount(answers, questions);
  const complete = useMemo(() => isComplete(answers, questions), [answers, questions]);

  async function onSubmit() {
    if (!user || !profileQ.data?.tenant_id) return;
    if (!complete) return toast.error(t("profile.personality.requireAll"));
    setSubmitting(true);
    try {
      const scores = scoreAnswers(answers, questions);
      const { error } = await supabase.from("personality_results").upsert(
        {
          user_id: user.id,
          tenant_id: profileQ.data.tenant_id,
          ...scores,
          answers: answers as Record<string, number>,
          taken_at: new Date().toISOString(),
        },
        { onConflict: "user_id,tenant_id" },
      );
      if (error) throw error;
      toast.success(t("profile.personality.saved"));
      navigate({ to: "/profile" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (qQ.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4">
      <header className="space-y-2">
        <Link to="/profile" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
          <ArrowLeft className="h-3.5 w-3.5" /> {t("profile.personality.back")}
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Sparkles className="h-5 w-5 text-primary" />
          {t("profile.personality.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("profile.personality.intro")}</p>
        {qPrev.data?.taken_at ? (
          <p className="text-xs text-muted-foreground">
            {t("profile.personality.lastTaken", { date: new Date(qPrev.data.taken_at).toLocaleString() })}
          </p>
        ) : null}
      </header>

      {/* Sticky progress */}
      <div className="sticky top-2 z-10 rounded-[6px] border border-border bg-card/95 p-3 backdrop-blur">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-medium">{t("profile.personality.progress", { done, total: questions.length })}</span>
          <span className="text-muted-foreground">{Math.round((done / Math.max(questions.length, 1)) * 100)}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${(done / Math.max(questions.length, 1)) * 100}%` }} />
        </div>
      </div>

      <ol className="space-y-3">
        {questions.map((q, idx) => {
          const v = answers[q.id];
          return (
            <li key={q.id} className="rounded-[6px] border border-border bg-card p-4">
              <p className="mb-3 text-sm font-medium">
                <span className="mr-2 text-muted-foreground">{idx + 1}.</span>
                {lang === "pl" ? q.text_pl : q.text_en}
              </p>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`Q${idx + 1}`}>
                {([1,2,3,4,5] as const).map((n) => {
                  const active = v === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setAnswers((a) => ({ ...a, [q.id]: n }))}
                      className={
                        "flex-1 min-w-[64px] rounded-[6px] border px-2 py-2 text-xs transition " +
                        (active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background hover:bg-muted")
                      }
                    >
                      <div className="text-sm font-semibold">{n}</div>
                      <div className="mt-0.5 text-[10px] leading-tight opacity-80">
                        {t(`profile.personality.scale.${n}`)}
                      </div>
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Link to="/profile" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
          <ArrowLeft className="h-3.5 w-3.5" /> {t("profile.personality.back")}
        </Link>
        <div className="flex items-center gap-2">
          {qPrev.data ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setAnswers({})} className="h-8 text-xs">
              <RotateCcw className="mr-1 h-3.5 w-3.5" /> {t("profile.personality.retake")}
            </Button>
          ) : null}
          <Button type="button" size="sm" disabled={!complete || submitting} onClick={onSubmit} className="h-8 text-xs">
            {submitting ? t("profile.personality.submitting") : t("profile.personality.submit")}
          </Button>
        </div>
      </div>

      {/* Live preview of scoring */}
      {complete ? (
        <section className="rounded-[6px] border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">{t("profile.personality.yourScore")}</h2>
          <div className="space-y-2.5">
            {AXES.map((axis) => {
              const value = scoreAnswers(answers, questions)[axis];
              const [low, high] = t(`profile.personality.lowHigh.${axis}`, { returnObjects: true }) as [string, string];
              return (
                <div key={axis}>
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">{low}</span>
                    <span className="font-medium">{high}</span>
                  </div>
                  <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className={`h-full ${AXIS_COLOR[axis]} transition-all`} style={{ width: `${value}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
