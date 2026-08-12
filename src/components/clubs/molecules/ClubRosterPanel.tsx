// Moduł "Skład klubu z sygnałem obecności".
//
// ZASTĘPUJE DWA PANELE NARAZ: "Najaktywniejsi" i "Puls klubu". Oba liczyły
// TREŚĆ - pierwszy ranking wypowiedzi, drugi sumę wpisów w oknie 30 dni - a
// pytanie, na które klub musi odpowiedzieć na wejściu, brzmi: kto tu jest
// i czy ktokolwiek tu ostatnio był.
//
// TWARZE ZAMIAST WYKRESU (A34). Panel niósł wcześniej iskrę: czternaście
// słupków z liczbą różnych osób odzywających się danego dnia. To była poprawna
// odpowiedź na pytanie, którego nikt tu nie zadaje - wchodząc na klub, którego
// się nie zna, pyta się "kto tu jest", a nie "ilu ich było w środę". W tym
// samym miejscu stoi teraz sześć twarzy dobieranych rotacyjnie, z plakietką
// osoby pod kursorem; szczegóły doboru - patrz `ClubRosterFaces`.
//
// LICZBA BEZ TWARZY JEST POPRAWNYM STANEM. Klub, który ukrywa skład, oddaje
// z bazy liczby i zero awatarów. Panel pokazuje wtedy same liczby, bo
// "dwanaście osób, trzy aktywne w dobie" nadal jest informacją - a ukrycie
// całego modułu zamieniłoby decyzję klubu w usterkę interfejsu.
//
// DEKLARACJA KOMPETENCJI STOI TUTAJ, a nie w ustawieniach profilu: pytanie
// "na czym się znasz" zadaje się temu, kto właśnie patrzy na skład i widzi,
// czego temu składowi brakuje. Formularz w innym miejscu w praktyce zostaje
// pusty, a wtedy moduł ekspertów wątku nie ma czego dopasować.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CalendarPlus, Check, Loader2, Radio, Settings2, Users2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ClubRailPanel } from "@/components/clubs/atoms/ClubHubPrimitives";
import { ClubSignalMetric } from "@/components/clubs/atoms/ClubNetworkPrimitives";
import { ClubRosterFaces } from "@/components/clubs/molecules/ClubRosterFaces";
import { MoreLink } from "@/components/clubs/molecules/ClubHubContext";
import { useClubTopics } from "@/lib/clubs/useClubTopics";
import {
  useClubRosterSignal,
  useMyClubExpertise,
  useSetMyClubExpertise,
} from "@/lib/clubs/useClubNetwork";
import { hasRosterContent, CLUB_EXPERTISE_MAX } from "@/lib/clubs/networkTypes";
import { sortTopics, topicLabel } from "@/lib/clubs/topicCatalog";
import { formatNumber, uiLang } from "@/lib/i18n/format";

/**
 * Deklaracja kompetencji - lista przełączników z katalogu obszarów klubu.
 *
 * Zapis ZASTĘPUJE cały zbiór (`club_expertise_set`), więc formularz trzyma
 * roboczy stan lokalnie i wysyła go w całości. Wysyłanie różnicy wymagałoby
 * dwóch operacji i zostawiałoby okno, w którym członek nie ma żadnej
 * deklaracji - a właśnie w tym oknie ktoś mógłby szukać eksperta.
 */
export function ClubExpertiseEditor({
  clubId,
  onDone,
  variant = "rail",
}: {
  clubId: string;
  /** Brak `onDone` znaczy "formularz jest częścią ekranu" - nie ma czego zamknąć. */
  onDone?: () => void;
  variant?: "rail" | "page";
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const { topics } = useClubTopics();
  const mineQ = useMyClubExpertise(clubId);
  const save = useSetMyClubExpertise(clubId);
  const [draft, setDraft] = useState<string[]>([]);

  // Stan roboczy startuje z zapisanych deklaracji - dopiero gdy przyjdą.
  useEffect(() => {
    if (mineQ.data !== undefined) setDraft(mineQ.data);
  }, [mineQ.data]);

  const options = useMemo(() => sortTopics(topics), [topics]);
  const atLimit = draft.length >= CLUB_EXPERTISE_MAX;

  const toggle = (key: string): void => {
    setDraft((current) =>
      current.includes(key)
        ? current.filter((entry) => entry !== key)
        : atLimit
          ? current
          : [...current, key],
    );
  };

  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border border-border/60",
        variant === "page" ? "bg-card p-3 sm:p-4" : "mb-2.5 bg-muted/30 p-2.5",
      )}
    >
      {variant === "page" ? (
        <h2 className="text-sm font-semibold">{t("club.network.expertise.declare")}</h2>
      ) : null}
      <p
        className={cn(
          "leading-snug text-muted-foreground",
          variant === "page" ? "text-xs" : "text-[11px]",
        )}
      >
        {t("club.network.expertise.hint")}
      </p>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => {
          const active = draft.includes(option.key);
          return (
            <button
              key={option.key}
              type="button"
              aria-pressed={active}
              disabled={!active && atLimit}
              onClick={() => toggle(option.key)}
              className={cn(
                "inline-flex items-center gap-1 rounded-lg border px-1.5 py-1 text-[11px] font-medium transition-colors",
                active
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground",
                !active && atLimit && "cursor-not-allowed opacity-50",
              )}
            >
              {active ? <Check className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
              {topicLabel(option.key, lang, options)}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="h-8 flex-1 rounded-lg"
          disabled={save.isPending}
          onClick={() =>
            save.mutate(draft, {
              onSuccess: () => {
                onDone?.();
                toast.success(t("club.network.expertise.saved"));
              },
              onError: () => toast.error(t("club.network.expertise.failed")),
            })
          }
        >
          {save.isPending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : null}
          {t("club.network.expertise.save")}
        </Button>
        {onDone !== undefined ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 rounded-lg"
            onClick={onDone}
            disabled={save.isPending}
          >
            {t("club.network.board.cancel")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function ClubRosterPanel({
  clubSlug,
  clubId,
  canSeeMembers,
  canDeclare,
  locale,
}: {
  clubSlug: string;
  clubId: string;
  canSeeMembers: boolean;
  /** Deklarować kompetencję może ten, kto w klubie jest - nie każdy widz. */
  canDeclare: boolean;
  locale: string;
}) {
  const { t, i18n } = useTranslation();
  const { topics } = useClubTopics();
  const [editing, setEditing] = useState(false);
  const query = useClubRosterSignal({ clubId });
  const signal = query.data ?? null;

  if (query.isPending) {
    return (
      <ClubRailPanel title={t("club.network.roster.title")} icon={Users2}>
        <div className="h-24 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />
      </ClubRailPanel>
    );
  }

  if (!hasRosterContent(signal) || signal === null) return null;

  return (
    <ClubRailPanel
      title={t("club.network.roster.title")}
      icon={Users2}
      action={
        canSeeMembers ? (
          <MoreLink to="/club/$clubSlug/members" clubSlug={clubSlug} label={t("club.hub.more")} />
        ) : undefined
      }
    >
      {editing ? <ClubExpertiseEditor clubId={clubId} onDone={() => setEditing(false)} /> : null}

      {/* Twarze STOJĄ NAD LICZBAMI, bo odpowiadają na pierwsze pytanie
          ("kto tu jest"), a liczby na drugie ("ilu ich jest"). Odwrotna
          kolejność robiła z modułu licznik z ilustracją. */}
      <ClubRosterFaces faces={signal.faces} topicCatalog={topics} className="mb-3" />

      <div className="grid grid-cols-3 gap-2">
        <ClubSignalMetric
          icon={Users2}
          value={formatNumber(signal.membersTotal, locale)}
          label={t("club.network.roster.total")}
        />
        <ClubSignalMetric
          icon={Radio}
          value={formatNumber(signal.active24h, locale)}
          label={t("club.network.roster.active24h")}
          emphasis={signal.active24h > 0}
        />
        <ClubSignalMetric
          icon={CalendarPlus}
          value={formatNumber(signal.new7d, locale)}
          label={t("club.network.roster.new7d")}
          emphasis={signal.new7d > 0}
        />
      </div>

      {canDeclare && !editing ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2 h-7 w-full justify-start gap-1.5 rounded-lg px-1.5 text-[11px] text-muted-foreground"
          onClick={() => setEditing(true)}
        >
          <Settings2 className="h-3 w-3 shrink-0" aria-hidden="true" />
          {t("club.network.expertise.declare")}
        </Button>
      ) : null}
    </ClubRailPanel>
  );
}
