// Molekuła: miernik kompletności profilu z listą braków.
//
// Sam procent nie zmienia zachowania - dopiero KONKRET zmienia ("+14 pkt za
// opis"), więc karta zawsze pokazuje największą lukę jako pierwszą i wprost
// nazywa zysk. Ten sam wniosek, który stoi za ReputationMeter: liczba bez
// pozycji wobec progu jest nieczytelna.
//
// Drugi próg jest realny, nie motywacyjny: od `PROFILE_SEMANTIC_MIN_SCORE`
// profil wchodzi do kolejki wektorów (`profiles_needing_embeddings`), czyli
// zaczyna być znajdowany po znaczeniu, a nie po dosłownej frazie. Znacznik na
// pasku pokazuje dokładnie to miejsce.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Check, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PROFILE_BIO_MIN,
  PROFILE_COMPLETENESS_WEIGHTS,
  PROFILE_SEMANTIC_MIN_SCORE,
  PROFILE_SKILLS_MIN,
  profileCompletenessFieldKey,
  type ProfileCompletenessField,
  type ProfileCompletenessGrade,
  type ProfileCompletenessStatus,
} from "@/lib/profile/completeness";
import { PROFILE_SEEKING_MIN } from "@/lib/profile/intents";
import "@/lib/i18n-profile-intent";

const FILL: Record<ProfileCompletenessGrade, string> = {
  strong: "bg-emerald-500",
  partial: "bg-[var(--brand)]",
  thin: "bg-amber-500",
};

/** Progi wchodzą do etykiet pól jako interpolacja - jedna mapa, zero literałów w JSX. */
const FIELD_INTERPOLATION: Partial<Record<ProfileCompletenessField, { min: number }>> = {
  bio: { min: PROFILE_BIO_MIN },
  seeking: { min: PROFILE_SEEKING_MIN },
  skills: { min: PROFILE_SKILLS_MIN },
};

interface ProfileCompletenessCardProps {
  status: ProfileCompletenessStatus;
  /** Pokaż też pola już uzupełnione (pełna checklista). Domyślnie tylko braki. */
  showCompleted?: boolean;
  className?: string;
}

export function ProfileCompletenessCard({
  status,
  showCompleted = false,
  className,
}: ProfileCompletenessCardProps) {
  const { t } = useTranslation();

  const fieldLabel = useMemo(
    () => (field: ProfileCompletenessField) =>
      t(profileCompletenessFieldKey(field), FIELD_INTERPOLATION[field] ?? {}),
    [t],
  );

  const completed = showCompleted
    ? (Object.keys(status.fields) as ProfileCompletenessField[])
        .filter((field) => status.fields[field])
        .sort((a, b) => PROFILE_COMPLETENESS_WEIGHTS[b] - PROFILE_COMPLETENESS_WEIGHTS[a])
    : [];

  const semanticReached = status.score >= PROFILE_SEMANTIC_MIN_SCORE;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-display text-2xl tabular-nums leading-none">
          {t("profileCompleteness.score", { score: status.score })}
        </span>
        <span
          className={cn(
            "rounded-[4px] border px-1.5 py-0.5 text-[11px] font-medium",
            status.grade === "strong"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : status.grade === "partial"
                ? "border-[var(--brand)]/40 bg-[var(--brand)]/10 text-[var(--brand)]"
                : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
          )}
        >
          {t(`profileCompleteness.grade.${status.grade}`)}
        </span>
      </div>

      <div
        className="relative h-2 w-full overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-valuenow={status.score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("profileCompleteness.meterLabel", { score: status.score })}
        data-grade={status.grade}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none",
            FILL[status.grade],
          )}
          style={{ width: `${status.score}%` }}
        />
        {/* Znacznik progu indeksowania semantycznego - stała pozycja na skali. */}
        <span
          aria-hidden="true"
          className="absolute top-0 h-full w-px bg-foreground/40"
          style={{ left: `${PROFILE_SEMANTIC_MIN_SCORE}%` }}
        />
      </div>

      <p
        className={cn(
          "flex items-center gap-1.5 text-[11px]",
          semanticReached ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground",
        )}
      >
        <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
        {semanticReached
          ? t("profileCompleteness.semanticGateReached")
          : t("profileCompleteness.semanticGate", { score: PROFILE_SEMANTIC_MIN_SCORE })}
      </p>

      {status.nextField ? (
        <>
          <p className="text-xs font-medium">
            {t("profileCompleteness.nextGain", {
              gain: status.nextGain,
              field: fieldLabel(status.nextField),
            })}
          </p>
          <div>
            <p className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
              {t("profileCompleteness.missingHeader")}
            </p>
            <ul className="grid gap-1 sm:grid-cols-2">
              {status.missing.map((field) => (
                <li
                  key={field}
                  className="flex items-center justify-between gap-2 rounded-[4px] border border-dashed border-border/70 px-2 py-1 text-[11px]"
                >
                  <span className="min-w-0 truncate text-muted-foreground">
                    {fieldLabel(field)}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground/70">
                    +{PROFILE_COMPLETENESS_WEIGHTS[field]}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
          <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {t("profileCompleteness.allDone")}
        </p>
      )}

      {completed.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
            {t("profileCompleteness.doneHeader")}
          </p>
          <ul className="grid gap-1 sm:grid-cols-2">
            {completed.map((field) => (
              <li
                key={field}
                className="flex items-center gap-1.5 rounded-[4px] border border-border/60 bg-muted/20 px-2 py-1 text-[11px] text-muted-foreground"
              >
                <Check
                  className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400"
                  aria-hidden
                />
                <span className="min-w-0 truncate">{fieldLabel(field)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
