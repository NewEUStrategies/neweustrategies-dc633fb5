// Pasek stanowisk wątku typu "stanowisko".
//
// To NIE jest ankieta i nie wolno jej tak narysować. Trzy różnice, każda
// widoczna w interfejsie:
//
//   1. RPC zwraca WYŁĄCZNIE liczby i informację, czy ja już zagłosowałem.
//      Kto jak się opowiedział, nie jest informacją publiczną (`club_stances`
//      trzyma `user_id`, ale `club_stance_summary` go nie oddaje). Dlatego
//      nigdzie tu nie ma listy nazwisk i nie da się jej dorobić z tych danych.
//   2. Stanowisko można ZMIENIĆ - `ON CONFLICT DO UPDATE` w bazie. Przyciski
//      są więc przełącznikami stanu, nie jednorazowym oddaniem głosu.
//   3. Baza przyjmuje stanowiska wyłącznie dla `kind = 'position'`. Pasek nie
//      renderuje się nigdzie indziej, żeby nie obiecywać akcji, która skończy
//      się błędem 22023.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Check, Minus, ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { toStanceTallies } from "@/lib/clubs/stances";
import type { ClubStance, ClubStanceSummaryRow } from "@/lib/clubs/types";

const STANCE_ICON: Record<ClubStance, React.ComponentType<{ className?: string }>> = {
  support: ThumbsUp,
  oppose: ThumbsDown,
  abstain: Minus,
};

const STANCE_BAR: Record<ClubStance, string> = {
  support: "bg-emerald-500/70",
  oppose: "bg-rose-500/70",
  abstain: "bg-muted-foreground/40",
};

export function ClubStanceBar({
  rows,
  disabled,
  pending,
  onSet,
}: {
  rows: readonly ClubStanceSummaryRow[];
  disabled: boolean;
  pending: boolean;
  onSet: (stance: ClubStance) => void;
}) {
  const { t } = useTranslation();
  const tallies = useMemo(() => toStanceTallies(rows), [rows]);
  const total = tallies.reduce((sum, s) => sum + s.total, 0);
  const myStance = tallies.find((s) => s.mine)?.stance ?? null;

  return (
    <section
      aria-labelledby="club-stance-heading"
      className="rounded-lg border border-border/60 bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="club-stance-heading" className="text-sm font-semibold">
          {t("club.stance.summary")}
        </h2>
        <span className="text-xs text-muted-foreground">
          {t("club.stance.total", { count: total })}
        </span>
      </div>

      {/* Proporcja przed liczbami: kształt rozkładu czyta się szybciej niż trzy
          liczby, a przy zerze głosów pasek jest po prostu pusty. */}
      <div
        className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={t("club.stance.distribution")}
      >
        {total > 0
          ? tallies.map((s) =>
              s.total === 0 ? null : (
                <div
                  key={s.stance}
                  className={STANCE_BAR[s.stance]}
                  style={{ width: `${(s.total / total) * 100}%` }}
                />
              ),
            )
          : null}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {tallies.map((s) => {
          const Icon = STANCE_ICON[s.stance];
          return (
            <button
              key={s.stance}
              type="button"
              disabled={disabled || pending}
              aria-pressed={s.mine}
              onClick={() => onSet(s.stance)}
              className={cn(
                "flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                s.mine
                  ? "border-primary bg-primary/10 font-medium"
                  : "border-border/60 hover:border-primary/40",
                (disabled || pending) && "cursor-not-allowed opacity-60",
              )}
            >
              <span className="inline-flex items-center gap-2">
                <Icon className="h-4 w-4" />
                {t(`club.stance.${s.stance}`)}
              </span>
              <span className="inline-flex items-center gap-1.5 tabular-nums text-muted-foreground">
                {s.total}
                {s.mine ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        {disabled
          ? t("club.stance.readOnly")
          : myStance === null
            ? t("club.stance.hint")
            : t("club.stance.changeHint")}
      </p>
    </section>
  );
}
