// Quiz osobowości Big Five: pulpit wyników + quiz z autozapisem szkicu.
//
// Pulpit jest widokiem domyślnym, gdy istnieje zapisany wynik: 5 pasków cech
// z interpretacją przedziału (niski/umiarkowany/wysoki) oraz historia podejść
// (personality_result_history - append-only, wypełniana triggerem DB).
// Odpowiedzi w trakcie wypełniania trafiają do localStorage, więc przeładowanie
// strony nie kasuje 30 odpowiedzi.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, History, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AuthGate } from "@/components/profile/AuthGate";
import {
  scoreAnswers,
  answeredCount,
  isComplete,
  AXES,
  type PersonalityQuestion,
} from "@/lib/profile/personality";
import type { Database } from "@/integrations/supabase/types";
import "@/lib/i18n-profile";
import "@/lib/i18n-profile-extras2";
import "@/lib/i18n-personality";

export const Route = createFileRoute("/profile/personality")({
  component: () => (
    <AuthGate>
      <PersonalityRoute />
    </AuthGate>
  ),
});

type HistoryRow = Database["public"]["Tables"]["personality_result_history"]["Row"];
type Axis = (typeof AXES)[number];

const AXIS_COLOR: Record<string, string> = {
  openness: "bg-violet-500",
  conscientiousness: "bg-sky-500",
  extraversion: "bg-emerald-500",
  agreeableness: "bg-amber-500",
  neuroticism: "bg-rose-500",
};

// Skróty osi w historii (O/C/E/A/N - konwencja Big Five).
const AXIS_SHORT: Record<Axis, string> = {
  openness: "O",
  conscientiousness: "C",
  extraversion: "E",
  agreeableness: "A",
  neuroticism: "N",
};

const DRAFT_KEY = "nes.personality.draft.v1";

function readDraft(): Record<number, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Record<number, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const id = Number(k);
      if (Number.isInteger(id) && typeof v === "number" && v >= 1 && v <= 5) out[id] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeDraft(answers: Record<number, number>): void {
  if (typeof window === "undefined") return;
  try {
    if (Object.keys(answers).length === 0) window.localStorage.removeItem(DRAFT_KEY);
    else window.localStorage.setItem(DRAFT_KEY, JSON.stringify(answers));
  } catch {
    /* private mode / quota - szkic po prostu nie przetrwa przeładowania */
  }
}

function bandOf(value: number): "low" | "medium" | "high" {
  if (value < 35) return "low";
  if (value <= 65) return "medium";
  return "high";
}

function fmtDate(iso: string, lang: "pl" | "en"): string {
  return new Date(iso).toLocaleDateString(lang === "en" ? "en-US" : "pl-PL", {
    dateStyle: "medium",
  });
}

function TraitBar({ axis, value }: { axis: Axis; value: number }) {
  const { t } = useTranslation();
  const band = bandOf(value);
  const [low, high] = t(`profile.personality.lowHigh.${axis}`, {
    returnObjects: true,
  }) as [string, string];
  return (
    <div className="rounded-[6px] border border-border bg-card p-4">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{t(`profile.personality.axes.${axis}`)}</span>
        <span className="flex items-center gap-2">
          <Badge variant="secondary" className="text-[10px]">
            {t(`personality.bands.${band}`)}
          </Badge>
          <span className="text-sm font-semibold tabular-nums">{value}</span>
        </span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full ${AXIS_COLOR[axis]} transition-all`}
          style={{ width: `${value}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{low}</span>
        <span>{high}</span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {t(`personality.interpretations.${axis}.${band}`)}
      </p>
    </div>
  );
}

function HistoryList({ rows, lang }: { rows: HistoryRow[]; lang: "pl" | "en" }) {
  const { t } = useTranslation();
  if (rows.length <= 1) {
    return <p className="text-xs text-muted-foreground">{t("personality.historyEmpty")}</p>;
  }
  return (
    <ul className="divide-y divide-border/60">
      {rows.map((row, idx) => {
        const prev = rows[idx + 1];
        return (
          <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-xs">
            <span className="w-28 shrink-0 text-muted-foreground">
              {fmtDate(row.taken_at, lang)}
            </span>
            {AXES.map((axis) => {
              const value = row[axis];
              const delta = prev ? value - prev[axis] : 0;
              return (
                <span key={axis} className="inline-flex items-center gap-0.5 tabular-nums">
                  <span className="text-muted-foreground">{AXIS_SHORT[axis]}</span>
                  <span className="font-medium">{value}</span>
                  {prev && delta !== 0 && (
                    <span
                      className={
                        delta > 0
                          ? "inline-flex items-center text-emerald-600 dark:text-emerald-400"
                          : "inline-flex items-center text-rose-600 dark:text-rose-400"
                      }
                    >
                      {delta > 0 ? (
                        <ArrowUp className="h-3 w-3" aria-hidden />
                      ) : (
                        <ArrowDown className="h-3 w-3" aria-hidden />
                      )}
                      {Math.abs(delta)}
                    </span>
                  )}
                  {prev && delta === 0 && <span className="text-muted-foreground/60">-</span>}
                </span>
              );
            })}
          </li>
        );
      })}
    </ul>
  );
}

function PersonalityRoute() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const lang = (i18n.language || "pl").startsWith("pl") ? "pl" : "en";
  const [answers, setAnswers] = useState<Record<number, number>>(() => readDraft());
  const [submitting, setSubmitting] = useState(false);
  // null = tryb wynika z danych (pulpit gdy jest wynik); jawna wartość po akcji
  // użytkownika ("Wypełnij ponownie" / "Wróć do wyników").
  const [modeOverride, setModeOverride] = useState<"dashboard" | "quiz" | null>(null);
  const draftToastShown = useRef(false);

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
        .select(
          "openness,conscientiousness,extraversion,agreeableness,neuroticism,taken_at,tenant_id",
        )
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error && error.code !== "PGRST116") throw error;
      return data ?? null;
    },
  });

  const historyQ = useQuery({
    queryKey: ["personality_history", user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<HistoryRow[]> => {
      const { data, error } = await supabase
        .from("personality_result_history")
        .select("*")
        .eq("user_id", user!.id)
        .order("taken_at", { ascending: false })
        .limit(12);
      if (error) throw error;
      return data ?? [];
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

  // Autozapis szkicu + jednorazowa informacja o przywróceniu.
  useEffect(() => {
    writeDraft(answers);
  }, [answers]);
  // Toast o przywróconym szkicu dopiero, gdy quiz jest faktycznie widoczny
  // (po rozstrzygnięciu zapytania o wynik) - użytkownik lądujący na pulpicie
  // nie dostaje komunikatu o odpowiedziach, których nie widzi.
  const mode: "dashboard" | "quiz" = modeOverride ?? (qPrev.data ? "dashboard" : "quiz");
  useEffect(() => {
    if (draftToastShown.current) return;
    if (qPrev.isLoading || mode !== "quiz") return;
    if (Object.keys(answers).length === 0) return;
    draftToastShown.current = true;
    toast.info(t("personality.draftRestored"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, qPrev.isLoading]);

  const questions = useMemo(() => qQ.data ?? [], [qQ.data]);
  const done = answeredCount(answers, questions);
  const complete = useMemo(() => isComplete(answers, questions), [answers, questions]);

  async function onSubmit() {
    if (!user || !profileQ.data?.tenant_id) return;
    if (!complete) return toast.error(t("profile.personality.requireAll"));
    setSubmitting(true);
    try {
      const scores = scoreAnswers(answers, questions);
      // onConflict musi wskazywać istniejący klucz unikalny: PK to (user_id).
      // Poprzednie "user_id,tenant_id" Postgres odrzucał (42P10) - zapis
      // wyniku NIGDY nie przechodził.
      const { error } = await supabase.from("personality_results").upsert(
        {
          user_id: user.id,
          tenant_id: profileQ.data.tenant_id,
          ...scores,
          answers: answers as Record<string, number>,
          taken_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;
      setAnswers({});
      writeDraft({});
      setModeOverride("dashboard");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["personality_results", user.id] }),
        qc.invalidateQueries({ queryKey: ["personality_history", user.id] }),
      ]);
      toast.success(t("profile.personality.saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (qQ.isLoading || qPrev.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (mode === "dashboard" && qPrev.data) {
    const result = qPrev.data;
    return (
      <div className="mx-auto max-w-3xl space-y-5 p-4">
        <header className="space-y-2">
          <Link
            to="/profile"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> {t("profile.personality.back")}
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Sparkles className="h-5 w-5 text-primary" />
            {t("personality.dashboardTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("personality.dashboardSubtitle")}</p>
          <p className="text-xs text-muted-foreground">
            {t("personality.lastTaken", { date: fmtDate(result.taken_at, lang) })}
          </p>
        </header>

        <div className="space-y-3">
          {AXES.map((axis) => (
            <TraitBar key={axis} axis={axis} value={result[axis]} />
          ))}
        </div>

        <section className="rounded-[6px] border border-border bg-card p-4">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <History className="h-4 w-4 text-muted-foreground" aria-hidden />
            {t("personality.historyTitle")}
          </h2>
          <HistoryList rows={historyQ.data ?? []} lang={lang} />
        </section>

        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setAnswers({});
              writeDraft({});
              setModeOverride("quiz");
            }}
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {t("personality.retakeCta")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4">
      <header className="space-y-2">
        {qPrev.data ? (
          <button
            type="button"
            onClick={() => setModeOverride("dashboard")}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> {t("personality.backToDashboard")}
          </button>
        ) : (
          <Link
            to="/profile"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> {t("profile.personality.back")}
          </Link>
        )}
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Sparkles className="h-5 w-5 text-primary" />
          {t("profile.personality.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("profile.personality.intro")}</p>
      </header>

      {/* Sticky progress */}
      <div className="sticky top-2 z-10 rounded-[6px] border border-border bg-card/95 p-3 backdrop-blur">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-medium">
            {t("profile.personality.progress", { done, total: questions.length })}
          </span>
          <span className="text-muted-foreground">
            {Math.round((done / Math.max(questions.length, 1)) * 100)}%
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${(done / Math.max(questions.length, 1)) * 100}%` }}
          />
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
                {([1, 2, 3, 4, 5] as const).map((n) => {
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

      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
        <div className="flex items-center gap-2">
          {done > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setAnswers({});
                writeDraft({});
              }}
              className="h-8 text-xs"
            >
              <RotateCcw className="mr-1 h-3.5 w-3.5" /> {t("profile.personality.retake")}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            disabled={!complete || submitting}
            onClick={onSubmit}
            className="h-8 text-xs"
          >
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
              const [low, high] = t(`profile.personality.lowHigh.${axis}`, {
                returnObjects: true,
              }) as [string, string];
              return (
                <div key={axis}>
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">{low}</span>
                    <span className="font-medium">{high}</span>
                  </div>
                  <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full ${AXIS_COLOR[axis]} transition-all`}
                      style={{ width: `${value}%` }}
                    />
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
