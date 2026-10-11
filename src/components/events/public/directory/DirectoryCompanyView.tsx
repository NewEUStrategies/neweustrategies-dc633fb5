// Widok INSTYTUCJI w oknie profilu (lazy chunk - patrz `EventDirectoryContext`).
//
// CO WIEMY O INSTYTUCJI, ZALEŻY OD TEGO, KIM JEST NA WYDARZENIU. Partner niesie
// opis, kraj, stoisko i odnośnik ustawiony przez organizatora; firma prelegenta
// albo uczestnika - nazwę, logo i (od uczestnika) stronę. Okno pokazuje to, co
// jest, a zawsze listę osób z tej instytucji na wydarzeniu: to jest pytanie,
// z którym ktoś klika w nazwę firmy pod nazwiskiem.
//
// ODNOŚNIK PARTNERA TO DECYZJA ORGANIZATORA. Partner ma w kartotece swoją
// stronę, ale organizator wybiera, dokąd prowadzi jego logo (`linkMode` ->
// `href`, także „nigdzie"). Okno respektuje ten wybór, a klik liczy się
// w raporcie sponsora pod miejscem zakładki, z której otwarto okno - tym samym
// pomiarem, co kafel na liście partnerów.
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";

import { EventOrgLogo } from "@/components/events/public/atoms/EventOrgLogo";
import {
  directoryOrgPeople,
  directoryOrgSessions,
  type DirectoryOrg,
  type EventDirectory,
} from "@/lib/events/eventDirectory";
import type { SponsorPlacement } from "@/lib/events/sponsorExposure";
import { sponsorRoleKey } from "@/lib/events/sponsorsSurface";
import { useSponsorClickHandlers } from "@/lib/events/sponsorTrackingReact";
import { cn } from "@/lib/utils";

import {
  DirectoryFooterLink,
  DirectoryPeopleList,
  DirectoryProse,
  DirectorySection,
  DirectorySessionList,
  Overline,
  REVEAL_CLASS,
  revealStyle,
  websiteLabel,
} from "./directoryParts";

export function DirectoryCompanyView({
  orgKey,
  seed,
  directory,
  lang,
  slug,
  live,
  titleId,
  sponsorPlacement,
  onOpenPerson,
  onSessionSelect,
}: {
  orgKey: string;
  /** Nazwa i logo z karty, gdy katalog instytucji nie zna (autor wątku). */
  seed: { name?: string; logoUrl?: string | null };
  directory: EventDirectory;
  lang: "pl" | "en";
  slug: string | null;
  live: boolean;
  titleId: string;
  sponsorPlacement: SponsorPlacement | null;
  onOpenPerson: (key: string) => void;
  onSessionSelect?: (sessionId: string) => void;
}) {
  const { t } = useTranslation();
  const org: DirectoryOrg | null = directory.orgs.get(orgKey) ?? null;
  const name = org?.name ?? seed.name ?? "";
  const logoUrl = org?.logoUrl ?? seed.logoUrl ?? null;
  const sponsor = org?.sponsor ?? null;
  const people = directoryOrgPeople(directory, orgKey);
  const sessions = directoryOrgSessions(directory, orgKey);
  // Partner: tylko cel wybrany przez organizatora. Inna instytucja: strona
  // z profilu uczestnika (jedyne źródło adresu firmy poza kartoteką partnerów).
  const href = sponsor !== null ? sponsor.href : (org?.website ?? null);
  const clickHandlers = useSponsorClickHandlers(
    sponsor !== null && sponsorPlacement !== null
      ? { sponsorId: sponsor.id, placement: sponsorPlacement }
      : null,
  );

  const kicker = [
    sponsor === null ? t("eventFront.directory.kind.institution") : t(sponsorRoleKey(sponsor.role)),
    sponsor?.tierName ?? "",
  ].filter((part, index, all) => part !== "" && all.indexOf(part) === index);
  const meta = [
    org?.country ?? "",
    sponsor?.boothLabel ? t("eventFront.sponsors.boothLabel", { label: sponsor.boothLabel }) : "",
  ].filter((part) => part !== "");

  let section = 0;
  const next = () => (section += 1);
  const nothingMore =
    (org?.description ?? "") === "" && people.length === 0 && sessions.length === 0;

  return (
    <div className="space-y-6">
      <header
        className={cn("flex items-start gap-4 sm:gap-5", REVEAL_CLASS)}
        style={revealStyle(0)}
      >
        <EventOrgLogo name={name} logoUrl={logoUrl} size="lg" />
        <div className="min-w-0 flex-1 pt-0.5">
          <Overline className="flex items-center gap-2">
            {sponsor?.tierAccent ? (
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: sponsor.tierAccent }}
              />
            ) : null}
            <span className={sponsor === null ? undefined : "text-brand-ink"}>
              {kicker.join(" · ")}
            </span>
          </Overline>
          <DialogPrimitive.Title asChild>
            <h2
              id={titleId}
              tabIndex={-1}
              className="mt-1.5 font-display text-2xl font-semibold leading-tight tracking-tight text-foreground outline-none [overflow-wrap:anywhere] sm:text-3xl"
            >
              {name}
            </h2>
          </DialogPrimitive.Title>
          {href !== null || meta.length > 0 ? (
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {href !== null ? (
                <DirectoryFooterLink href={href} external live={live} {...clickHandlers}>
                  {websiteLabel(href)}
                </DirectoryFooterLink>
              ) : null}
              {meta.map((part) => (
                <span key={part}>{part}</span>
              ))}
            </p>
          ) : null}
        </div>
      </header>

      {(org?.description ?? "") !== "" ? (
        <DirectorySection title={t("eventFront.directory.aboutCompany")} index={next()}>
          <DirectoryProse text={org?.description ?? ""} />
        </DirectorySection>
      ) : null}

      {people.length > 0 ? (
        <DirectorySection
          title={t("eventFront.directory.people")}
          index={next()}
          aside={
            <span className="text-xs tabular-nums text-muted-foreground">
              {t("eventFront.directory.peopleCount", { count: people.length })}
            </span>
          }
        >
          <DirectoryPeopleList people={people} onOpen={onOpenPerson} />
        </DirectorySection>
      ) : null}

      {sessions.length > 0 ? (
        <DirectorySection title={t("eventFront.directory.supportedSessions")} index={next()}>
          <DirectorySessionList
            sessions={sessions}
            lang={lang}
            slug={slug}
            live={live}
            onSessionSelect={onSessionSelect}
          />
        </DirectorySection>
      ) : null}

      {nothingMore ? (
        <p
          className={cn(
            "border-t border-border/70 pt-5 text-sm text-muted-foreground",
            REVEAL_CLASS,
          )}
          style={revealStyle(next())}
        >
          {t("eventFront.directory.companyEmpty")}
        </p>
      ) : null}
    </div>
  );
}
