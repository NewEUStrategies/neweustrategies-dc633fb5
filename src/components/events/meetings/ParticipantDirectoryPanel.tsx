// Organizm: KATALOG UCZESTNIKÓW giełdy - pierwszy kontakt.
//
// TO JEST BRAKUJĄCE OGNIWO GIEŁDY. Do tej pory uczestnik mógł odpowiedzieć na
// zaproszenie i przełożyć rozmowę z kimś, kogo już zna, ale nie miał jak
// zaprosić nikogo nowego: `event_meeting_invite` chce identyfikatora zgłoszenia
// kontrahenta, a plaszczyzna uczestnika nie miała skąd go wziąć.
//
// LISTA JEST JUŻ PRZEFILTROWANA REGUŁĄ ZAPROSZENIA. Baza przepuszcza przez
// `_event_meeting_can_invite` każdy wiersz, więc każdy przycisk „Zaproś" na tej
// liście naprawdę działa. Dlatego nie ma tu ani jednego dodatkowego `if`
// powielającego warunki - powielony rozjechałby się z bazą przy pierwszej
// zmianie reguły.
//
// WŁASNA WIDOCZNOŚĆ JEST OBOK LISTY, NIE W USTAWIENIACH KONTA. Uczestnik
// podejmuje tę decyzję dokładnie wtedy, gdy widzi, co ona znaczy - patrząc na
// listę, na której sam się znajduje.
import { useState } from "react";
import { CalendarPlus, Loader2, Search, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { ConnectButton } from "@/components/network/ConnectButton";
import { DirectMessageButton } from "@/components/network/DirectMessageButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  directoryBlockKey,
  directoryEntryName,
  directoryEntrySubtitle,
  EMPTY_DIRECTORY,
  type DirectoryEntry,
} from "@/lib/events/meetingDirectory";
import { meetingErrorI18nKey } from "@/lib/events/meetingsErrors";
import {
  useInviteToMeeting,
  useMeetingDirectory,
  useSetDirectoryVisibility,
} from "@/lib/events/useMyMeetings";
import { MeetingInviteDialog } from "@/components/events/meetings/MeetingInviteDialog";
import { ensureI18n as ensureEventMeetingsI18n } from "@/lib/i18n-event-meetings";

ensureEventMeetingsI18n();

const PAGE_SIZE = 24;

export function ParticipantDirectoryPanel({
  slug,
  timezone,
  onOpenMeetings,
}: {
  slug: string;
  timezone: string | null;
  onOpenMeetings: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);

  const [query, setQuery] = useState("");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [invitee, setInvitee] = useState<DirectoryEntry | null>(null);

  // Wpisywanie w wyszukiwarkę nie może wysyłać zapytania na każdy znak -
  // katalog liczy w bazie przecięcie grup i reguł zaproszenia dla każdego
  // wiersza, więc to jest najdroższe zapytanie tego ekranu.
  const debounced = useDebouncedValue(query, 300);

  const directory = useMeetingDirectory(slug, {
    q: debounced.trim(),
    groupId,
    offset,
    limit: PAGE_SIZE,
  });
  const invite = useInviteToMeeting(slug);
  const visibility = useSetDirectoryVisibility(slug);

  const data = directory.data ?? EMPTY_DIRECTORY;

  if (directory.isPending) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (directory.isError) {
    return (
      <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        {t(meetingErrorI18nKey(directory.error))}
      </p>
    );
  }

  if (data.blocked !== null) {
    return (
      <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
        {t(directoryBlockKey(data.blocked))}
      </p>
    );
  }

  const pageStart = offset + 1;
  const pageEnd = Math.min(offset + data.rows.length, data.totalCount);

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">
          {t("eventMeetings.participant.directory.heading")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("eventMeetings.participant.directory.subtitle")}
        </p>
      </header>

      {/* --------------------------------------------------- własna widoczność */}
      <label className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5">
        <Switch
          checked={!data.optedOut}
          disabled={visibility.isPending}
          onCheckedChange={(next) =>
            visibility.mutate(next, {
              onError: (error) => toast.error(t(meetingErrorI18nKey(error))),
            })
          }
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-foreground">
            {t("eventMeetings.participant.directory.listedLabel")}
          </span>
          <span className="block text-xs text-muted-foreground">
            {t("eventMeetings.participant.directory.listedHint")}
          </span>
        </span>
        <Badge variant={data.optedOut ? "outline" : "secondary"}>
          {data.optedOut
            ? t("eventMeetings.participant.directory.listedOff")
            : t("eventMeetings.participant.directory.listedOn")}
        </Badge>
      </label>

      {/* ------------------------------------------------------------ filtry */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOffset(0);
            }}
            placeholder={t("eventMeetings.participant.directory.searchPlaceholder")}
            aria-label={t("eventMeetings.fields.search")}
            className="pl-9"
          />
        </div>
      </div>

      {data.groups.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={groupId === null ? "secondary" : "ghost"}
            onClick={() => {
              setGroupId(null);
              setOffset(0);
            }}
          >
            {t("eventMeetings.participant.directory.allGroups")}
          </Button>
          {data.groups.map((group) => (
            <Button
              key={group.id}
              type="button"
              size="sm"
              variant={groupId === group.id ? "secondary" : "ghost"}
              onClick={() => {
                setGroupId(group.id);
                setOffset(0);
              }}
            >
              {pickLocalized({ name_pl: group.namePl, name_en: group.nameEn }, "name", lang)}
            </Button>
          ))}
        </div>
      )}

      {/* -------------------------------------------------------------- lista */}
      {data.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {debounced.trim() === "" && groupId === null
            ? t("eventMeetings.participant.directory.empty")
            : t("eventMeetings.participant.directory.emptyFiltered")}
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {t("eventMeetings.participant.directory.count", { count: data.totalCount })}
          </p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {data.rows.map((entry) => (
              <li
                key={entry.registrationId}
                className="flex flex-col gap-3 rounded-md border border-border bg-card p-4"
              >
                <div className="flex min-w-0 items-start gap-3">
                  {entry.photoUrl === null ? (
                    <span
                      aria-hidden="true"
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-[6px] border border-border bg-muted text-sm font-semibold text-muted-foreground"
                    >
                      {(directoryEntryName(entry).slice(0, 1) || "?").toUpperCase()}
                    </span>
                  ) : (
                    <img
                      src={entry.photoUrl}
                      alt=""
                      aria-hidden="true"
                      className="h-10 w-10 shrink-0 rounded-[6px] border border-border object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {directoryEntryName(entry)}
                    </p>
                    <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      {entry.companyLogoUrl !== null && (
                        <img
                          src={entry.companyLogoUrl}
                          alt=""
                          aria-hidden="true"
                          className="h-4 w-4 shrink-0 rounded-[3px] border border-border bg-background object-contain"
                        />
                      )}
                      <span className="truncate">{directoryEntrySubtitle(entry)}</span>
                    </p>
                  </div>
                </div>

                {entry.userId !== null && (
                  <div className="flex flex-wrap items-center gap-2">
                    <ConnectButton
                      userId={entry.userId}
                      displayName={directoryEntryName(entry)}
                      compact
                    />
                    <DirectMessageButton
                      userId={entry.userId}
                      displayName={directoryEntryName(entry)}
                      displayAvatar={entry.photoUrl}
                      compact
                    />
                  </div>
                )}

                <div className="flex flex-wrap gap-1.5">
                  {[entry.industry, entry.specialization]
                    .filter((value): value is string => value !== null && value.trim() !== "")
                    .map((value) => (
                      <Badge key={value} variant="outline">
                        {value}
                      </Badge>
                    ))}
                  {entry.groups.map((group) => (
                    <Badge
                      key={group.id}
                      variant="outline"
                      style={group.color === null ? undefined : { borderColor: group.color }}
                    >
                      {pickLocalized(
                        { name_pl: group.namePl, name_en: group.nameEn },
                        "name",
                        lang,
                      )}
                    </Badge>
                  ))}
                  <Badge variant={entry.hasAvailability ? "secondary" : "outline"}>
                    {entry.hasAvailability
                      ? t("eventMeetings.participant.directory.hasAvailability")
                      : t("eventMeetings.participant.directory.noAvailability")}
                  </Badge>
                </div>

                {entry.meetingStatus === null ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="mt-auto w-full"
                    onClick={() => setInvitee(entry)}
                  >
                    <CalendarPlus className="mr-2 h-4 w-4" aria-hidden="true" />
                    {t("eventMeetings.participant.directory.invite")}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="mt-auto w-full"
                    onClick={onOpenMeetings}
                  >
                    <Users className="mr-2 h-4 w-4" aria-hidden="true" />
                    {entry.meetingStatus === "invited"
                      ? t("eventMeetings.participant.directory.alreadyInvited")
                      : t("eventMeetings.participant.directory.alreadyMeeting")}
                  </Button>
                )}
              </li>
            ))}
          </ul>

          {data.totalCount > PAGE_SIZE && (
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(offset - PAGE_SIZE, 0))}
              >
                {t("eventMeetings.participant.directory.prevPage")}
              </Button>
              <span className="text-xs text-muted-foreground">
                {pageStart}-{pageEnd} / {data.totalCount}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={offset + PAGE_SIZE >= data.totalCount}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                {t("eventMeetings.participant.directory.nextPage")}
              </Button>
            </div>
          )}
        </>
      )}

      {directory.isFetching && (
        <p className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          {t("eventMeetings.participant.directory.loading")}
        </p>
      )}

      <MeetingInviteDialog
        open={invitee !== null}
        slug={slug}
        counterpartRegistrationId={invitee?.registrationId ?? null}
        counterpartName={invitee === null ? "" : directoryEntryName(invitee)}
        timezone={timezone}
        isPending={invite.isPending}
        onOpenChange={(next) => {
          if (!next) setInvitee(null);
        }}
        onSubmit={(input) => {
          if (invitee === null) return;
          invite.mutate(
            {
              eventSlug: slug,
              counterpartRegistrationId: invitee.registrationId,
              startsAt: input.startsAt,
              topic: input.topic,
              message: input.message,
            },
            {
              onSuccess: () => {
                setInvitee(null);
                toast.success(t("eventMeetings.participant.directory.inviteSent"));
              },
              onError: (error) => toast.error(t(meetingErrorI18nKey(error))),
            },
          );
        }}
      />
    </div>
  );
}
