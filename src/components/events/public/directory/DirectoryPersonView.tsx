// Widok OSOBY w oknie profilu (lazy chunk - patrz `EventDirectoryContext`).
//
// FAKTY Z KATALOGU, WZBOGACENIE PO KLIKNIĘCIU. Nagłówek, biogram i sesje
// stoją od pierwszej klatki, bo katalog złożyła zakładka z danych, które już
// ma. Dociągane są tylko rzeczy, których żadna lista nie niesie: materiały
// prelegenta z tego wydarzenia, jego inne wystąpienia i - dla autora wątku -
// stanowisko i firma z profilu członka. Szkielet nie zasłania więc nigdy
// danych, które są w pamięci.
//
// INSTYTUCJA JEST PRZYCISKIEM. Klik w nazwę firmy pod nazwiskiem przechodzi
// do okna instytucji (stos z „Wstecz"), więc czytelnik idzie od osoby do
// firmy i z powrotem bez zamykania okna.
import { useQuery } from "@tanstack/react-query";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";

import { SpeakerExpertBadge } from "@/components/events/SpeakerExpertBadge";
import { SpeakerMaterialsList } from "@/components/events/SpeakerMaterialsList";
import { EventSocialLinks } from "@/components/events/participant/atoms/EventSocialLinks";
import { EventGroupTags } from "@/components/events/participant/atoms/EventGroupTags";
import { EventPersonActions } from "@/components/events/participant/molecules/EventPersonActions";
import { IntentBulletList } from "@/components/events/participant/molecules/IntentBulletList";
import { EventOrgLogo } from "@/components/events/public/atoms/EventOrgLogo";
import { useAuth } from "@/hooks/useAuth";
import { speakerEngagementsQueryOptions } from "@/lib/builder/speakersQuery";
import {
  directoryOrgKey,
  type DirectoryPerson,
  type EventDirectory,
} from "@/lib/events/eventDirectory";
import type { SocialKey } from "@/lib/events/myEventProfileApi";
import { formatEventDate } from "@/lib/events/timezone";
import { memberProfileQueryOptions } from "@/lib/profile/memberProfile";
import { cn } from "@/lib/utils";

import {
  DirectoryFooterLink,
  DirectoryPortrait,
  NorthEastHairline,
  DirectoryProse,
  DirectorySection,
  DirectorySessionList,
  Overline,
  REVEAL_CLASS,
  revealStyle,
} from "./directoryParts";

export function DirectoryPersonView({
  person,
  directory,
  lang,
  slug,
  eventId,
  live,
  titleId,
  onOpenCompany,
  onSessionSelect,
}: {
  person: DirectoryPerson;
  directory: EventDirectory;
  lang: "pl" | "en";
  slug: string | null;
  eventId: string | null;
  live: boolean;
  titleId: string;
  onOpenCompany: (key: string, seed: { name: string; logoUrl: string | null }) => void;
  onSessionSelect?: (sessionId: string) => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const speakerUserId = person.speakerRow?.user_id ?? "";

  // Autor wątku przychodzi z listy dyskusji z samym nazwiskiem i zdjęciem -
  // stanowisko i firmę zna tylko profil członka. Pytamy o niego wyłącznie
  // wtedy, gdy katalog tych faktów nie ma (uczestnik i prelegent je niosą).
  const needsMember =
    live && person.memberSlug !== null && (person.position === "" || person.orgKey === null);
  const memberQuery = useQuery({
    ...memberProfileQueryOptions(person.memberSlug ?? "", user?.id ?? null),
    enabled: needsMember && user !== null,
  });
  const member = needsMember ? (memberQuery.data ?? null) : null;

  const engagementsQuery = useQuery({
    ...speakerEngagementsQueryOptions(speakerUserId),
    enabled: live && speakerUserId !== "",
  });
  const otherEngagements = (engagementsQuery.data ?? [])
    .filter((item) => slug === null || item.slug !== slug)
    .slice(0, 3);

  const position = person.position || member?.job_title?.trim() || "";
  const memberCompany = member?.company?.trim() ?? "";
  const orgKey = person.orgKey ?? directoryOrgKey(memberCompany);
  const org = orgKey === null ? null : (directory.orgs.get(orgKey) ?? null);
  const orgName = org?.name ?? (person.orgName || memberCompany);
  const orgLogo = org?.logoUrl ?? person.orgLogoUrl;
  const bio =
    person.bio ||
    (member === null
      ? ""
      : (
          (lang === "en" ? member.bio_en : member.bio_pl) ??
          member.bio_pl ??
          member.bio_en ??
          ""
        ).trim());
  // Każdy adres tylko jako http(s) - wpisy uczestnika i profilu członka są
  // tekstem z formularza (patrz `httpUrl`).
  const socials = Object.fromEntries(
    Object.entries(
      Object.keys(person.socials).length > 0
        ? person.socials
        : { linkedin: member?.linkedin_url, website: member?.website_url },
    ).map(([key, href]) => [key, httpUrl(href)]),
  ) as Partial<Record<SocialKey, string>>;

  const attendee = person.attendee;
  const seeking =
    attendee === null
      ? null
      : ((lang === "en" ? attendee.seekingEn : attendee.seekingPl) ?? attendee.seekingPl);
  const offering =
    attendee === null
      ? null
      : ((lang === "en" ? attendee.offeringEn : attendee.offeringPl) ?? attendee.offeringPl);
  const row = person.speakerRow;
  const stats =
    row === null
      ? []
      : [
          row.talks_count > 0
            ? t("eventFront.directory.stats.talks", { count: row.talks_count })
            : "",
          row.rating > 0
            ? t("eventFront.directory.stats.rating", {
                value: row.rating.toLocaleString(lang === "en" ? "en-GB" : "pl-PL", {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                }),
              })
            : "",
          row.reviews_count > 0
            ? t("eventFront.directory.stats.reviews", { count: row.reviews_count })
            : "",
        ].filter((part) => part !== "");

  const kinds = [
    person.isSpeaker ? t("eventFront.directory.kind.speaker") : "",
    !person.isSpeaker && attendee !== null ? t("eventFront.directory.kind.participant") : "",
    !person.isSpeaker && attendee === null && person.memberSlug !== null
      ? t("eventFront.directory.kind.author")
      : "",
  ].filter((part) => part !== "");

  let section = 0;
  const next = () => (section += 1);
  const hasSocials = Object.values(socials).some((value) => (value ?? "").trim() !== "");
  const hasAttendeeFacts =
    attendee !== null &&
    (attendee.groups.length > 0 || attendee.industry !== null || attendee.specialization !== null);

  return (
    <div className="space-y-6">
      <header
        className={cn("flex items-start gap-4 sm:gap-5", REVEAL_CLASS)}
        style={revealStyle(0)}
      >
        <DirectoryPortrait name={person.name} photoUrl={person.avatarUrl} />
        <div className="min-w-0 flex-1 pt-0.5">
          {kinds.length > 0 || person.isExpert ? (
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              {kinds.length > 0 ? (
                <Overline className="text-brand-ink">{kinds.join(" · ")}</Overline>
              ) : null}
              {person.isExpert ? <SpeakerExpertBadge withLabel lang={lang} /> : null}
            </div>
          ) : null}
          <DialogPrimitive.Title asChild>
            <h2
              id={titleId}
              tabIndex={-1}
              className="mt-1.5 font-display text-2xl font-semibold leading-tight tracking-tight text-foreground outline-none [overflow-wrap:anywhere] sm:text-3xl"
            >
              {person.name}
            </h2>
          </DialogPrimitive.Title>
          {position !== "" ? (
            <p className="mt-1.5 text-[15px] leading-6 text-foreground/75 [overflow-wrap:anywhere]">
              {position}
            </p>
          ) : null}
          {orgName !== "" ? (
            orgKey === null ? (
              <p className="mt-2.5 flex items-center gap-2 text-sm text-foreground/80">
                <EventOrgLogo name={orgName} logoUrl={orgLogo} size="xs" />
                {orgName}
              </p>
            ) : (
              <button
                type="button"
                onClick={() => onOpenCompany(orgKey, { name: orgName, logoUrl: orgLogo })}
                aria-label={t("eventFront.directory.openCompany", { name: orgName })}
                className="group mt-2.5 inline-flex max-w-full items-center gap-2 rounded-[6px] text-left text-sm text-foreground/85 underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <EventOrgLogo name={orgName} logoUrl={orgLogo} size="xs" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{orgName}</span>
                <NorthEastHairline className="text-muted-foreground transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transition-none" />
              </button>
            )
          ) : null}
          {stats.length > 0 ? (
            <p className="mt-3 text-xs tabular-nums text-muted-foreground">{stats.join("  ·  ")}</p>
          ) : null}
        </div>
      </header>

      {bio !== "" ? (
        <DirectorySection title={t("eventFront.directory.about")} index={next()}>
          <DirectoryProse text={bio} />
        </DirectorySection>
      ) : null}

      {person.topics.length > 0 || person.languages.length > 0 ? (
        <DirectorySection title={t("eventFront.directory.topics")} index={next()}>
          {person.topics.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {person.topics.map((topic) => (
                <li
                  key={topic}
                  className="rounded-[6px] border border-border px-2.5 py-1 text-xs text-foreground/80"
                >
                  {topic}
                </li>
              ))}
            </ul>
          ) : null}
          {person.languages.length > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {t("eventFront.directory.languages")}:{" "}
              <span className="tracking-wide text-foreground/80">
                {person.languages.map((code) => code.toUpperCase()).join(" · ")}
              </span>
            </p>
          ) : null}
        </DirectorySection>
      ) : null}

      {person.sessions.length > 0 ? (
        <DirectorySection
          title={t("eventFront.directory.atThisEvent")}
          index={next()}
          aside={
            <span className="text-xs tabular-nums text-muted-foreground">
              {t("eventFront.directory.sessionsCount", { count: person.sessions.length })}
            </span>
          }
        >
          <DirectorySessionList
            sessions={person.sessions}
            lang={lang}
            slug={slug}
            live={live}
            onSessionSelect={onSessionSelect}
          />
        </DirectorySection>
      ) : null}

      {live && eventId !== null && row?.speaker_profile_id ? (
        <div
          className={cn("border-t border-border/70 pt-5 empty:hidden", REVEAL_CLASS)}
          style={revealStyle(next())}
        >
          <SpeakerMaterialsList
            eventId={eventId}
            speakerProfileId={row.speaker_profile_id}
            lang={lang}
          />
        </div>
      ) : null}

      {seeking !== null || offering !== null ? (
        <DirectorySection title={t("eventFront.directory.networking")} index={next()}>
          <dl className="grid gap-4 sm:grid-cols-2">
            {seeking !== null ? (
              <div>
                <dt className="text-xs font-semibold text-foreground">
                  {t("eventMe.fields.seeking")}
                </dt>
                <dd className="mt-1.5 text-sm text-foreground/80">
                  <IntentBulletList text={seeking} />
                </dd>
              </div>
            ) : null}
            {offering !== null ? (
              <div>
                <dt className="text-xs font-semibold text-foreground">
                  {t("eventMe.fields.offering")}
                </dt>
                <dd className="mt-1.5 text-sm text-foreground/80">
                  <IntentBulletList text={offering} />
                </dd>
              </div>
            ) : null}
          </dl>
        </DirectorySection>
      ) : null}

      {hasAttendeeFacts && attendee !== null ? (
        <DirectorySection title={t("eventFront.directory.groups")} index={next()}>
          <EventGroupTags groups={attendee.groups} lang={lang} />
          {attendee.industry !== null || attendee.specialization !== null ? (
            <p className="mt-2.5 text-sm text-foreground/80">
              {[attendee.industry, attendee.specialization].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </DirectorySection>
      ) : null}

      {hasSocials && live ? (
        <DirectorySection title={t("eventFront.directory.online")} index={next()}>
          <EventSocialLinks links={socials} size={32} />
        </DirectorySection>
      ) : null}

      {otherEngagements.length > 0 ? (
        <DirectorySection title={t("eventFront.directory.otherEngagements")} index={next()}>
          <ul className="divide-y divide-border/60">
            {otherEngagements.map((item) => (
              <li key={item.id} className="flex items-baseline justify-between gap-4 py-2.5">
                <DirectoryFooterLink href={`/events/${item.slug}`} external={false} live={live}>
                  {(lang === "en"
                    ? item.title_en || item.title_pl
                    : item.title_pl || item.title_en) ?? ""}
                </DirectoryFooterLink>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatEventDate(item.starts_at, null, lang)}
                </span>
              </li>
            ))}
          </ul>
        </DirectorySection>
      ) : null}

      {person.profileHref !== null || (live && attendee !== null) ? (
        <footer
          className={cn(
            "flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-border/70 pt-5",
            REVEAL_CLASS,
          )}
          style={revealStyle(next())}
        >
          {person.profileHref !== null ? (
            <DirectoryFooterLink href={person.profileHref} external={false} live={live}>
              {t("eventFront.directory.fullProfile")}
            </DirectoryFooterLink>
          ) : (
            <span />
          )}
          {live && attendee !== null ? (
            <EventPersonActions
              slug={null}
              userId={attendee.userId}
              registrationId={attendee.registrationId}
              displayName={attendee.name}
              displayAvatar={attendee.avatarUrl}
            />
          ) : null}
        </footer>
      ) : null}
    </div>
  );
}

/**
 * Adres z profilu członka tylko jako http(s) - ta sama reguła, co strona
 * profilu (`MemberProfileView`): pola są edytowane ręcznie i importowane bez
 * walidacji, a wpis bez schematu („linkedin.com/in/x") byłby odnośnikiem
 * względnym pod `/events/<slug>/…`, otwieranym w nowej karcie jako błąd.
 */
function httpUrl(url: string | null | undefined): string | undefined {
  if (url === null || url === undefined) return undefined;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
