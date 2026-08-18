// /admin/tracker-guide - dokumentacja panelu Trackera UE.
//
// Cała treść (kroki konfiguracji + opis zachowania systemu) mieszka w słowniku
// `i18n-admin-tracker-guide.ts`. Wcześniej trasa niosła dwie tablice kroków
// wybierane ternarem po języku i lokalny bliźniak `L(pl, en)` - czyli
// dokumentację, której nie widziała ani bramka parytetu PL/EN, ani tłumacz.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, BookOpen, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ensureI18n as ensureAdminTrackerGuideI18n } from "@/lib/i18n-admin-tracker-guide";

export const Route = createFileRoute("/admin/tracker-guide")({
  component: TrackerGuidePage,
});

interface Step {
  readonly title: string;
  readonly body: string;
}

/** Zawężenie tego, co `returnObjects: true` oddaje jako `unknown`. */
function isStep(value: unknown): value is Step {
  if (value === null || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.title === "string" && typeof row.body === "string";
}

function TrackerGuidePage() {
  // Rejestracja słownika w chunku KOMPONENTU trasy (nie w entry) - patrz
  // komentarz przy ensureI18n w lib/i18n-admin-tracker-guide.ts.
  ensureAdminTrackerGuideI18n();
  const { t } = useTranslation();
  const steps = t("adminTrackerGuide.steps", { returnObjects: true });

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <BookOpen className="h-6 w-6" aria-hidden="true" />
            {t("adminTrackerGuide.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("adminTrackerGuide.subtitle")}</p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/admin/tracker">
            <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t("adminTrackerGuide.backToPanel")}
          </Link>
        </Button>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("adminTrackerGuide.stepsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(Array.isArray(steps) ? steps : []).filter(isStep).map((s) => (
            <div key={s.title} className="flex gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <div className="font-medium">{s.title}</div>
                <p className="mt-0.5 text-sm text-muted-foreground">{s.body}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("adminTrackerGuide.behaviorTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>{t("adminTrackerGuide.behavior.statuses")}</p>
          <p>{t("adminTrackerGuide.behavior.trigger")}</p>
          <p>{t("adminTrackerGuide.behavior.tick")}</p>
          <p>{t("adminTrackerGuide.behavior.stats")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
