// Publiczny indeks trackera legislacyjnego UE. URL: /tracker - siatka
// opublikowanych dossier z filtrami (obszar polityki, etap), paskiem postępu
// procedury, następnym kamieniem milowym i licznikiem obserwujących.
import { Fragment, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CalendarClock, Landmark, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { usePublishedItems, useFollowerCounts, type PolicyItem } from "@/lib/tracker/queries";
import {
  POLICY_STAGES,
  POLICY_AREAS,
  STAGE_LABELS,
  stageIndex,
  stageLabel,
  isTerminal,
} from "@/lib/tracker/stages";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead } from "@/lib/seo/meta";
import "@/lib/i18n-tracker";

export const Route = createFileRoute("/tracker/")({
  head: () => {
    const url = getRequestUrl() || "/tracker";
    const lang = activeLang(url);
    return buildContentHead({
      url,
      lang,
      type: "website",
      title:
        lang === "en"
          ? "EU legislative tracker — follow key files"
          : "Tracker legislacyjny UE — śledź kluczowe dossier",
      description:
        lang === "en"
          ? "Track key EU legislative files: procedure stage, timeline of events and upcoming milestones."
          : "Śledź kluczowe dossier legislacyjne UE: etap procedury, oś czasu wydarzeń i nadchodzące kamienie milowe.",
    });
  },
  component: TrackerIndex,
  errorComponent: (props) => (
    <RouteErrorFallback {...props} title="Nie udało się załadować trackera" />
  ),
});

type Lang = "pl" | "en";

/** Data (YYYY-MM-DD) sformatowana wg języka; T00:00:00 trzyma dzień w lokalnej strefie. */
function formatDate(iso: string | null, lang: Lang): string | null {
  if (!iso) return null;
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(lang === "pl" ? "pl-PL" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Kompaktowa oś postępu: 6 kropek z łącznikami, wypełnione do bieżącego etapu. */
function StageRail({ stage, lang }: { stage: string; lang: Lang }) {
  if (isTerminal(stage)) {
    // Dossier zakończone poza pozytywną ścieżką - czerwona etykieta zamiast paska.
    return (
      <div className="text-xs font-semibold uppercase tracking-wide text-destructive">
        {stageLabel(stage, lang)}
      </div>
    );
  }
  const idx = stageIndex(stage);
  return (
    <div
      className="flex items-center"
      role="img"
      aria-label={`${stageLabel(stage, lang)} (${idx + 1}/${POLICY_STAGES.length})`}
    >
      {POLICY_STAGES.map((s, i) => (
        <Fragment key={s}>
          {i > 0 && (
            <div className={`h-0.5 flex-1 min-w-3 ${i <= idx ? "bg-primary" : "bg-border"}`} />
          )}
          <div
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${i <= idx ? "bg-primary" : "bg-border"}`}
          />
        </Fragment>
      ))}
      <span className="ml-3 text-xs text-muted-foreground whitespace-nowrap">
        {stageLabel(stage, lang)}
      </span>
    </div>
  );
}

function ItemCard({ item, followers, lang }: { item: PolicyItem; followers: number; lang: Lang }) {
  const { t } = useTranslation();
  const title = lang === "en" ? item.title_en || item.title_pl : item.title_pl || item.title_en;
  const milestone =
    lang === "en"
      ? item.next_milestone_en || item.next_milestone_pl
      : item.next_milestone_pl || item.next_milestone_en;
  const milestoneDate = formatDate(item.next_milestone_at, lang);

  return (
    <Link
      to="/tracker/$slug"
      params={{ slug: item.slug }}
      className="flex flex-col gap-3 p-5 rounded-lg border border-border bg-card hover:bg-muted/40 transition-colors"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline">
          {POLICY_AREAS.find((a) => a.key === item.policy_area)?.[lang] ?? item.policy_area}
        </Badge>
        {item.importance === 3 && <Badge>{t("tracker.keyFile")}</Badge>}
        {item.reference && (
          <span className="text-[11px] text-muted-foreground font-mono">{item.reference}</span>
        )}
      </div>
      <h2 className="font-medium leading-snug">{title}</h2>
      <StageRail stage={item.stage} lang={lang} />
      {(milestone || milestoneDate) && (
        <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <CalendarClock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            {milestone}
            {milestone && milestoneDate ? " · " : ""}
            {milestoneDate}
          </span>
        </div>
      )}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-auto">
        <Users className="w-3.5 h-3.5" />
        {t("tracker.followers", { count: followers })}
      </div>
    </Link>
  );
}

function TrackerIndex() {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === "en" ? "en" : "pl";
  const [area, setArea] = useState("all");
  const [stage, setStage] = useState("all");

  const { data: items, isLoading } = usePublishedItems({
    area: area === "all" ? undefined : area,
    stage: stage === "all" ? undefined : stage,
  });
  const { data: followerCounts } = useFollowerCounts((items ?? []).map((item) => item.id));

  return (
    <div className="container mx-auto px-4 py-10 max-w-5xl space-y-8">
      <header className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Landmark className="w-5 h-5 text-primary" />
        </div>
        <div className="space-y-1">
          <h1 className="font-display text-3xl">{t("tracker.title")}</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">{t("tracker.intro")}</p>
        </div>
      </header>

      {/* Filtry: obszar polityki + etap procedury */}
      <div className="flex flex-wrap gap-3">
        <Select value={area} onValueChange={setArea}>
          <SelectTrigger className="w-52" aria-label={t("tracker.filters.area")}>
            <SelectValue placeholder={t("tracker.filters.area")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("tracker.filters.allAreas")}</SelectItem>
            {POLICY_AREAS.map((a) => (
              <SelectItem key={a.key} value={a.key}>
                {a[lang]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={stage} onValueChange={setStage}>
          <SelectTrigger className="w-52" aria-label={t("tracker.filters.stage")}>
            <SelectValue placeholder={t("tracker.filters.stage")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("tracker.filters.allStages")}</SelectItem>
            {STAGE_LABELS.map((s) => (
              <SelectItem key={s.key} value={s.key}>
                {s[lang]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-16 text-center">{t("tracker.loading")}</p>
      ) : (items ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground py-16 text-center">{t("tracker.empty")}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {(items ?? []).map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              followers={followerCounts?.[item.id] ?? 0}
              lang={lang}
            />
          ))}
        </div>
      )}
    </div>
  );
}
