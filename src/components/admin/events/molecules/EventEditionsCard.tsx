// Molekuła: EDYCJE WYDARZENIA na pulpicie studia - poprzednie i kolejne
// edycje z rodowodu (`events.previous_edition_id`) oraz wejście do klonu.
//
// RODOWÓD CZYTA BAZA. `admin_event_editions` idzie łańcuchem w obie strony
// (poprzednie w górę, klony tego wydarzenia i ich klony w dół) w najemcy
// wołającego - kolumna nie jest dostępna klientowi tabeli, więc front nie
// składa łańcucha sam.
//
// WEJŚCIE DO KLONU STOI TUTAJ, bo „kolejna edycja" jest decyzją o TYM
// wydarzeniu: pulpit jest pierwszym ekranem studia i miejscem, z którego
// organizator zaczyna pracę nad następnym rokiem.
//
// DATY W STREFIE KAŻDEJ EDYCJI, nie przeglądarki - edycje bywają w różnych
// miastach.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ChevronRight, Copy } from "@/lib/lucide-shim";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { cloneStatusKey } from "@/lib/events/eventCloneLabels";
import { formatEventDateTime } from "@/lib/events/timezone";
import { useEventEditions } from "@/lib/events/useEventClone";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { uiLang } from "@/lib/i18n/format";
import { ensureCloneI18n } from "@/lib/i18n-admin-event-clone";

const RELATION_LABEL_KEYS: Record<string, string> = {
  previous: "adminEventClone.editions.relation.previous",
  next: "adminEventClone.editions.relation.next",
};

export function EventEditionsCard({ eventId }: { eventId: string }) {
  ensureCloneI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const editionsQ = useEventEditions(eventId);
  const rows = editionsQ.data ?? [];

  return (
    <div className="space-y-3">
      <AdminCatalogListState
        isLoading={editionsQ.isLoading}
        loadingLabel={t("adminEventClone.editions.loading")}
        errorMessage={editionsQ.isError ? editionsQ.error.message : null}
        isEmpty={rows.length === 0}
        emptyLabel={t("adminEventClone.editions.empty")}
      >
        <ul className="divide-y divide-border rounded-md border border-border">
          {rows.map((row) => {
            const title = pickLocalized(row, "title", lang);
            return (
              <li key={row.id}>
                <Link
                  to="/admin/events/$eventId/overview"
                  params={{ eventId: row.id }}
                  aria-label={t("adminEventClone.editions.open", { title })}
                  className="flex items-center gap-3 px-3 py-2.5 text-[13px] hover:bg-muted"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t(RELATION_LABEL_KEYS[row.relation] ?? RELATION_LABEL_KEYS.previous)} ·{" "}
                      {formatEventDateTime(row.starts_at, row.timezone, lang)} · {t(cloneStatusKey(row.status))}
                    </span>
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      </AdminCatalogListState>
      <Link
        to="/admin/events/new"
        search={{ from: eventId }}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[13px] font-medium hover:bg-muted"
      >
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        {t("adminEventClone.editions.createNext")}
      </Link>
      <p className="text-xs text-muted-foreground">{t("adminEventClone.editions.createNextHint")}</p>
    </div>
  );
}
