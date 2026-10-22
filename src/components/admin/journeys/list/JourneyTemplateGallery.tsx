// Galeria szablonów ścieżek (S8, SPEC §6.3) - otwiera ją `?new=1` (i stan
// pusty listy), wybór szablonu niesie `?template=<klucz>`.
//
// KARTA MÓWI, CO SZABLON ZROBI, ZANIM GO ZAINSTALUJESZ: nazwa i opis (S5),
// kategoria, miniatura grafu (ten sam układ co kanwa), wyzwalacz i cel,
// liczba kroków i maili, tematy maili, wymagania (zgoda marketingowa, nazwa
// nadawcy, podstawa prawna), „czego NIE wysyła” i wskazówka Insidera (własne
// zdanie, BEZ liczb - liczby benchmarków daje wyłącznie zestaw S6). Treści
// maili tu nie ma: katalog jedzie do przeglądarki bez dokumentów
// (`listJourneyTemplateCatalog`).
//
// SZABLON NIEDOSTĘPNY (Z-S5-01: `pricing_enquiry_b2b` czeka na zdarzenie
// `contact_message.submitted.v1`) jest widoczny, ale wyszarzony, z powodem
// podpiętym do przycisku (`aria-describedby`) - admin wie, że istnieje i co
// go odblokuje, zamiast szukać go w kodzie. „Zainstalowany” liczy zakładka
// z listy ścieżek (`JourneyListItem.templateKey`).
//
// Wybór to przycisk z `aria-pressed` - zaznaczona karta jest też zaznaczona
// dla czytnika, nie tylko obwódką.
import { useId } from "react";
import { AlertTriangle, CheckCircle2, Info, Lock, Route, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { JourneyTemplateThumbnail } from "@/components/admin/journeys/list/JourneyTemplateThumbnail";
import { Button } from "@/components/ui/button";
import type { JourneyTemplateCatalogEntry } from "@/lib/admin/journeys/journeyEditor.functions";
import {
  JOURNEY_CATEGORY_LABEL_KEY,
  JOURNEY_EXCLUSION_LABEL_KEY,
  JOURNEY_REENTRY_LABEL_KEY,
  JOURNEY_REQUIREMENT_LABEL_KEY,
  JOURNEY_TEMPLATE_TIP_KEY,
  templateFacts,
} from "@/lib/admin/journeys/summaries";
import { chartLangFrom } from "@/lib/charts/format";
import { ensureI18n as ensureJourneysI18n } from "@/lib/i18n-admin-journeys";
import { ensureI18n } from "@/lib/i18n-admin-journeys-list";
import { journeyTemplateLabelKeys, journeyTriggerLabelKey } from "@/lib/journeys/labels";
import type { JourneyTemplateKey } from "@/lib/journeys/templates/types";
import { cn } from "@/lib/utils";

export interface JourneyTemplateGalleryProps {
  catalog: readonly JourneyTemplateCatalogEntry[] | null;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  installedKeys: ReadonlySet<string>;
  selectedKey: JourneyTemplateKey | null;
  onSelect: (key: JourneyTemplateKey) => void;
  onBlank: () => void;
  /** Brak = galeria jako stan pusty listy (bez przycisku zamknięcia). */
  onClose?: () => void;
}

export function JourneyTemplateGallery({
  catalog,
  isLoading,
  isError,
  onRetry,
  installedKeys,
  selectedKey,
  onSelect,
  onBlank,
  onClose,
}: JourneyTemplateGalleryProps) {
  ensureJourneysI18n();
  ensureI18n();
  const { t } = useTranslation();
  const headingId = useId();
  const blankId = useId();

  return (
    <section
      aria-labelledby={headingId}
      data-tour="journeys-gallery"
      data-testid="journey-template-gallery"
      className="space-y-3 rounded-[6px] border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <h2 id={headingId} className="text-base font-semibold">
            {t("adminJourneys.gallery.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("adminJourneys.gallery.description")}</p>
        </div>
        {onClose ? (
          <Button type="button" size="sm" variant="ghost" className="h-7" onClick={onClose}>
            {t("adminJourneys.gallery.close")}
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {t("adminJourneys.gallery.loading")}
        </p>
      ) : isError ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <p className="text-destructive">{t("adminJourneys.gallery.loadError")}</p>
          <Button type="button" size="sm" variant="ghost" className="h-7" onClick={onRetry}>
            {t("adminJourneys.common.retry")}
          </Button>
        </div>
      ) : (
        <ul
          aria-label={t("adminJourneys.gallery.list")}
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
        >
          <li>
            <article
              aria-labelledby={blankId}
              data-template-key="blank"
              className="flex h-full flex-col gap-2 rounded-[6px] border border-dashed border-border p-3"
            >
              <h3 id={blankId} className="flex items-center gap-2 text-sm font-semibold">
                <Route className="h-4 w-4 shrink-0" aria-hidden="true" />
                {t("adminJourneys.gallery.blankTitle")}
              </h3>
              <p className="flex-1 text-xs text-muted-foreground">
                {t("adminJourneys.gallery.blankDescription")}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 self-start"
                onClick={onBlank}
              >
                {t("adminJourneys.gallery.blankAction")}
              </Button>
            </article>
          </li>
          {(catalog ?? []).map((entry) => (
            <li key={entry.key}>
              <TemplateCard
                entry={entry}
                installed={installedKeys.has(entry.key)}
                selected={selectedKey === entry.key}
                onSelect={onSelect}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TemplateCard({
  entry,
  installed,
  selected,
  onSelect,
}: {
  entry: JourneyTemplateCatalogEntry;
  installed: boolean;
  selected: boolean;
  onSelect: (key: JourneyTemplateKey) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const titleId = useId();
  const reasonId = useId();
  const facts = templateFacts(entry);
  const labels = journeyTemplateLabelKeys(entry.key);
  const name = t(labels.name);

  return (
    <article
      aria-labelledby={titleId}
      data-template-key={entry.key}
      data-available={facts.available ? "true" : "false"}
      data-selected={selected ? "true" : "false"}
      className={cn(
        "flex h-full flex-col gap-3 rounded-[6px] border p-3",
        selected ? "border-primary ring-1 ring-primary" : "border-border",
        facts.available ? "" : "opacity-60",
      )}
    >
      <div className="space-y-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 id={titleId} className="text-sm font-semibold">
            {name}
          </h3>
          <div className="flex flex-wrap items-center gap-1 text-[11px]">
            <span className="rounded-full border border-border px-2 py-0.5">
              {t(JOURNEY_CATEGORY_LABEL_KEY[facts.category])}
            </span>
            {installed ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5">
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                {t("adminJourneys.gallery.installed")}
              </span>
            ) : null}
            {!facts.available ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5">
                <Lock className="h-3 w-3" aria-hidden="true" />
                {t("adminJourneys.gallery.unavailable")}
              </span>
            ) : null}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t(labels.description)}</p>
      </div>

      <JourneyTemplateThumbnail graph={entry.graph} className="rounded-[6px] bg-muted/30" />

      <dl
        aria-label={t("adminJourneys.gallery.facts")}
        className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs"
      >
        <dt className="text-muted-foreground">{t("adminJourneys.gallery.trigger")}</dt>
        <dd>{t(journeyTriggerLabelKey(facts.triggerEventType))}</dd>
        <dt className="text-muted-foreground">{t("adminJourneys.gallery.goal")}</dt>
        <dd>
          {facts.goalEventType
            ? t(journeyTriggerLabelKey(facts.goalEventType))
            : t("adminJourneys.gallery.noGoal")}
        </dd>
        <dt className="text-muted-foreground">{t("adminJourneys.gallery.steps")}</dt>
        <dd className="tabular-nums">
          {t("adminJourneys.gallery.stepCount", { count: facts.stepCount })},{" "}
          {t("adminJourneys.gallery.emailCount", { count: facts.emailCount })}
        </dd>
        <dt className="text-muted-foreground">{t("adminJourneys.gallery.reentry")}</dt>
        <dd>
          {t(JOURNEY_REENTRY_LABEL_KEY[facts.reentry])}
          {facts.cooldownDays !== null
            ? ` (${t("adminJourneys.gallery.cooldown", { count: facts.cooldownDays })})`
            : ""}
        </dd>
      </dl>

      {entry.emails.length > 0 ? (
        <details className="text-xs">
          <summary className="cursor-pointer font-medium">
            {t("adminJourneys.gallery.subjects")} ({entry.emails.length})
          </summary>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-muted-foreground">
            {entry.emails.map((email) => (
              <li key={email.nodeId}>{email.subject[lang]}</li>
            ))}
          </ol>
        </details>
      ) : null}

      <FactList
        title={t("adminJourneys.gallery.requirementsTitle")}
        items={facts.requirements.map((code) => ({
          key: code,
          text:
            code === "busEvent" && facts.awaitedEvent
              ? `${t(JOURNEY_REQUIREMENT_LABEL_KEY[code])}: ${facts.awaitedEvent}`
              : t(JOURNEY_REQUIREMENT_LABEL_KEY[code]),
        }))}
        icon="check"
      />
      <FactList
        title={t("adminJourneys.gallery.doesNotSendTitle")}
        items={facts.doesNotSend.map((code) => ({
          key: code,
          text: t(JOURNEY_EXCLUSION_LABEL_KEY[code]),
        }))}
        icon="cross"
      />

      <p className="flex items-start gap-2 rounded-[6px] bg-muted/30 p-2 text-xs">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          <span className="font-medium">{t("adminJourneys.gallery.tipTitle")}:</span>{" "}
          {t(JOURNEY_TEMPLATE_TIP_KEY[entry.key])}
        </span>
      </p>

      {facts.replacesWorkflowTemplate ? (
        <p className="flex items-start gap-2 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            {t("adminJourneys.gallery.replaces", { name: facts.replacesWorkflowTemplate })}
          </span>
        </p>
      ) : null}

      <div className="mt-auto space-y-1">
        {!facts.available ? (
          <p id={reasonId} className="text-xs text-muted-foreground">
            {t("adminJourneys.gallery.unavailableReason", { event: facts.awaitedEvent ?? "" })}
          </p>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant={selected ? "default" : "outline"}
          className="h-7"
          disabled={!facts.available}
          aria-pressed={selected}
          aria-label={t("adminJourneys.gallery.useFor", { name })}
          aria-describedby={facts.available ? undefined : reasonId}
          onClick={() => onSelect(entry.key)}
        >
          {t("adminJourneys.gallery.use")}
        </Button>
      </div>
    </article>
  );
}

function FactList({
  title,
  items,
  icon,
}: {
  title: string;
  items: readonly { key: string; text: string }[];
  icon: "check" | "cross";
}) {
  const headingId = useId();
  if (items.length === 0) return null;
  const Icon = icon === "check" ? CheckCircle2 : XCircle;
  return (
    <div className="space-y-1 text-xs">
      <p id={headingId} className="font-medium">
        {title}
      </p>
      <ul aria-labelledby={headingId} className="space-y-0.5">
        {items.map((item) => (
          <li key={item.key} className="flex items-start gap-1.5 text-muted-foreground">
            <Icon className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
