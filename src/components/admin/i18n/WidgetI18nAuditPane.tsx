// Panel: audyt tłumaczeń treści widgetów (PL -> EN).
//
// Cała treść publiczna mieszka w widgetach buildera, więc audyt czyta wprost
// `builder_data` stron i wpisów i pokazuje, które widgety renderują się po
// polsku na /en (brak EN, EN = PL, polski tekst w polu EN, EN pozostawione na
// szablonowej wartości domyślnej). Każdy wiersz linkuje do konkretnego widgetu
// w edytorze, żeby poprawka odbywała się tam, gdzie mieszka treść.
//
// STAN ODCZYTU jest częścią wyniku, nie ozdobą. Audyt, który „nie znalazł
// braków", bo zapytanie padło (sieć, odmowa RLS), wygląda identycznie jak
// audyt czystego serwisu - dlatego błąd odczytu i lista przycięta limitem mają
// własne komunikaty. Układ i reguła są te same co w kokpicie SEO
// (`ContentReadError`, `ContentCoverageNotice`), ale napisy są WŁASNE
// (`adminWidgetI18nAudit.*`): zdania kokpitu mówią o „licznikach i tabeli"
// treści, a stąd ma być widać, co padło - skan stron i wpisów pod audyt.
//
// Wszystkie napisy idą przez słownik `@/lib/i18n-admin-widget-audit`.
import { useMemo, useState } from "react";
import { skipToken, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Languages, Loader2, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { WIDGETS } from "@/lib/builder/registry";
import type { WidgetType } from "@/lib/builder/types";
import { ensureI18n as ensureWidgetAuditI18n } from "@/lib/i18n-admin-widget-audit";
import {
  auditBuilderI18n,
  summarizeI18nIssues,
  type WidgetI18nIssue,
  type WidgetI18nIssueKind,
} from "@/lib/i18n/widgetTranslationAudit";
import type { SeoContentCoverage } from "@/lib/seo/seoContentQuery";

interface EntityRow {
  id: string;
  slug: string;
  title_pl: string | null;
  status: string | null;
  builder_data: unknown;
}

export interface AuditedEntity {
  kind: "page" | "post";
  slug: string;
  title: string;
  status: string;
  issues: WidgetI18nIssue[];
}

const DEFAULTS_BY_TYPE = new Map<string, Record<string, unknown>>(
  WIDGETS.map((w) => [w.type as WidgetType as string, w.defaults() as Record<string, unknown>]),
);

/**
 * Pogrubia fragmenty `<b>…</b>` przetłumaczonego zdania.
 *
 * Celowo NIE `<Trans>` z react-i18next: to jego jedyne użycie w repozytorium,
 * a `Trans` ciągnie parser HTML (`html-parse-stringify`, `void-elements`) do
 * współdzielonego chunku `vendor-i18n`, który leży w domknięciu startowym
 * każdej strony - +4,1 KB gzip pierwszego wczytania (pomiar `check:bundle`
 * 2026-10-03) za jedno zdanie panelu admina. Wartości interpolowane to liczby
 * i słowa ze słownika, więc wystarczy podział po znaczniku.
 */
function renderBold(text: string): React.ReactNode[] {
  return text
    .split(/<b>(.*?)<\/b>/)
    .map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part));
}

/** Jawna mapa klasa -> klucz (klucz sklejany byłby niewidoczny dla bramek i18n). */
const KIND_LABEL_KEY: Record<WidgetI18nIssueKind, string> = {
  stale_default: "adminWidgetI18nAudit.kind.staleDefault",
  pl_text_in_en: "adminWidgetI18nAudit.kind.plTextInEn",
  missing: "adminWidgetI18nAudit.kind.missing",
  same_as_pl: "adminWidgetI18nAudit.kind.sameAsPl",
};

/**
 * Górne granice pobrania. Każdy wiersz niesie pełne `builder_data` (całe drzewo
 * widgetów), więc to strażnik przed ściągnięciem całej bazy do przeglądarki,
 * nie zakres audytu - przycięcie panel mówi wprost. Wartości jak w kokpicie
 * SEO (`SEO_CONTENT_LIMITS`).
 */
const WIDGET_I18N_AUDIT_LIMITS = { pages: 500, posts: 1000 } as const;

const AUDIT_SELECT = "id, slug, title_pl, status, builder_data";

interface WidgetI18nAuditResult {
  entities: AuditedEntity[];
  coverage: SeoContentCoverage;
}

/** Pobrany wycinek tabeli + łączna liczba pasujących wierszy (`null` = nieznana). */
interface TableRead {
  rows: EntityRow[];
  total: number | null;
}

// Zakres najemcy wprost, a nie „RLS i tak przytnie": polityka „Public reads
// published pages/posts" wpuszcza KAŻDE zalogowane konto do opublikowanych
// treści najemcy publicznego, więc bez filtra administrator innego najemcy
// audytowałby cudze strony, a „Edytuj widgety" otwierałoby `/admin/pages/$slug`
// w jego własnym najemcy - inną stronę albo żadną. Konwencja klienta panelu:
// `src/lib/tenant.ts`, `admin.pages.tsx`, `seoContentQuery.ts`.
//
// Kolejność `updated_at desc` decyduje, KTÓRE wiersze mieszczą się w limicie:
// ostatnio edytowane, czyli te, nad którymi redakcja właśnie pracuje.
async function readPages(tenantId: string): Promise<TableRead> {
  const { data, error, count } = await supabase
    .from("pages")
    .select(AUDIT_SELECT, { count: "exact" })
    .eq("tenant_id", tenantId)
    .eq("editor", "builder")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(WIDGET_I18N_AUDIT_LIMITS.pages);
  // Błąd RZUCAMY: react-query przechodzi w stan błędu, zamiast pokazać pustą
  // listę jako „brak braków tłumaczeń".
  if (error) throw error;
  return { rows: data ?? [], total: typeof count === "number" ? count : null };
}

async function readPosts(tenantId: string): Promise<TableRead> {
  const { data, error, count } = await supabase
    .from("posts")
    .select(AUDIT_SELECT, { count: "exact" })
    .eq("tenant_id", tenantId)
    .eq("editor", "builder")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(WIDGET_I18N_AUDIT_LIMITS.posts);
  if (error) throw error;
  return { rows: data ?? [], total: typeof count === "number" ? count : null };
}

/** Kompletność przeskanowanej listy - ta sama reguła co `seoContentCoverage`. */
function auditCoverage(reads: readonly TableRead[]): SeoContentCoverage {
  const shown = reads.reduce((sum, read) => sum + read.rows.length, 0);
  let total = 0;
  for (const read of reads) {
    if (read.total === null) return { state: "unknown", shown, total: null };
    // Liczność mniejsza od liczby pobranych wierszy to wyścig (wiersz dodany
    // między zliczeniem a odczytem) - pobrane wiersze są faktem.
    total += Math.max(read.total, read.rows.length);
  }
  return { state: total > shown ? "truncated" : "complete", shown, total };
}

async function fetchAudited(tenantId: string): Promise<WidgetI18nAuditResult> {
  const lookup = (type: string) => DEFAULTS_BY_TYPE.get(type);
  const [pages, posts] = await Promise.all([readPages(tenantId), readPosts(tenantId)]);

  const build = (rows: EntityRow[], kind: "page" | "post"): AuditedEntity[] =>
    rows
      .map((row) => ({
        kind,
        slug: row.slug,
        title: row.title_pl ?? row.slug,
        status: row.status ?? "draft",
        issues: auditBuilderI18n(row.builder_data, lookup),
      }))
      .filter((e) => e.issues.length > 0);

  return {
    entities: [...build(pages.rows, "page"), ...build(posts.rows, "post")].sort(
      (a, b) => b.issues.length - a.issues.length,
    ),
    coverage: auditCoverage([pages, posts]),
  };
}

/** Lista niepełna (przycięta limitem albo o nieznanej liczności); komplet = nic. */
function AuditCoverageNotice({ coverage }: { coverage: SeoContentCoverage }) {
  const { t } = useTranslation();
  if (coverage.state === "complete") return null;
  return (
    <p
      data-widget-i18n-coverage={coverage.state}
      className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400"
    >
      {coverage.state === "truncated"
        ? t("adminWidgetI18nAudit.coverageTruncated", {
            shown: coverage.shown,
            total: coverage.total,
          })
        : t("adminWidgetI18nAudit.coverageUnknown", { shown: coverage.shown })}
    </p>
  );
}

/** Odczyt padł - stan odrębny od skanowania i od „brak braków". */
function AuditReadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      data-widget-i18n-read-error
      className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
    >
      <span>{t("adminWidgetI18nAudit.readError")}</span>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md border border-destructive/40 px-2 py-1 font-medium hover:bg-destructive/10"
      >
        {t("adminWidgetI18nAudit.retry")}
      </button>
    </div>
  );
}

export function WidgetI18nAuditPane() {
  ensureWidgetAuditI18n();
  // Język rozstrzyga i18next (także regionalne „en-GB"/„en-US" - spadają na
  // słownik „en"), więc komponent nie porównuje już kodów języka sam.
  const { t } = useTranslation();
  const { tenantId } = useAuth();
  const [errorsOnly, setErrorsOnly] = useState(true);

  const { data, isPending, isError, isFetching, refetch } = useQuery({
    // Najemca w kluczu: zmiana konta nie może pokazać audytu poprzedniego
    // najemcy z pamięci podręcznej.
    queryKey: ["admin", "widget-i18n-audit", tenantId],
    // Bez najemcy nie ma czego pytać - zapytanie czeka (stan „skanowanie"),
    // zamiast iść do bazy bez zakresu albo udawać pusty wynik.
    queryFn: tenantId ? () => fetchAudited(tenantId) : skipToken,
    staleTime: 60_000,
  });

  const entities = useMemo(() => {
    const list = data?.entities ?? [];
    if (!errorsOnly) return list;
    return list
      .map((e) => ({ ...e, issues: e.issues.filter((i) => i.severity === "error") }))
      .filter((e) => e.issues.length > 0);
  }, [data, errorsOnly]);

  const total = useMemo(() => summarizeI18nIssues(entities.flatMap((e) => e.issues)), [entities]);
  // Ostrzeżenia liczone z PEŁNEGO wyniku. Licznik z listy już przefiltrowanej
  // do błędów był w trybie „Tylko błędy" zawsze zerem, więc podpowiedź
  // o ukrytych ostrzeżeniach nie pojawiała się nigdy.
  const hiddenWarnings = useMemo(
    () =>
      errorsOnly
        ? summarizeI18nIssues((data?.entities ?? []).flatMap((e) => e.issues)).warnings
        : 0,
    [data, errorsOnly],
  );
  // Wynik (liczniki, lista, „brak braków") tylko z udanego odczytu - po błędzie
  // react-query trzyma poprzednie dane, ale nie są już stanem serwisu.
  const result = isError ? undefined : data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refetch()}
          disabled={isFetching || !tenantId}
        >
          {isFetching ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          {t("adminWidgetI18nAudit.rescan")}
        </Button>
        <Button
          variant={errorsOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setErrorsOnly((v) => !v)}
        >
          {errorsOnly ? t("adminWidgetI18nAudit.errorsOnly") : t("adminWidgetI18nAudit.allIssues")}
        </Button>
        {result ? (
          <span className="text-[0.8125rem] text-muted-foreground">
            {renderBold(
              t("adminWidgetI18nAudit.summary", {
                issues: total.total,
                issuesWord: t("adminWidgetI18nAudit.summaryIssues", { count: total.total }),
                entries: entities.length,
                entriesWord: t("adminWidgetI18nAudit.summaryEntries", { count: entities.length }),
              }),
            )}
          </span>
        ) : null}
      </div>

      {isError ? (
        <AuditReadError onRetry={() => void refetch()} />
      ) : isPending ? (
        <p className="text-sm text-muted-foreground">{t("adminWidgetI18nAudit.scanning")}</p>
      ) : (
        <AuditCoverageNotice coverage={data.coverage} />
      )}

      {!result ? null : entities.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("adminWidgetI18nAudit.noGaps")}</p>
      ) : (
        entities.map((entity) => (
          <Card key={`${entity.kind}:${entity.slug}`}>
            <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle className="text-sm font-semibold">
                {entity.title}{" "}
                <span className="font-normal text-muted-foreground">
                  /{entity.kind === "page" ? "" : "post/"}
                  {entity.slug}
                </span>
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant={entity.status === "published" ? "default" : "secondary"}>
                  {entity.status}
                </Badge>
                <Button asChild size="sm" variant="outline">
                  <Link
                    to={entity.kind === "page" ? "/admin/pages/$slug" : "/admin/posts/$slug"}
                    params={{ slug: entity.slug }}
                  >
                    {t("adminWidgetI18nAudit.editWidgets")}
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {entity.issues.map((issue, idx) => (
                <div
                  key={`${issue.widgetId}:${issue.field}:${idx}`}
                  className="rounded-[6px] border border-border/60 p-2 text-[0.8125rem]"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={issue.severity === "error" ? "destructive" : "secondary"}>
                      {t(KIND_LABEL_KEY[issue.kind])}
                    </Badge>
                    <span className="font-mono text-xs text-muted-foreground">
                      {issue.widgetType} · {issue.field}
                    </span>
                  </div>
                  <p className="mt-1">
                    <span className="text-muted-foreground">PL:</span> {issue.pl || "—"}
                  </p>
                  <p>
                    <span className="text-muted-foreground">EN:</span> {issue.en || "—"}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        ))
      )}

      {result && hiddenWarnings > 0 ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5" />
          {t("adminWidgetI18nAudit.hiddenWarnings")}
        </p>
      ) : null}

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Languages className="h-3.5 w-3.5" />
        {t("adminWidgetI18nAudit.fixHint")}
      </p>
    </div>
  );
}
