// Discussion Club - hooki danych. MODUL ZGODNOSCI.
//
// Implementacja mieszka teraz w SZESCIU plikach domenowych, a ten zostaje
// jako jedno wejscie dla 29 konsumentow w `src/`. Podzial nastapil, bo plik
// urosl do 1 258 linii i 70 hookow - jeden import z tego modulu wciagal do
// grafu takze kolejke moderacji, katalog zaproszen i wyszukiwarke, niezaleznie
// od tego, czego widok naprawde potrzebowal.
//
// DLACZEGO RE-EKSPORT, A NIE PRZEPISANIE IMPORTOW. Ten sam wzorzec, ktory
// repo zastosowalo przy rozdzieleniu workspace klubu i watku: implementacja
// w osobnych plikach, historyczne importy kompatybilne przez re-eksporty,
// a bramka (`clubHooksModuleBoundary.test.ts`) pilnuje, ze re-eksport wskazuje
// TE SAMA funkcje, a nie druga kopie.
//
// CZEGO PODZIAL NIE ZMIENIL. Zachowania. Zestawy kluczy uniewaznianych po
// mutacjach przeniosly sie WCZESNIEJSZYM krokiem do `clubInvalidations.ts`
// jako czyste funkcje - to tam, a nie tutaj, zyje regula produktowa.

// odczyt produktowy: katalog, karta, dzialy, czlonkowie
export {
  useClubActivityFeed,
  useClubBySlug,
  useClubGroups,
  useClubList,
  useClubMembers,
  useMyClubMemberships,
} from "./useClubCatalog";

// panel administracyjny: odczyt i mutacje ustawien
export {
  useAdminClub,
  useAdminClubGroups,
  useAdminClubStats,
  useAdminClubs,
  useClubCapabilitiesPreview,
  useClubSegmentPreview,
  useClubSlugAvailable,
  useDeleteClubGroup,
  useInviteClubSegment,
  useModeratorEditReply,
  useModeratorEditThread,
  useRemoveClubMember,
  useReorderClubGroups,
  useSetClubMemberRole,
  useUpsertClub,
  useUpsertClubGroup,
  useUpsertClubMember,
} from "./useClubAdmin";
export type { InviteSegmentVars, SetClubRoleVars } from "./useClubAdmin";

// zaproszenia i samoobsluga czlonkostwa
export {
  useAcceptClubRules,
  useClubInvitations,
  useClubInviteLinks,
  useCreateClubInviteLink,
  useInviteClubMember,
  useInviteClubMemberByEmail,
  useJoinClub,
  useLeaveClub,
  useMyClubInvitations,
  useRedeemClubInviteLink,
  useRespondClubInvitation,
  useRevokeClubInviteLink,
  useSetClubNotifyLevel,
} from "./useClubInvites";
export type { InviteByEmailVars, InviteMemberVars } from "./useClubInvites";

// watki i odpowiedzi
export {
  useClubReplies,
  useClubThread,
  useClubThreads,
  useCreateClubThread,
  useEditClubReply,
  useEditClubThread,
  useReplyToThread,
  useResolveClubThread,
} from "./useClubThreadsData";
export type { CreateThreadVars, ReplyVars } from "./useClubThreadsData";

// reakcje, stanowiska, subskrypcje
export {
  useClubReactionActors,
  useClubReactions,
  useClubStanceSummary,
  useMyThreadSubscription,
  useSetClubStance,
  useSetThreadSubscription,
  useToggleClubReaction,
} from "./useClubReactions";
export type { ToggleReactionVars } from "./useClubReactions";

// moderacja, koordynacja w panelu, wyszukiwanie
export {
  useAdminClubReplies,
  useAdminClubThreads,
  useAdminCreateReply,
  useAdminCreateThread,
  useBanClubMember,
  useBulkModerateClub,
  useBulkSetClubMemberRole,
  useClubAnchorSuggestions,
  useClubModerationLog,
  useClubModerationQueue,
  useClubPendingCounts,
  useClubSearch,
  useClubThreadsForAnchor,
  useMarkClubRead,
  useModerateClubTarget,
  useMoveClubThread,
  useReportClubContent,
  useRevealClubAuthor,
} from "./useClubModeration";
export type { AdminThreadFilters, ModerateVars } from "./useClubModeration";
