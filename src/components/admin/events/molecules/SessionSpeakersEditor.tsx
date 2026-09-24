// Molekula: OBSADA SESJI w formularzu sesji - kto wystepuje i w jakiej roli.
//
// PO CO. Hak `useSetSessionSpeakers` i RPC `admin_event_session_speakers_set`
// istnialy, ale ZADEN ekran panelu ich nie wolal - obsade dalo sie ustawic
// wylacznie w bazie. Tymczasem to obsada decyduje, kto stoi przy sesji
// w programie, kto jest w obsadzie pasma i jakie SCIEZKI ma prelegent na
// swojej karcie. Bez tego ekranu „prelegent automatycznie w sciezce" nie mial
// skad sie wziac.
//
// SCIEZKA NIE JEST POLEM. Przypisanie do sesji w sciezce dopisuje prelegentowi
// te sciezke samo; edytor tylko o tym mowi (nazwa sciezki sesji w podpisie).
//
// OSOBNY ZAPIS, NIE CZESC FORMULARZA SESJI. RPC podmienia CALA obsade i ma
// wlasne odmowy (nachodzenie godzin prelegenta), a formularz sesji ma wlasny
// „Zapisz". Jeden przycisk dla dwoch zapisow znaczylby pol-zapis po odmowie
// drugiego - wiec obsada ma swoj przycisk i swoj komunikat.
//
// NOWA SESJA NIE MA OBSADY. RPC potrzebuje identyfikatora sesji, wiec przed
// pierwszym zapisem sekcja mowi, co zrobic, zamiast pokazywac martwa liste.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, EyeOff, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import "@/lib/i18n-admin-event-agenda";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AdminFormSection } from "@/components/admin/molecules/AdminFormSection";
import { SpeakerAvatar } from "@/components/events/SpeakerAvatar";
import { fetchEventSpeakers } from "@/lib/admin/community";
import { adminAgendaFailure } from "@/lib/events/adminAgendaErrors";
import { uiLang } from "@/lib/i18n/format";
import { SESSION_SPEAKER_ROLES } from "@/lib/events/sessionsApi";
import {
  castCandidates,
  castMemberFromEntry,
  moveCastMember,
  parseSessionCast,
  sessionCastRoleLine,
  sessionCastSignature,
  sessionCastToInput,
  sessionSpeakerRole,
  type SessionCastMember,
} from "@/lib/events/sessionCast";
import { useSessionDetail, useSetSessionSpeakers } from "@/lib/events/useEventSessions";

export function SessionSpeakersEditor({
  eventId,
  sessionId,
  trackName,
  onDirtyChange,
}: {
  eventId: string;
  /** `null` = sesja jeszcze niezapisana. */
  sessionId: string | null;
  /** Nazwa sciezki sesji (ze szkicu formularza) albo `null` bez sciezki. */
  trackName: string | null;
  /**
   * Czy obsada ma niezapisane zmiany. Formularz sesji ma wlasne „Zapisz",
   * ktore zamyka dialog - bez tej wiadomosci zamkniecie po cichu wyrzucaloby
   * edycje obsady.
   */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const hint = t("adminEventAgenda.sessionSpeakers.hint");
  if (sessionId === null) {
    return (
      <AdminFormSection title={t("adminEventAgenda.sessionSpeakers.title")} hint={hint}>
        <p className="text-xs text-muted-foreground">
          {t("adminEventAgenda.sessionSpeakers.newSessionHint")}
        </p>
      </AdminFormSection>
    );
  }
  return (
    <AdminFormSection title={t("adminEventAgenda.sessionSpeakers.title")} hint={hint}>
      <CastEditor
        key={sessionId}
        eventId={eventId}
        sessionId={sessionId}
        trackName={trackName}
        onDirtyChange={onDirtyChange}
      />
    </AdminFormSection>
  );
}

function CastEditor({
  eventId,
  sessionId,
  trackName,
  onDirtyChange,
}: {
  eventId: string;
  sessionId: string;
  trackName: string | null;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const detailQ = useSessionDetail(sessionId);
  // TEN SAM KLUCZ, CO EKRAN PRELEGENTOW - rejestr jest w cache, gdy redaktor
  // przychodzi z listy prelegentow, i wietrzy go kazda mutacja programu.
  const speakersQ = useQuery({
    queryKey: ["admin-event-speakers", eventId] as const,
    queryFn: () => fetchEventSpeakers(eventId),
    staleTime: 15_000,
  });
  const saveM = useSetSessionSpeakers(eventId);

  const serverCast = useMemo(
    () => parseSessionCast(detailQ.data?.speakers ?? null),
    [detailQ.data],
  );
  // `null` = redaktor niczego nie ruszyl, wiec lista idzie za serwerem
  // (odswiezenie w tle nie nadpisze edycji, bo edycja trzyma wlasna kopie).
  const [edited, setEdited] = useState<SessionCastMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cast = edited ?? serverCast;
  const dirty =
    edited !== null && sessionCastSignature(edited) !== sessionCastSignature(serverCast);
  const candidates = castCandidates(speakersQ.data, cast);

  // Odmontowanie (zamkniecie dialogu, zmiana sesji) = brak zmian do pilnowania.
  // Jeden efekt: nowa funkcja od rodzica dostaje od razu biezacy stan.
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  const update = (next: SessionCastMember[]): void => {
    setEdited(next);
    setError(null);
  };

  const save = (): void => {
    saveM.mutate(
      { sessionId, speakers: sessionCastToInput(cast) },
      {
        onSuccess: () => {
          setEdited(null);
          toast.success(t("adminEventAgenda.sessions.toasts.speakersSaved"));
        },
        onError: (e) => {
          const failure = adminAgendaFailure(e);
          setError(t(failure.key, failure.params));
        },
      },
    );
  };

  if (detailQ.isPending) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        {t("adminEventAgenda.sessionSpeakers.loading")}
      </p>
    );
  }
  if (detailQ.isError) {
    return (
      <p role="alert" className="text-xs text-destructive">
        {t("adminEventAgenda.sessionSpeakers.loadFailed")}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {trackName === null
          ? t("adminEventAgenda.sessionSpeakers.noTrack")
          : t("adminEventAgenda.sessionSpeakers.trackNote", { name: trackName })}
      </p>

      {cast.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("adminEventAgenda.sessionSpeakers.empty")}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {cast.map((member, index) => {
            const name =
              member.displayName === ""
                ? t("adminEventAgenda.sessionSpeakers.unnamed")
                : member.displayName;
            return (
              <li
                key={member.speakerProfileId}
                className="flex flex-wrap items-center gap-2 rounded-[6px] border border-border/60 bg-muted/20 p-1.5"
              >
                <SpeakerAvatar name={member.displayName} photoUrl={member.avatarUrl} size="sm" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{name}</span>
                  {sessionCastRoleLine(member, lang) !== null && (
                    <span className="truncate text-[11px] text-muted-foreground">
                      {sessionCastRoleLine(member, lang)}
                    </span>
                  )}
                  {!member.isPublic && (
                    <span className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                      <EyeOff className="h-3 w-3" aria-hidden="true" />
                      {t("adminEventAgenda.sessionSpeakers.notPublic")}
                    </span>
                  )}
                </span>
                <Select
                  value={member.role}
                  onValueChange={(value) =>
                    update(
                      cast.map((item, i) =>
                        i === index ? { ...item, role: sessionSpeakerRole(value) } : item,
                      ),
                    )
                  }
                >
                  <SelectTrigger
                    className="h-8 w-36 rounded-[6px] text-xs"
                    aria-label={t("adminEventAgenda.sessionSpeakers.roleLabel", { name })}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SESSION_SPEAKER_ROLES.map((role) => (
                      <SelectItem key={role} value={role}>
                        {t(`adminEventAgenda.roles.${role}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label={t("adminEventAgenda.sessionSpeakers.moveUp", { name })}
                  disabled={index === 0}
                  onClick={() => update(moveCastMember(cast, index, -1))}
                >
                  <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label={t("adminEventAgenda.sessionSpeakers.moveDown", { name })}
                  disabled={index === cast.length - 1}
                  onClick={() => update(moveCastMember(cast, index, 1))}
                >
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive"
                  aria-label={t("adminEventAgenda.sessionSpeakers.remove", { name })}
                  onClick={() => update(cast.filter((_item, i) => i !== index))}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {candidates.length > 0 ? (
        <Select
          value=""
          onValueChange={(id) => {
            const entry = candidates.find((item) => item.speaker_profile_id === id);
            if (entry !== undefined) update([...cast, castMemberFromEntry(entry)]);
          }}
        >
          <SelectTrigger
            className="h-9 rounded-[6px] text-xs"
            aria-label={t("adminEventAgenda.sessionSpeakers.addLabel")}
          >
            <SelectValue placeholder={t("adminEventAgenda.sessionSpeakers.addPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {candidates.map((entry) => (
              <SelectItem key={entry.speaker_profile_id} value={entry.speaker_profile_id}>
                {entry.display_name || t("adminEventAgenda.sessionSpeakers.unnamed")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : speakersQ.isError ? (
        // Bez tej galezi odmowa rejestru bylaby cisza: ani listy, ani powodu.
        <p role="alert" className="text-[11px] text-destructive">
          {t("adminEventAgenda.sessionSpeakers.registryFailed")}
        </p>
      ) : (
        speakersQ.isSuccess && (
          <p className="text-[11px] text-muted-foreground">
            {t("adminEventAgenda.sessionSpeakers.noCandidates")}
          </p>
        )
      )}

      {error !== null && (
        <p role="alert" className="rounded-[6px] bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!dirty || saveM.isPending}
          onClick={save}
        >
          {saveM.isPending && (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          )}
          {saveM.isPending
            ? t("adminEventAgenda.sessionSpeakers.saving")
            : t("adminEventAgenda.sessionSpeakers.saveAction")}
        </Button>
        {dirty && !saveM.isPending && (
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setEdited(null);
                setError(null);
              }}
            >
              {t("adminEventAgenda.sessionSpeakers.discardAction")}
            </Button>
            <span className="text-[11px] text-muted-foreground">
              {t("adminEventAgenda.sessionSpeakers.unsaved")}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
