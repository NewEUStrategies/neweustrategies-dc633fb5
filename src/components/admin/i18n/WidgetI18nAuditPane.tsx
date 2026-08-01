// Panel: audyt tłumaczeń treści widgetów (PL -> EN).
//
// Cała treść publiczna mieszka w widgetach buildera, więc audyt czyta wprost
// `builder_data` stron i wpisów i pokazuje, które widgety renderują się po
// polsku na /en (brak EN, EN = PL, polski tekst w polu EN, EN pozostawione na
// szablonowej wartości domyślnej). Każdy wiersz linkuje do konkretnego widgetu
// w edytorze, żeby poprawka odbywała się tam, gdzie mieszka treść.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Languages, Loader2, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { WIDGETS } from "@/lib/builder/registry";
import type { WidgetType } from "@/lib/builder/types";
import {
  auditBuilderI18n,
  summarizeI18nIssues,
  type WidgetI18nIssue,
  type WidgetI18nIssueKind,
} from "@/lib/i18n/widgetTranslationAudit";

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

const KIND_LABEL: Record<WidgetI18nIssueKind, { pl: string; en: string }> = {
  stale_default: { pl: "Szablonowa wartość EN", en: "Template EN value" },
  pl_text_in_en: { pl: "Polski tekst w polu EN", en: "Polish text in EN field" },
  missing: { pl: "Brak tłumaczenia EN", en: "Missing EN translation" },
  same_as_pl: { pl: "EN identyczne z PL", en: "EN identical to PL" },
};

async function fetchAudited(): Promise<AuditedEntity[]> {
  const lookup = (type: string) => DEFAULTS_BY_TYPE.get(type);
  const [pages, posts] = await Promise.all([
    supabase
      .from("pages")
      .select("id, slug, title_pl, status, builder_data")
      .eq("editor", "builder")
      .is("deleted_at", null),
    supabase
      .from("posts")
      .select("id, slug, title_pl, status, builder_data")
      .eq("editor", "builder")
      .is("deleted_at", null),
  ]);

  const build = (rows: EntityRow[] | null, kind: "page" | "post"): AuditedEntity[] =>
    (rows ?? [])
      .map((row) => ({
        kind,
        slug: row.slug,
        title: row.title_pl ?? row.slug,
        status: row.status ?? "draft",
        issues: auditBuilderI18n(row.builder_data, lookup),
      }))
      .filter((e) => e.issues.length > 0);

  return [
    ...build(pages.data as EntityRow[] | null, "page"),
    ...build(posts.data as EntityRow[] | null, "post"),
  ].sort((a, b) => b.issues.length - a.issues.length);
}

export function WidgetI18nAuditPane() {
  const { i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const [errorsOnly, setErrorsOnly] = useState(true);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["admin", "widget-i18n-audit"],
    queryFn: fetchAudited,
    staleTime: 60_000,
  });

  const entities = useMemo(() => {
    const list = data ?? [];
    if (!errorsOnly) return list;
    return list
      .map((e) => ({ ...e, issues: e.issues.filter((i) => i.severity === "error") }))
      .filter((e) => e.issues.length > 0);
  }, [data, errorsOnly]);

  const total = useMemo(
    () => summarizeI18nIssues(entities.flatMap((e) => e.issues)),
    [entities],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          {isFetching ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          {L("Przeskanuj ponownie", "Rescan")}
        </Button>
        <Button
          variant={errorsOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setErrorsOnly((v) => !v)}
        >
          {errorsOnly ? L("Tylko błędy", "Errors only") : L("Błędy i ostrzeżenia", "All issues")}
        </Button>
        <span className="text-[0.8125rem] text-muted-foreground">
          {L("Znaleziono", "Found")} <strong>{total.total}</strong>{" "}
          {L("problemów w", "issues across")} <strong>{entities.length}</strong>{" "}
          {L("wpisach/stronach", "entries")}
        </span>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{L("Skanowanie…", "Scanning…")}</p>
      ) : entities.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {L(
            "Brak wykrytych braków tłumaczeń w widgetach.",
            "No widget translation gaps detected.",
          )}
        </p>
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
                    {L("Edytuj widgety", "Edit widgets")}
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
                      {KIND_LABEL[issue.kind][lang]}
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

      {total.warnings > 0 && errorsOnly ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5" />
          {L(
            "Ostrzeżenia (EN identyczne z PL) są ukryte - bywają poprawne dla nazw własnych.",
            "Warnings (EN identical to PL) are hidden - they can be correct for proper nouns.",
          )}
        </p>
      ) : null}

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Languages className="h-3.5 w-3.5" />
        {L(
          "Poprawki wprowadzasz w widgecie - pola PL/EN są częścią jego treści.",
          "Fix them inside the widget - the PL/EN fields are part of its content.",
        )}
      </p>
    </div>
  );
}
