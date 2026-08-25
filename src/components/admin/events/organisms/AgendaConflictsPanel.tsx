// Organizm: raport kolizji agendy.
//
// RAPORT JEST LICZONY W BAZIE NA ŻYWO, nie trzymany w tabeli - stan agendy
// zmienia każdy zapis sesji, obsady i pojedynczy zapis uczestnika.
//
// KOLIZJI SALI TU NIE MA. Baza jej nie dopuszcza (ograniczenie wykluczające),
// więc raport pokazuje wyłącznie te sprzeczności, które zapis przepuszcza:
// prelegenta w dwóch miejscach, sesję poza oknem wydarzenia, limit ponad
// pojemność sali i zapisy ponad limit.
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { adminAgendaErrorMessage } from "@/lib/events/adminAgendaErrors";
import { useAgendaConflicts } from "@/lib/events/useEventSessions";
import type { AgendaConflictRow } from "@/lib/events/sessionsApi";

export function AgendaConflictsPanel({ eventId }: { eventId: string }) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language.startsWith("en");
  const listQ = useAgendaConflicts(eventId);
  const rows = listQ.data ?? [];

  const pick = (pl: string, en: string): string => (isEn ? en || pl : pl || en);

  const kindLabel = (row: AgendaConflictRow): string => {
    const key = `adminEventAgenda.conflictKinds.${row.kind}`;
    const label = t(key);
    // Nieznany rodzaj z bazy nie może pokazać surowego klucza i18n.
    return label === key ? row.kind : label;
  };

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h2 className="font-display text-lg">{t("adminEventAgenda.conflicts.title")}</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t("adminEventAgenda.conflicts.subtitle")}
        </p>
      </header>

      <AdminCatalogListState
        isLoading={listQ.isLoading}
        loadingLabel={t("adminEventAgenda.conflicts.loading")}
        errorMessage={
          listQ.error === null || listQ.error === undefined
            ? null
            : adminAgendaErrorMessage(listQ.error)
        }
        isEmpty={rows.length === 0}
        emptyLabel={t("adminEventAgenda.conflicts.empty")}
      >
        <ul className="space-y-2">
          {rows.map((row, index) => (
            <li
              key={`${row.session_id}-${row.kind}-${index}`}
              className="flex flex-wrap items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-medium">
                  {pick(row.session_title_pl, row.session_title_en)}
                </p>
                <p className="text-xs text-muted-foreground">{kindLabel(row)}</p>
                {row.other_session_id === "" ? null : (
                  <p className="text-xs text-muted-foreground">
                    {t("adminEventAgenda.conflicts.otherSession")}:{" "}
                    {pick(row.other_title_pl, row.other_title_en)}
                  </p>
                )}
                {row.subject_name === "" ? null : (
                  <p className="text-xs text-muted-foreground">
                    {t("adminEventAgenda.conflicts.subject")}: {row.subject_name}
                  </p>
                )}
              </div>
              {row.expected_value > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {t("adminEventAgenda.conflicts.expected", { value: row.expected_value })}
                  </Badge>
                  <Badge variant="destructive">
                    {t("adminEventAgenda.conflicts.actual", { value: row.actual_value })}
                  </Badge>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </AdminCatalogListState>
    </section>
  );
}
