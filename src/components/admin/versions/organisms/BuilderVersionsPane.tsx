// Organizm: historia wersji elementów buildera - widgety globalne, popupy i
// szablony sekcji. Migawki tworzy baza przy każdej zmianie; tutaj wybieramy
// element, oglądamy wybraną wersję i przywracamy ją na żywo.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PreviewFrame } from "../atoms/PreviewFrame";
import { VersionRow } from "../molecules/VersionRow";
import { BuilderRenderer } from "@/components/builder/organisms/BuilderRenderer";
import { useGlobalWidgets } from "@/lib/builder/globalWidgets";
import { usePopupsAdmin } from "@/lib/builder/popups";
import { useSectionTemplates, useTemplateRevisions } from "@/lib/builder/templates";
import {
  parseGlobalWidgetRevision,
  parsePopupRevision,
  useBuilderRevisions,
  useRestoreBuilderRevision,
  type BuilderEntityType,
} from "@/lib/builder/revisions";
import { newId, type BuilderDocument, type SectionNode } from "@/lib/builder/types";
import { uiLocale } from "@/lib/i18n/format";

type Tab = BuilderEntityType | "template";

function formatDate(iso: string, lang: "pl" | "en") {
  try {
    return new Intl.DateTimeFormat(uiLocale(lang), {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Owija pojedynczą sekcję w dokument, żeby dało się ją wyrenderować. */
export function documentForSection(section: SectionNode): BuilderDocument {
  return { version: 1, sections: [section] };
}

/** Syntetyczny dokument z jednego widgetu (podgląd widgetu globalnego). */
export function documentForWidget(data: {
  type: string;
  content?: Record<string, unknown>;
  style?: unknown;
  advanced?: unknown;
}): BuilderDocument {
  const widget = { id: newId(), kind: "widget", ...data } as unknown as SectionNode["children"][0];
  return {
    version: 1,
    sections: [
      {
        id: newId(),
        kind: "section",
        children: [
          {
            id: newId(),
            kind: "column",
            span: 12,
            children: [widget],
          } as unknown as SectionNode["children"][0],
        ],
      },
    ],
  };
}

export function BuilderVersionsPane({ lang }: { lang: "pl" | "en" }) {
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const [tab, setTab] = useState<Tab>("global_widget");
  const [entityId, setEntityId] = useState<string | null>(null);
  const [revisionId, setRevisionId] = useState<string | null>(null);

  const widgets = useGlobalWidgets();
  const popups = usePopupsAdmin();
  const templates = useSectionTemplates();

  const entities = useMemo(() => {
    if (tab === "global_widget")
      return (widgets.items ?? []).map((w) => ({ id: w.id, name: w.name }));
    if (tab === "popup") return (popups.items ?? []).map((p) => ({ id: p.id, name: p.name }));
    return (templates.items ?? []).map((t) => ({ id: t.id, name: t.name }));
  }, [tab, widgets.items, popups.items, templates.items]);

  useEffect(() => {
    setEntityId(entities[0]?.id ?? null);
    setRevisionId(null);
  }, [tab, entities.length]);

  const builderRevisions = useBuilderRevisions(
    tab === "template" ? "global_widget" : tab,
    tab === "template" ? null : entityId,
  );
  const templateRevisions = useTemplateRevisions(tab === "template" ? entityId : null);
  const restore = useRestoreBuilderRevision(tab === "template" ? "global_widget" : "global_widget");

  const rows =
    tab === "template"
      ? (templateRevisions.items ?? []).map((r) => ({
          id: r.id,
          title: r.name,
          created_at: r.created_at,
        }))
      : (builderRevisions.data ?? []).map((r) => ({
          id: r.id,
          title: r.name,
          created_at: r.created_at,
        }));

  const previewDoc: BuilderDocument | null = useMemo(() => {
    if (tab === "template") {
      const rev = (templateRevisions.items ?? []).find((r) => r.id === revisionId);
      return rev ? documentForSection(rev.data) : null;
    }
    const rev = (builderRevisions.data ?? []).find((r) => r.id === revisionId);
    if (!rev) return null;
    if (tab === "popup") return parsePopupRevision(rev.data).builder_data;
    const data = parseGlobalWidgetRevision(rev.data);
    return data ? documentForWidget(data) : null;
  }, [tab, revisionId, builderRevisions.data, templateRevisions.items]);

  const selectedBuilderRevision =
    tab === "template" ? null : (builderRevisions.data ?? []).find((r) => r.id === revisionId);

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: "global_widget", label: L("Widgety globalne", "Global widgets") },
    { id: "popup", label: L("Popupy", "Popups") },
    { id: "template", label: L("Szablony sekcji", "Section templates") },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {TABS.map((tb) => (
          <Button
            key={tb.id}
            size="sm"
            variant={tb.id === tab ? "default" : "outline"}
            onClick={() => setTab(tb.id)}
          >
            {tb.label}
          </Button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[240px_260px_1fr]">
        <div className="rounded-md border border-border overflow-hidden">
          <p className="border-b border-border bg-muted/40 px-3 py-1.5 text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
            {L("Elementy", "Items")}
          </p>
          <ul className="divide-y divide-border">
            {entities.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted-foreground">
                {L("Brak elementów", "Nothing here yet")}
              </li>
            ) : (
              entities.map((e) => (
                <VersionRow
                  key={e.id}
                  title={e.name}
                  meta=""
                  active={e.id === entityId}
                  onSelect={() => {
                    setEntityId(e.id);
                    setRevisionId(null);
                  }}
                />
              ))
            )}
          </ul>
        </div>

        <div className="space-y-2">
          <div className="rounded-md border border-border overflow-hidden">
            <p className="border-b border-border bg-muted/40 px-3 py-1.5 text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
              {L("Wersje", "Versions")}
            </p>
            <ul className="divide-y divide-border">
              {rows.length === 0 ? (
                <li className="px-3 py-2 text-xs text-muted-foreground">
                  {L("Brak zapisanych wersji", "No saved versions")}
                </li>
              ) : (
                rows.map((r) => (
                  <VersionRow
                    key={r.id}
                    title={r.title}
                    meta={formatDate(r.created_at, lang)}
                    active={r.id === revisionId}
                    onSelect={() => setRevisionId(r.id)}
                  />
                ))
              )}
            </ul>
          </div>
          {selectedBuilderRevision ? (
            <Button
              size="sm"
              variant="outline"
              disabled={restore.isPending}
              onClick={async () => {
                try {
                  await restore.mutateAsync(selectedBuilderRevision);
                  toast.success(L("Przywrócono wersję", "Version restored"));
                } catch {
                  toast.error(L("Nie udało się przywrócić", "Restore failed"));
                }
              }}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              {L("Przywróć tę wersję", "Restore this version")}
            </Button>
          ) : null}
        </div>

        <PreviewFrame label={L("Podgląd wybranej wersji", "Selected version preview")}>
          {previewDoc ? (
            <BuilderRenderer doc={previewDoc} lang={lang} editorPreview />
          ) : (
            <p className="p-4 text-xs text-muted-foreground">
              {L("Wybierz wersję, aby zobaczyć podgląd.", "Pick a version to see the preview.")}
            </p>
          )}
        </PreviewFrame>
      </div>
    </div>
  );
}
