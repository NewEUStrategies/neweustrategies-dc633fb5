// Widget "event-schedule" - agenda wydarzenia w ukladzie inspirowanym blokiem
// Flowbite "event schedule": zakladki dni (pigulki z data), siatka sesji
// (badge czasu + tytul + opis + prelegenci + sala), sloty przerw ze
// sponsorami. Prelegent moze byc wpisany recznie albo wskazywac profil
// (userId -> speaker_profiles/CRM przez RPC get_public_speakers); klik na
// prelegenta z profilem otwiera SpeakerProfileDialog. i18n PL/EN, dark/light
// przez tokeny, 6px rounding, akcent przez --speakers-accent.
import { useMemo, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WidgetContent } from "@/lib/builder/types";
import { safeImageUrl, safeUrl } from "@/lib/sanitize";
import { Clock, MapPin, ShieldCheck } from "@/lib/lucide-shim";
import { AppLink } from "@/components/atoms/AppLink";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import {
  collectProfileSpeakerIds,
  dayLabel,
  formatDayDate,
  formatTimeRange,
  parseScheduleDays,
  type ScheduleDay,
  type ScheduleSession,
  type ScheduleSpeakerRef,
} from "@/lib/events/schedule";
import { speakersByIdsQueryOptions, type PublicSpeakerRow } from "@/lib/builder/speakersQuery";
import { SpeakerChip } from "@/components/events/SpeakerChip";
import {
  SpeakerProfileDialog,
  type SpeakerDialogFallback,
} from "@/components/events/SpeakerProfileDialog";
import { getBool, getNum, getStr, type Lang } from "./frame";

interface ResolvedSpeaker {
  key: string;
  userId: string;
  name: string;
  role: string;
  photo: string | null;
  isExpert: boolean;
}

function locStr(c: WidgetContent, base: string, lang: Lang): string {
  return getStr(c, `${base}_${lang}`) || getStr(c, `${base}_pl`) || getStr(c, `${base}_en`);
}

function sessionText(session: ScheduleSession, base: "title" | "description", lang: Lang): string {
  const pl = base === "title" ? session.title_pl : session.description_pl;
  const en = base === "title" ? session.title_en : session.description_en;
  const primary = lang === "pl" ? pl : en;
  return primary || pl || en;
}

/** Laczenie recznych danych prelegenta z wierszem profilu (profil wygrywa). */
function resolveSessionSpeaker(
  ref: ScheduleSpeakerRef,
  profile: PublicSpeakerRow | undefined,
  lang: Lang,
): ResolvedSpeaker {
  const profileRole = profile
    ? (lang === "pl" ? profile.headline_pl : profile.headline_en) ||
      profile.headline_pl ||
      profile.headline_en ||
      profile.job_title ||
      ""
    : "";
  const manualRole = (lang === "pl" ? ref.role_pl : ref.role_en) || ref.role_pl || ref.role_en;
  return {
    key: ref.id,
    userId: ref.userId,
    name: profile?.display_name || ref.name,
    role: profileRole || manualRole,
    photo: profile?.avatar_url || safeImageUrl(ref.photo) || null,
    isExpert: profile?.is_expert === true,
  };
}

function SessionCard({
  session,
  lang,
  speakerById,
  openProfile,
  onOpenSpeaker,
}: {
  session: ScheduleSession;
  lang: Lang;
  speakerById: Map<string, PublicSpeakerRow>;
  openProfile: boolean;
  onOpenSpeaker: (userId: string, fallback: SpeakerDialogFallback) => void;
}) {
  const title = sessionText(session, "title", lang);
  const description = sessionText(session, "description", lang);
  const timeRange = formatTimeRange(session.timeStart, session.timeEnd);
  const href = session.href ? safeUrl(session.href, "") : "";
  const isBreak = session.kind === "break";
  const speakers = session.speakers.map((ref) =>
    resolveSessionSpeaker(ref, ref.userId ? speakerById.get(ref.userId) : undefined, lang),
  );

  const titleEl = href ? (
    <AppLink
      href={href}
      className="cms-post-title font-display text-base font-semibold leading-snug text-foreground"
    >
      {title}
    </AppLink>
  ) : (
    <span className="font-display text-base font-semibold leading-snug text-foreground">
      {title}
    </span>
  );

  return (
    <article
      className={
        "flex h-full flex-col gap-3 rounded-[6px] border p-4 transition-colors " +
        (isBreak
          ? "border-dashed border-border/70 bg-muted/25"
          : "border-border/60 bg-card hover:border-[color:var(--speakers-accent,var(--brand))]/40")
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {timeRange && (
          <span className="inline-flex items-center gap-1.5 rounded-[6px] bg-[color:var(--speakers-accent,var(--brand))]/10 px-2.5 py-1 text-xs font-semibold text-brand-ink">
            <Clock aria-hidden className="h-3.5 w-3.5" />
            {timeRange}
          </span>
        )}
        {session.room && (
          <span className="inline-flex items-center gap-1 rounded-[6px] bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
            <MapPin aria-hidden className="h-3 w-3" />
            {session.room}
          </span>
        )}
      </div>

      {title ? titleEl : null}
      {description ? (
        <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
      ) : null}

      {speakers.length > 0 && (
        <ul className="mt-auto flex flex-col gap-1">
          {speakers.map((speaker) => (
            <li key={speaker.key}>
              <SpeakerChip
                name={speaker.name}
                role={speaker.role}
                photoUrl={speaker.photo}
                size="md"
                onClick={
                  openProfile && speaker.userId
                    ? () =>
                        onOpenSpeaker(speaker.userId, {
                          name: speaker.name,
                          role: speaker.role,
                          photo: speaker.photo ?? undefined,
                        })
                    : undefined
                }
                trailing={
                  speaker.isExpert ? (
                    <ShieldCheck aria-hidden className="h-3.5 w-3.5 shrink-0 text-brand-ink" />
                  ) : undefined
                }
              />
            </li>
          ))}
        </ul>
      )}

      {isBreak && session.sponsors.length > 0 && (
        <div className="mt-auto space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {lang === "pl" ? "Sponsorzy:" : "Sponsors:"}
          </p>
          <ul className="flex flex-wrap items-center gap-3">
            {session.sponsors.map((sponsor) => {
              const logo = safeImageUrl(sponsor.logo);
              const url = sponsor.url ? safeUrl(sponsor.url, "") : "";
              const body = logo ? (
                <OptimizedImage
                  src={logo}
                  alt={sponsor.name}
                  className="h-6 w-auto max-w-[120px] object-contain opacity-70 transition-opacity hover:opacity-100"
                />
              ) : (
                <span className="text-sm font-semibold text-muted-foreground">{sponsor.name}</span>
              );
              return (
                <li key={sponsor.id}>
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label={sponsor.name}
                    >
                      {body}
                    </a>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </article>
  );
}

function DayTab({
  day,
  lang,
  active,
  onClick,
}: {
  day: ScheduleDay;
  lang: Lang;
  active: boolean;
  onClick: () => void;
}) {
  const date = formatDayDate(day.date, lang);
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        "rounded-[6px] px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--speakers-accent,var(--brand))]/50 " +
        (active
          ? "bg-[color:var(--speakers-accent,var(--brand))] text-[color:var(--brand-foreground,white)] shadow-sm"
          : "bg-muted text-muted-foreground hover:bg-muted/70")
      }
    >
      <span className="font-semibold">{dayLabel(day, lang)}</span>
      {date ? <span className="ml-1.5 text-xs opacity-80">{date}</span> : null}
    </button>
  );
}

export function EventScheduleView({ c, lang }: { c: WidgetContent; lang: Lang }) {
  const days = useMemo(() => parseScheduleDays(c), [c]);
  const profileIds = useMemo(() => collectProfileSpeakerIds(days), [days]);
  const showDayTabs = getBool(c, "showDayTabs", true) && days.length > 1;
  const openProfile = getBool(c, "openProfile", true);
  const columnsRaw = getNum(c, "columns", 2);
  const columns: 1 | 2 = columnsRaw <= 1 ? 1 : 2;
  const heading = locStr(c, "heading", lang);
  const intro = locStr(c, "intro", lang);
  const accent = getStr(c, "accentColor");

  const [activeDayId, setActiveDayId] = useState<string>("");
  const activeDay = days.find((d) => d.id === activeDayId) ?? (days.length > 0 ? days[0] : null);

  const speakersQ = useQuery({
    ...speakersByIdsQueryOptions(profileIds),
    enabled: profileIds.length > 0,
  });
  const speakerById = useMemo(() => {
    const map = new Map<string, PublicSpeakerRow>();
    for (const row of speakersQ.data ?? []) map.set(row.user_id, row);
    return map;
  }, [speakersQ.data]);

  const [dialogSpeaker, setDialogSpeaker] = useState<{
    userId: string;
    fallback: SpeakerDialogFallback;
  } | null>(null);

  const accentStyle: CSSProperties | undefined = accent
    ? { ["--speakers-accent" as string]: accent }
    : undefined;

  if (days.length === 0) {
    return (
      <section className="cms-event-schedule">
        <p className="rounded-[6px] border border-dashed border-border/70 p-10 text-center text-sm text-muted-foreground">
          {lang === "pl"
            ? "Dodaj dni i sesje agendy w panelu widgetu."
            : "Add schedule days and sessions in the widget panel."}
        </p>
      </section>
    );
  }

  const gridClass = columns === 1 ? "" : "md:grid-cols-2";

  return (
    <section className="cms-event-schedule space-y-6" style={accentStyle}>
      {(heading || intro) && (
        <header className="space-y-2">
          {heading ? <h2 className="cms-block-heading text-foreground">{heading}</h2> : null}
          {intro ? <p className="max-w-2xl text-sm text-muted-foreground">{intro}</p> : null}
        </header>
      )}

      {showDayTabs && (
        <div
          role="tablist"
          aria-label={lang === "pl" ? "Dni wydarzenia" : "Event days"}
          className="flex flex-wrap gap-2"
        >
          {days.map((day) => (
            <DayTab
              key={day.id}
              day={day}
              lang={lang}
              active={day.id === (activeDay?.id ?? "")}
              onClick={() => setActiveDayId(day.id)}
            />
          ))}
        </div>
      )}

      {/* Zakladki wylaczone przy 2+ dniach = wszystkie dni jeden pod drugim
          (kazdy z naglowkiem dnia) - zaden dzien nie moze byc nieosiagalny. */}
      {(showDayTabs || days.length <= 1 ? (activeDay ? [activeDay] : []) : days).map((day) => (
        <div key={day.id} className="space-y-3">
          {!showDayTabs && days.length > 1 && (
            <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {dayLabel(day, lang)}
              {formatDayDate(day.date, lang) ? (
                <span className="ml-2 font-normal normal-case tracking-normal">
                  {formatDayDate(day.date, lang)}
                </span>
              ) : null}
            </h3>
          )}
          <div
            className={`grid animate-in fade-in-0 duration-200 grid-cols-1 gap-4 sm:gap-5 ${gridClass}`}
          >
            {day.sessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                lang={lang}
                speakerById={speakerById}
                openProfile={openProfile}
                onOpenSpeaker={(userId, fallback) => setDialogSpeaker({ userId, fallback })}
              />
            ))}
            {day.sessions.length === 0 && (
              <p className="col-span-full rounded-[6px] border border-dashed border-border/70 p-8 text-center text-sm italic text-muted-foreground">
                {lang === "pl" ? "Brak sesji w tym dniu." : "No sessions on this day."}
              </p>
            )}
          </div>
        </div>
      ))}

      {dialogSpeaker && (
        <SpeakerProfileDialog
          userId={dialogSpeaker.userId}
          lang={lang}
          open
          onOpenChange={(open) => {
            if (!open) setDialogSpeaker(null);
          }}
          fallback={dialogSpeaker.fallback}
        />
      )}
    </section>
  );
}
