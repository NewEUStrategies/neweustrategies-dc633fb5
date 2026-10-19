// Karta „Historia etapów" kontaktu CRM (hub S4): każda zmiana etapu sprzedaży
// i cyklu życia - z kim, kiedy i skąd (panel, billing, ścieżka, przepis,
// import, odtworzenie z dziennika audytu przy wdrożeniu).
//
// DLACZEGO KARTA, A NIE OŚ AKTYWNOŚCI. Oś (timeline) miesza wiadomości,
// notatki i zgody; pytanie „kiedy ten kontakt stał się SQL i kto go tam
// przesunął" ma osobną odpowiedź w `crm_lead_stage_history`, a mieszanie
// źródeł zgubiłoby informację o pierwszeństwie (billing > ręcznie >
// ścieżka = przepis), która tłumaczy, czemu ręczna zmiana się „nie przyjęła".
//
// Etykiety z nakładki `i18n-admin-crm-lifecycle` czytane po `lang` (lista
// i karta CRM nie używają i18next - konwencja modułu).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BadgeDollarSign, GitBranch, History, Loader2, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getCrmLeadStageHistory, type LeadStageHistoryRow } from "@/lib/crm.functions";
import { crmKeys } from "@/lib/crm/keys";
import { crmLifecycleDict } from "@/components/admin/crm/crmLifecycleLabels";
import { formatDateTime } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";

/** Ile wpisów pokazujemy przed „Pokaż starsze" - karta stoi w bocznej kolumnie. */
export const STAGE_HISTORY_VISIBLE = 8;

type DimensionFilter = "all" | LeadStageHistoryRow["dimension"];

/** JSON z `getCrmLeadStageHistory` -> wiersze; śmieci odrzucone, nie zgadywane. */
export function parseStageHistory(raw: { json: string } | null | undefined): LeadStageHistoryRow[] {
  if (!raw || typeof raw.json !== "string") return [];
  let rows: unknown;
  try {
    rows = JSON.parse(raw.json);
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (row): row is LeadStageHistoryRow =>
      Boolean(row) &&
      typeof row === "object" &&
      ((row as { dimension?: unknown }).dimension === "crm_stage" ||
        (row as { dimension?: unknown }).dimension === "lifecycle") &&
      typeof (row as { to_value?: unknown }).to_value === "string" &&
      typeof (row as { changed_at?: unknown }).changed_at === "string",
  );
}

export function leadStageHistoryQueryOptions(leadId: string) {
  return {
    queryKey: crmKeys.leadStageHistory(leadId),
    queryFn: async () => parseStageHistory(await getCrmLeadStageHistory({ data: { id: leadId } })),
    // Historia zmienia się tylko przy zmianie etapu - mutacje i szyna
    // (`crm_lead.lifecycle_changed.v1`) i tak ją unieważniają.
    staleTime: 30_000,
  } as const;
}

interface Props {
  leadId: string;
  lang: "pl" | "en";
  /** Nazwy osób z zespołu po id (autor zmiany ręcznej); brak = bez podpisu. */
  actorNames?: ReadonlyMap<string, string>;
}

export function LeadStageHistoryCard({ leadId, lang, actorNames }: Props) {
  const dict = crmLifecycleDict(lang);
  const [filter, setFilter] = useState<DimensionFilter>("all");
  const [expanded, setExpanded] = useState(false);
  const query = useQuery(leadStageHistoryQueryOptions(leadId));

  const rows = useMemo(
    () => (query.data ?? []).filter((row) => filter === "all" || row.dimension === filter),
    [query.data, filter],
  );
  const visible = expanded ? rows : rows.slice(0, STAGE_HISTORY_VISIBLE);
  const hidden = rows.length - visible.length;

  const label = (row: LeadStageHistoryRow, value: string | null): string => {
    if (value === null) return dict.history.initial;
    const map =
      row.dimension === "lifecycle"
        ? (dict.stages as Record<string, string>)
        : (dict.crmStages as Record<string, string>);
    // Wartość spoza słownika pokazujemy surowo - ma być widoczna jako nieznana.
    return map[value] ?? value;
  };

  const filters: Array<{ id: DimensionFilter; label: string }> = [
    { id: "all", label: dict.history.filterAll },
    { id: "lifecycle", label: dict.dimensions.lifecycle },
    { id: "crm_stage", label: dict.dimensions.crm_stage },
  ];

  return (
    <section
      className="rounded-md border bg-card p-3"
      aria-labelledby={`stage-history-${leadId}`}
      data-testid="lead-stage-history"
    >
      <div className="mb-1 flex items-center gap-2">
        <History className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <h3 id={`stage-history-${leadId}`} className="text-[12px] font-medium">
          {dict.history.title}
        </h3>
      </div>
      <p className="mb-2 text-[11px] text-muted-foreground">{dict.history.description}</p>

      <div role="group" aria-label={dict.history.title} className="mb-2 flex flex-wrap gap-1">
        {filters.map((f) => (
          <Button
            key={f.id}
            type="button"
            size="sm"
            variant={filter === f.id ? "secondary" : "ghost"}
            className="h-6 px-2 text-[11px]"
            aria-pressed={filter === f.id}
            onClick={() => {
              setFilter(f.id);
              setExpanded(false);
            }}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {query.isLoading ? (
        <div
          className="flex items-center gap-2 py-3 text-[11px] text-muted-foreground"
          role="status"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          <span className="sr-only">{dict.history.title}</span>
        </div>
      ) : query.isError ? (
        <div className="space-y-2 py-2" role="alert">
          <p className="text-[11px] text-destructive">{dict.history.loadError}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-[11px]"
            onClick={() => void query.refetch()}
          >
            <RotateCcw className="h-3 w-3" aria-hidden />
            {dict.history.retry}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="py-2 text-[11px] text-muted-foreground">{dict.history.empty}</p>
      ) : (
        <>
          <ol className="space-y-2">
            {visible.map((row) => {
              const Icon = row.dimension === "lifecycle" ? BadgeDollarSign : GitBranch;
              const who = row.actor_id ? actorNames?.get(row.actor_id) : undefined;
              const source =
                (dict.historySources as Record<string, string>)[row.source] ?? row.source;
              return (
                <li key={row.id} className="flex gap-2" data-testid="stage-history-row">
                  <span
                    className={cn(
                      "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                      row.dimension === "lifecycle"
                        ? "bg-brand/10 text-brand"
                        : "bg-muted text-muted-foreground",
                    )}
                    aria-hidden
                  >
                    <Icon className="h-3 w-3" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px]">
                      {/* Czytnik ekranu dostaje jedno zdanie („Cykl życia: Lead → MQL"),
                          a nie trzy osobne węzły ze strzałką-ikoną pośrodku. */}
                      <span className="sr-only">
                        {dict.dimensions[row.dimension]}:{" "}
                        {dict.history.changeLabel
                          .replace("{{from}}", label(row, row.from_value))
                          .replace("{{to}}", label(row, row.to_value))}
                      </span>
                      <span className="flex flex-wrap items-center gap-1" aria-hidden>
                        <span className="text-muted-foreground">{label(row, row.from_value)}</span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <span className="font-medium">{label(row, row.to_value)}</span>
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                      <time dateTime={row.changed_at}>{formatDateTime(row.changed_at, lang)}</time>
                      <Badge
                        variant="outline"
                        className={cn(
                          "h-4 px-1 text-[10px] font-normal",
                          row.source === "billing" && "border-brand/40 text-brand",
                        )}
                      >
                        {source}
                      </Badge>
                      {who && <span>{dict.history.by.replace("{{who}}", who)}</span>}
                      {row.journey_id && <span>{dict.history.viaJourney}</span>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          {(hidden > 0 || expanded) && rows.length > STAGE_HISTORY_VISIBLE && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="mt-2 h-7 px-2 text-[11px]"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded
                ? dict.history.showLess
                : dict.history.showMore.replace("{{count}}", String(hidden))}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
