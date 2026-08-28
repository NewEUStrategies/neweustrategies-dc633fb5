// Organizm: HISTORIA ZMIAN UPRAWNIEN DO STAWEK.
//
// EKRAN ODPOWIADA NA JEDNO PYTANIE AUDYTU: kto, kiedy i co zmienil. Lista
// nadan pokazuje STAN dzisiejszy - a faktura z ulga pyta o DROGE: kto
// przedluzyl waznosc, kto podmienil podstawe, kto wycofal. Zrodlem jest
// wspolny dziennik audytu, wypelniany przez trigger bazy, wiec zadna sciezka
// zapisu (panel, RPC, zadanie serwisowe) nie omija tego rejestru.
//
// DZIENNIK JEST TYLKO DO ODCZYTU. Nie ma tu akcji edycji ani kasowania -
// wpis, ktory da sie poprawic, nie jest sladem audytowym.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { History, ArrowRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { FormSelect } from "@/components/atoms/FormSelect";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { adminRegistrationErrorMessage } from "@/lib/events/adminRegistrationErrors";
import { formatDateTime } from "@/lib/i18n/format";
import {
  audienceGrantAction,
  historyValueText,
  type AudienceGrantAction,
  type EventAudienceGrantHistoryRow,
} from "@/lib/events/audienceGrantsApi";
import { useAudienceGrantHistory } from "@/lib/events/useEventAudienceGrants";

const HISTORY_LIMITS = [50, 100, 250] as const;

const ACTION_BADGE: Record<AudienceGrantAction, "default" | "secondary" | "outline"> = {
  granted: "default",
  updated: "secondary",
  revoked: "outline",
  restored: "secondary",
};

export interface EventAudienceGrantHistoryPanelProps {
  eventId: string;
  /** Ustawione = historia jednego nadania (wejscie z wiersza listy). */
  grantId?: string | null;
  /** Widok zagniezdzony w oknie nie powtarza naglowka sekcji. */
  embedded?: boolean;
}

function actorLabel(row: EventAudienceGrantHistoryRow, fallback: string): string {
  const name = (row.actor_name ?? "").trim();
  if (name !== "") return name;
  const email = (row.actor_email ?? "").trim();
  if (email !== "") return email;
  return fallback;
}

function subjectLabel(row: EventAudienceGrantHistoryRow, fallback: string): string {
  const name = (row.subject_name ?? "").trim();
  if (name !== "") return name;
  const email = (row.subject_email ?? "").trim();
  if (email !== "") return email;
  return fallback;
}

export function EventAudienceGrantHistoryPanel({
  eventId,
  grantId = null,
  embedded = false,
}: EventAudienceGrantHistoryPanelProps) {
  const { t, i18n } = useTranslation();
  const [scopeThisEvent, setScopeThisEvent] = useState(true);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState<number>(HISTORY_LIMITS[0]);

  const locale = i18n.language.startsWith("en") ? "en" : "pl";

  const query = useMemo(
    () => ({
      eventId: grantId === null && scopeThisEvent ? eventId : null,
      grantId,
      search,
      limit,
    }),
    [eventId, grantId, limit, scopeThisEvent, search],
  );

  const historyQ = useAudienceGrantHistory(query);
  const rows = historyQ.data ?? [];

  return (
    <section className="space-y-4">
      {embedded ? null : (
        <header className="space-y-1">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {t("adminEventRegistration.audienceGrantHistory.title")}
          </h3>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("adminEventRegistration.audienceGrantHistory.subtitle")}
          </p>
        </header>
      )}

      <div className="grid gap-3 rounded-md border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="grant-history-search">
            {t("adminEventRegistration.audienceGrantHistory.searchLabel")}
          </Label>
          <Input
            id="grant-history-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("adminEventRegistration.audienceGrantHistory.searchPlaceholder")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="grant-history-limit">
            {t("adminEventRegistration.audienceGrantHistory.limitLabel")}
          </Label>
          <FormSelect
            id="grant-history-limit"
            value={String(limit)}
            onValueChange={(value) => {
              const parsed = Number.parseInt(value, 10);
              setLimit(HISTORY_LIMITS.find((item) => item === parsed) ?? HISTORY_LIMITS[0]);
            }}
            options={HISTORY_LIMITS.map((item) => ({
              value: String(item),
              label: String(item),
            }))}
          />
        </div>
        {grantId === null ? (
          <div className="flex items-center gap-2 pt-6">
            <Switch
              id="grant-history-scope"
              checked={scopeThisEvent}
              onCheckedChange={setScopeThisEvent}
            />
            <Label htmlFor="grant-history-scope" className="cursor-pointer">
              {t("adminEventRegistration.audienceGrants.scopeThis")}
            </Label>
          </div>
        ) : null}
      </div>

      <AdminCatalogListState
        isLoading={historyQ.isLoading}
        loadingLabel={t("adminEventRegistration.audienceGrantHistory.loading")}
        errorMessage={
          historyQ.error === null ? null : adminRegistrationErrorMessage(historyQ.error)
        }
        isEmpty={rows.length === 0}
        emptyLabel={t("adminEventRegistration.audienceGrantHistory.empty")}
      >
        <ol className="divide-y divide-border rounded-md border border-border">
          {rows.map((row) => {
            const action = audienceGrantAction(row.action);
            const changed = row.changed ?? [];
            return (
              <li key={row.id} className="space-y-2 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={ACTION_BADGE[action]}>
                    {t(`adminEventRegistration.audienceGrantHistory.actions.${action}`)}
                  </Badge>
                  <span className="font-medium">
                    {actorLabel(row, t("adminEventRegistration.audienceGrantHistory.actorUnknown"))}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(row.created_at, locale)}
                  </span>
                </div>

                <p className="text-sm text-muted-foreground">
                  {t("adminEventRegistration.audienceGrantHistory.summary", {
                    subject: subjectLabel(
                      row,
                      t("adminEventRegistration.audienceGrantHistory.subjectUnknown"),
                    ),
                    audience: t(
                      `adminEventRegistration.audienceGrants.audiences.${row.audience ?? ""}`,
                      { defaultValue: row.audience ?? "-" },
                    ),
                    scope: row.event_title ?? t("adminEventRegistration.audienceGrants.scopeAll"),
                  })}
                </p>

                {changed.length === 0 ? null : (
                  <ul className="space-y-1 rounded-md bg-muted/40 p-2 text-xs">
                    {changed.map((field) => {
                      const before = historyValueText(
                        (row.before_values as Record<string, never> | null)?.[field],
                      );
                      const after = historyValueText(
                        (row.after_values as Record<string, never> | null)?.[field],
                      );
                      return (
                        <li key={field} className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">
                            {t(`adminEventRegistration.audienceGrantHistory.fields.${field}`, {
                              defaultValue: field,
                            })}
                          </span>
                          <span className="text-muted-foreground line-through">
                            {before === ""
                              ? t("adminEventRegistration.audienceGrantHistory.emptyValue")
                              : before}
                          </span>
                          <ArrowRight
                            className="h-3 w-3 text-muted-foreground"
                            aria-hidden="true"
                          />
                          <span>
                            {after === ""
                              ? t("adminEventRegistration.audienceGrantHistory.emptyValue")
                              : after}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      </AdminCatalogListState>

      {embedded ? null : (
        <p className="text-xs text-muted-foreground">
          {t("adminEventRegistration.audienceGrantHistory.footnote")}
        </p>
      )}
    </section>
  );
}

export function EventAudienceGrantHistoryButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Button type="button" variant="ghost" size="sm" className="gap-2" onClick={onClick}>
      <History className="h-4 w-4" aria-hidden="true" />
      {label}
    </Button>
  );
}
