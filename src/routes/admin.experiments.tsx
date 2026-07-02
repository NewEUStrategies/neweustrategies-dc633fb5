// A/B experiment results: exposures, conversions, conversion rate per variant
// and a two-proportion z-test verdict. Experiments are created from the page
// builder (right-click a section -> "Utwórz test A/B").
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FlaskConical, Pause, Play, Trash2 } from "@/lib/lucide-shim";
import {
  conversionRate,
  useExperimentsAdmin,
  useExperimentStats,
  zScore,
  type BuilderExperiment,
} from "@/lib/builder/experiments";

export const Route = createFileRoute("/admin/experiments")({
  component: ExperimentsPage,
});

function ExperimentsPage() {
  const { t } = useTranslation();
  const experiments = useExperimentsAdmin();

  const removeExperiment = async (x: BuilderExperiment) => {
    if (
      !window.confirm(
        t("admin.experiments.confirmDelete", {
          defaultValue: 'Usunąć test "{{name}}" wraz z zebranymi danymi?',
          name: x.name,
        }),
      )
    )
      return;
    await experiments.remove(x.id);
    toast.success(t("admin.experiments.deleted", { defaultValue: "Usunięto test" }));
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold inline-flex items-center gap-2">
          <FlaskConical className="w-6 h-6 text-brand" />
          {t("admin.experiments.title", { defaultValue: "Testy A/B" })}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("admin.experiments.subtitle", {
            defaultValue:
              "Testy sekcji tworzone w builderze stron (menu kontekstowe sekcji). Wariant przydzielany jest deterministycznie per odwiedzający, 50/50.",
          })}
        </p>
      </header>

      {experiments.loading ? (
        <p className="text-sm text-muted-foreground">
          {t("admin.experiments.loading", { defaultValue: "Ładowanie…" })}
        </p>
      ) : experiments.items.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {t("admin.experiments.empty", {
              defaultValue:
                "Brak testów. Kliknij sekcję prawym przyciskiem w builderze strony i wybierz „Utwórz test A/B”.",
            })}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {experiments.items.map((x) => (
            <ExperimentCard
              key={x.id}
              experiment={x}
              onPause={() => void experiments.setStatus(x.id, "paused")}
              onResume={() => void experiments.setStatus(x.id, "running")}
              onRemove={() => void removeExperiment(x)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ExperimentCard({
  experiment,
  onPause,
  onResume,
  onRemove,
}: {
  experiment: BuilderExperiment;
  onPause: () => void;
  onResume: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const stats = useExperimentStats(experiment.id);

  const statusLabel =
    experiment.status === "running"
      ? t("admin.experiments.statusRunning", { defaultValue: "Trwa" })
      : experiment.status === "paused"
        ? t("admin.experiments.statusPaused", { defaultValue: "Wstrzymany" })
        : t("admin.experiments.statusCompleted", { defaultValue: "Zakończony" });
  const statusCls =
    experiment.status === "running"
      ? "bg-emerald-500/15 text-emerald-600"
      : experiment.status === "paused"
        ? "bg-amber-500/15 text-amber-600"
        : "bg-muted text-muted-foreground";

  const s = stats.data;
  const z = s ? zScore(s) : 0;
  const significant = Math.abs(z) >= 1.96;
  const winner = z > 0 ? "B" : "A";

  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="font-medium truncate">{experiment.name}</h2>
          <span
            className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full ${statusCls}`}
          >
            {statusLabel}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {experiment.status === "running" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onPause}
              title={t("admin.experiments.pause", { defaultValue: "Wstrzymaj" })}
            >
              <Pause className="w-4 h-4" />
            </Button>
          )}
          {experiment.status === "paused" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onResume}
              title={t("admin.experiments.resume", { defaultValue: "Wznów" })}
            >
              <Play className="w-4 h-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            title={t("admin.experiments.delete", { defaultValue: "Usuń" })}
          >
            <Trash2 className="w-4 h-4 text-destructive" />
          </Button>
        </div>
      </div>

      {!s ? (
        <p className="text-xs text-muted-foreground">
          {t("admin.experiments.loadingStats", { defaultValue: "Ładowanie wyników…" })}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            {(["a", "b"] as const).map((variant) => {
              const exposures = s.exposures[variant];
              const conversions = s.conversions[variant];
              const cr = conversionRate(exposures, conversions);
              return (
                <div
                  key={variant}
                  className="rounded border border-border bg-muted/20 p-3 space-y-1"
                >
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t("admin.experiments.variant", { defaultValue: "Wariant" })}{" "}
                    {variant.toUpperCase()}
                  </div>
                  <div className="text-sm">
                    {t("admin.experiments.exposures", { defaultValue: "Wyświetlenia" })}:{" "}
                    <span className="font-medium">{exposures}</span>
                  </div>
                  <div className="text-sm">
                    {t("admin.experiments.conversions", { defaultValue: "Konwersje (kliknięcia)" })}
                    : <span className="font-medium">{conversions}</span>
                  </div>
                  <div className="text-sm">
                    {t("admin.experiments.cr", { defaultValue: "Współczynnik konwersji" })}:{" "}
                    <span className="font-medium">{(cr * 100).toFixed(1)}%</span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            {s.exposures.a + s.exposures.b === 0
              ? t("admin.experiments.noData", {
                  defaultValue:
                    "Brak danych - test zbiera wyniki po opublikowaniu strony z wariantami.",
                })
              : significant
                ? t("admin.experiments.significant", {
                    defaultValue:
                      "Wynik istotny statystycznie (95%) - prowadzi wariant {{winner}}.",
                    winner,
                  })
                : t("admin.experiments.notSignificant", {
                    defaultValue: "Różnica nie jest jeszcze istotna statystycznie (|z| = {{z}})",
                    z: Math.abs(z).toFixed(2),
                  })}
          </p>
        </>
      )}
    </div>
  );
}
