// Powłoka strony klubu dla widoków SZCZEGÓŁOWYCH (np. wątku).
//
// Hub klubu (`ClubHub`) rysuje trzy kolumny: nawigację, strumień i kontekst.
// Wejście w wątek gubiło dwie z nich - użytkownik lądował na osobnej,
// pełnoekranowej stronie i tracił orientację w klubie. Ta powłoka oddaje te
// same dwie szyny, a w środku - zamiast kompozytora i strumienia - stawia
// treść przekazaną w `children`. Dzięki temu wątek otwiera się DOKŁADNIE
// w miejscu, w którym stała lista, a kontekst klubu zostaje na ekranie.
import { useMemo, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ClubHubIdentity } from "@/components/clubs/molecules/ClubHubIdentity";
import { ClubHubRail, ClubHubSectionBar } from "@/components/clubs/molecules/ClubHubRail";
import { ClubMeetingPanel } from "@/components/clubs/molecules/ClubMeetingPanel";
import { ClubBoardPanel } from "@/components/clubs/molecules/ClubBoardPanel";
import { ClubRosterPanel } from "@/components/clubs/molecules/ClubRosterPanel";
import { ClubSpotlightPanel } from "@/components/clubs/molecules/ClubSpotlightPanel";
import { ClubFreshDocsPanel, ClubStagePanel } from "@/components/clubs/molecules/ClubHubContext";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import type { BreadcrumbItem } from "@/lib/breadcrumbs";
import { useAuth } from "@/hooks/useAuth";
import { useClubGroups } from "@/lib/clubs/useClubs";
import { useClubDocuments, useClubEvents, useClubMilestones } from "@/lib/clubs/useClubWorkspace";
import type { ClubViewRow } from "@/lib/clubs/types";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { uiLang, uiLocale } from "@/lib/i18n/format";

/** Dzisiaj jako `YYYY-MM-DD` w czasie LOKALNYM - `due_on` jest datą bez strefy. */
function localToday(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function ClubPageFrame({
  club,
  /** Ostatni okruszek - np. tytuł wątku. */
  trailingCrumb,
  children,
}: {
  club: ClubViewRow;
  trailingCrumb?: string;
  children: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const locale = uiLocale(i18n.language);
  const navigate = useNavigate();
  const { session } = useAuth();
  const signedIn = session !== null;
  const clubSlug = club.slug;
  const clubName = pickLocalized(club, "name", lang);

  const groupsQ = useClubGroups(club.id);
  const documentsQ = useClubDocuments({ clubId: club.id, groupId: null, limit: 6 });
  const eventsQ = useClubEvents({ clubId: club.id, from: new Date().toISOString(), limit: 12 });
  const milestonesQ = useClubMilestones(club.id);

  const groups = useMemo(() => groupsQ.data ?? [], [groupsQ.data]);
  const documents = useMemo(() => documentsQ.data?.rows ?? [], [documentsQ.data]);
  const events = useMemo(() => eventsQ.data ?? [], [eventsQ.data]);
  const milestones = useMemo(() => milestonesQ.data ?? [], [milestonesQ.data]);

  const context = (
    <>
      <ClubMeetingPanel
        clubSlug={clubSlug}
        clubId={club.id}
        events={events}
        canSeeMembers={signedIn && club.can_see_members}
        canRsvp={signedIn && club.can_reply}
        canManage={signedIn && club.can_manage}
      />
      <ClubBoardPanel clubSlug={clubSlug} clubId={club.id} canPost={signedIn && club.can_reply} />
      <ClubRosterPanel
        clubSlug={clubSlug}
        clubId={club.id}
        canSeeMembers={club.can_see_members}
        canDeclare={signedIn && club.can_reply}
        locale={locale}
      />
      <ClubSpotlightPanel clubSlug={clubSlug} clubId={club.id} />
      <ClubStagePanel clubSlug={clubSlug} milestones={milestones} today={localToday()} />
      <ClubFreshDocsPanel clubSlug={clubSlug} documents={documents} />
    </>
  );

  const breadcrumbItems: BreadcrumbItem[] = [
    { label: t("club.title"), href: "/club" },
    ...(trailingCrumb !== undefined && trailingCrumb !== ""
      ? [
          { label: clubName, href: `/club/${clubSlug}` },
          { label: trailingCrumb },
        ]
      : [{ label: clubName }]),
  ];

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 py-5 sm:px-5 lg:px-8">
      <Breadcrumbs items={breadcrumbItems} className="mb-3" />
      <ClubHubIdentity club={club} locale={locale} className="mb-4" />

      <div className="grid items-start gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_20rem]">
        <aside className="hidden lg:sticky lg:top-20 lg:block lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1 [scrollbar-width:thin]">
          <ClubHubRail
            clubSlug={clubSlug}
            canSeeMembers={club.can_see_members}
            groups={groups}
            policyArea={club.policy_area}
            activeGroupId={null}
            // Dział wybrany z poziomu wątku wraca do strumienia klubu - to
            // tam ten filtr ma co odsiać.
            onGroupChange={() => {
              void navigate({ to: "/club/$clubSlug", params: { clubSlug }, search: {} });
            }}
            counts={{
              threads: club.thread_count,
              documents: documentsQ.data?.total,
              calendar: events.length,
              schedule: milestones.length,
              members: club.member_count,
            }}
            hasRules={pickLocalized(club, "rules", lang) !== ""}
          />
        </aside>

        <main className="min-w-0">
          <ClubHubSectionBar
            clubSlug={clubSlug}
            canSeeMembers={club.can_see_members}
            className="mb-3 lg:hidden"
          />
          {children}
          {/* Kontekst na telefonie i tablecie: POD treścią. */}
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:hidden">{context}</div>
        </main>

        <aside className="hidden xl:sticky xl:top-20 xl:block xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto xl:overscroll-contain xl:pl-1 [scrollbar-width:thin]">
          <div className="flex flex-col gap-3">{context}</div>
        </aside>
      </div>
    </div>
  );
}
