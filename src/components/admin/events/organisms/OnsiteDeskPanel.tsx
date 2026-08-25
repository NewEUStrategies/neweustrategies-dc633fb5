// Organizm: STANOWISKO ODPRAWY - szukanie osoby i zapis wejścia.
//
// PUNKT KONTROLNY WYBIERA SIĘ RAZ, NA GÓRZE. Operator przy bramce klika w jedną
// kolumnę przez cały dzień; punkt wybierany przy każdym wierszu byłby czwartym
// kliknięciem na osobę i pierwszym miejscem na pomyłkę pod presją kolejki.
//
// DECYZJĘ PODEJMUJE BAZA, NIE TEN EKRAN. Panel wysyła `admin_event_checkin_manual`
// i pokazuje zwróconą decyzję - ekran nie liczy pojemności ani nie sprawdza
// statusu zapisu, bo dwa stanowiska pracujące równolegle policzyłyby to samo
// miejsce dwa razy.
//
// ŹRÓDŁO ODPRAWY TO `name_search`, NIE „skan". Wpis z panelu nie ma prawa
// udawać piknięcia urządzeniem - audyt musi widzieć, że kogoś wpuścił człowiek.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { LogIn, LogOut, Printer, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { FormSelect } from "@/components/atoms/FormSelect";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { adminOnsiteErrorMessage } from "@/lib/events/adminOnsiteErrors";
import {
  useBadgeTemplates,
  useCheckinSearch,
  useCheckpoints,
  useManualCheckin,
  useRecordBadgePrint,
} from "@/lib/events/useEventOnsite";
import { uiLang } from "@/lib/i18n/format";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { CheckinDirection, CheckinOutcome, CheckinSearchRow } from "@/lib/events/onsiteApi";

export function OnsiteDeskPanel({ eventId }: { eventId: string }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [checkpointId, setCheckpointId] = useState("");
  const [term, setTerm] = useState("");
  const debounced = useDebouncedValue(term, 250);
  const [lastOutcome, setLastOutcome] = useState<CheckinOutcome | null>(null);

  const checkpointsQ = useCheckpoints(eventId);
  const templatesQ = useBadgeTemplates(eventId);
  const searchQ = useCheckinSearch(eventId, debounced, checkpointId !== "");
  const checkin = useManualCheckin(eventId);
  const print = useRecordBadgePrint(eventId);

  const checkpoints = useMemo(
    () => (checkpointsQ.data ?? []).filter((row) => row.is_active),
    [checkpointsQ.data],
  );
  const selected = checkpoints.find((row) => row.id === checkpointId) ?? null;
  const defaultTemplate = (templatesQ.data ?? []).find((row) => row.is_default) ?? null;

  const fail = (error: unknown) => toast.error(adminOnsiteErrorMessage(error));

  const personName = (row: CheckinSearchRow) => `${row.first_name} ${row.last_name}`.trim();

  const admit = (row: CheckinSearchRow, direction: CheckinDirection) => {
    if (checkpointId === "") {
      toast.error(t("adminEventOnsite.desk.selectCheckpoint"));
      return;
    }
    checkin.mutate(
      {
        eventId,
        checkpointId,
        personId: row.person_id,
        direction,
        source: "name_search",
      },
      {
        onSuccess: (outcome) => {
          setLastOutcome(outcome);
          if (outcome.admit) {
            toast.success(
              t("adminEventOnsite.desk.outcome.granted", { name: personName(row) }),
            );
          } else {
            toast.error(
              t("adminEventOnsite.desk.outcome.denied", {
                reason: t(`adminEventOnsite.results.${outcome.result}`, {
                  defaultValue: outcome.result,
                }),
              }),
            );
          }
        },
        onError: fail,
      },
    );
  };

  const printBadge = (row: CheckinSearchRow) => {
    print.mutate(
      {
        eventId,
        personId: row.person_id,
        templateId: defaultTemplate?.id,
        copies: 1,
        reason: "desk",
      },
      {
        onSuccess: () => toast.success(t("adminEventOnsite.desk.toasts.badgePrinted")),
        onError: fail,
      },
    );
  };

  const rows = searchQ.data ?? [];

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h2 className="font-display text-lg">{t("adminEventOnsite.desk.title")}</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t("adminEventOnsite.desk.subtitle")}
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="desk-checkpoint">{t("adminEventOnsite.filters.checkpoint")}</Label>
          <FormSelect
            id="desk-checkpoint"
            value={checkpointId}
            placeholder={t("adminEventOnsite.desk.selectCheckpoint")}
            options={checkpoints.map((row) => ({
              value: row.id,
              label: lang === "en" ? row.name_en || row.name_pl : row.name_pl || row.name_en,
            }))}
            onValueChange={setCheckpointId}
            aria-label={t("adminEventOnsite.filters.checkpoint")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="desk-search">{t("adminEventOnsite.filters.search")}</Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="desk-search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder={t("adminEventOnsite.desk.searchPlaceholder")}
              className="pl-9"
            />
          </div>
          <p className="text-xs text-muted-foreground">{t("adminEventOnsite.desk.searchHint")}</p>
        </div>
      </div>

      {lastOutcome === null ? null : (
        <Card className={lastOutcome.admit ? "border-emerald-500/60" : "border-destructive/60"}>
          <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <Badge variant={lastOutcome.admit ? "default" : "destructive"}>
              {t(`adminEventOnsite.results.${lastOutcome.result}`, {
                defaultValue: lastOutcome.result,
              })}
            </Badge>
            <span className="text-muted-foreground">
              {t(`adminEventOnsite.directions.${lastOutcome.direction}`, {
                defaultValue: lastOutcome.direction,
              })}
            </span>
            {lastOutcome.repeatCount > 1 ? (
              <span className="text-muted-foreground">
                {t("adminEventOnsite.desk.outcome.repeat", { count: lastOutcome.repeatCount })}
              </span>
            ) : null}
          </CardContent>
        </Card>
      )}

      <AdminCatalogListState
        isLoading={searchQ.isLoading && debounced.trim().length >= 2}
        loadingLabel={t("adminEventOnsite.desk.loading")}
        errorMessage={
          searchQ.error === null || searchQ.error === undefined
            ? null
            : adminOnsiteErrorMessage(searchQ.error)
        }
        isEmpty={rows.length === 0}
        emptyLabel={t("adminEventOnsite.desk.empty")}
      >
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.person_id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-border/70 p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{personName(row)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[row.job_title, row.company].filter((part) => part !== null && part !== "").join(" · ")}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {row.registration_id === null ? (
                  <Badge variant="destructive">{t("adminEventOnsite.desk.noRegistration")}</Badge>
                ) : (
                  <Badge variant="secondary">{row.registration_status}</Badge>
                )}
                {row.badge_printed ? (
                  <Badge variant="outline">{t("adminEventOnsite.labels.badgePrinted")}</Badge>
                ) : null}
                {row.last_checkin_at === null ? null : (
                  <Badge variant="outline">
                    {`${t("adminEventOnsite.labels.lastCheckin")}: ${new Date(
                      row.last_checkin_at,
                    ).toLocaleTimeString(i18n.language)}`}
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-1">
                <Button size="sm" onClick={() => admit(row, "in")} disabled={checkin.isPending}>
                  <LogIn className="mr-2 h-4 w-4" aria-hidden="true" />
                  {t("adminEventOnsite.actions.checkIn")}
                </Button>
                {selected !== null && selected.direction_mode === "in_out" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => admit(row, "out")}
                    disabled={checkin.isPending}
                  >
                    <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
                    {t("adminEventOnsite.actions.checkOut")}
                  </Button>
                ) : null}
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t("adminEventOnsite.actions.printBadge")}
                  onClick={() => printBadge(row)}
                  disabled={print.isPending}
                >
                  <Printer className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </AdminCatalogListState>
    </section>
  );
}
