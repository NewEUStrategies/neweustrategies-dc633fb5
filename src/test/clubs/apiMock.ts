// Atrapa WARSTWY DANYCH klubów dla testów hooków.
//
// DLACZEGO OSOBNO OD `@/test/clubs/fixtures`. Tamten moduł podmienia KLIENTA
// Supabase i służy testom warstwy danych - tam pytanie brzmi „jakie RPC
// i z jakimi argumentami". Hooki zadają inne pytanie: „jaki klucz cache'u,
// jaka bramka `enabled`, co unieważnia mutacja". Przepuszczanie ich przez
// prawdziwą warstwę danych dołożyłoby drugi zestaw asercji o kontrakcie RPC,
// który ma już ~300 własnych testów - i wiązałoby test hooka z kształtem
// argumentów RPC, który hooka nie dotyczy.
//
// Lista funkcji jest PEŁNA (wszystkie eksporty `api.ts`), bo `vi.mock`
// zastępuje moduł w całości: brak jednej pozycji to `undefined is not
// a function` w losowym teście, a nie czytelny błąd.
import { vi } from "vitest";

export const clubApiMock = {
  acceptClubRules: vi.fn(),
  adminCreateClubReply: vi.fn(),
  adminCreateClubThread: vi.fn(),
  banClubMember: vi.fn(),
  bulkModerateClubTargets: vi.fn(),
  bulkSetClubMemberRole: vi.fn(),
  checkClubSlugAvailable: vi.fn(),
  createClubInviteLink: vi.fn(),
  createClubThread: vi.fn(),
  deleteClubGroup: vi.fn(),
  editClubReply: vi.fn(),
  editClubThread: vi.fn(),
  fetchAdminClub: vi.fn(),
  fetchAdminClubGroups: vi.fn(),
  fetchAdminClubReplies: vi.fn(),
  fetchAdminClubStats: vi.fn(),
  fetchAdminClubThreads: vi.fn(),
  fetchAdminClubs: vi.fn(),
  fetchClubActivityFeed: vi.fn(),
  fetchClubAnchorSuggestions: vi.fn(),
  fetchClubBySlug: vi.fn(),
  fetchClubGroups: vi.fn(),
  fetchClubInvitations: vi.fn(),
  fetchClubInviteLinks: vi.fn(),
  fetchClubList: vi.fn(),
  fetchClubMembers: vi.fn(),
  fetchClubModerationLog: vi.fn(),
  fetchClubModerationQueue: vi.fn(),
  fetchClubPendingCounts: vi.fn(),
  fetchClubReactionActors: vi.fn(),
  fetchClubReactions: vi.fn(),
  fetchClubReplies: vi.fn(),
  fetchClubStanceSummary: vi.fn(),
  fetchClubThread: vi.fn(),
  fetchClubThreads: vi.fn(),
  fetchClubThreadsForAnchor: vi.fn(),
  fetchMyClubInvitations: vi.fn(),
  fetchMyClubMemberships: vi.fn(),
  fetchMyThreadSubscription: vi.fn(),
  inviteClubMember: vi.fn(),
  inviteClubMemberByEmail: vi.fn(),
  inviteClubSegment: vi.fn(),
  joinClub: vi.fn(),
  leaveClub: vi.fn(),
  markClubRead: vi.fn(),
  moderateClubTarget: vi.fn(),
  moveClubThread: vi.fn(),
  previewClubCapabilities: vi.fn(),
  previewClubSegment: vi.fn(),
  reactToClubTarget: vi.fn(),
  redeemClubInviteLink: vi.fn(),
  removeClubMember: vi.fn(),
  reorderClubGroups: vi.fn(),
  replyToClubThread: vi.fn(),
  reportClubContent: vi.fn(),
  resolveClubThread: vi.fn(),
  respondClubInvitation: vi.fn(),
  revealClubAuthor: vi.fn(),
  revokeClubInviteLink: vi.fn(),
  searchClubThreads: vi.fn(),
  setClubMemberRole: vi.fn(),
  setClubNotifyLevel: vi.fn(),
  setClubStance: vi.fn(),
  setClubThreadSubscription: vi.fn(),
  unreactFromClubTarget: vi.fn(),
  upsertClub: vi.fn(),
  upsertClubGroup: vi.fn(),
  upsertClubMember: vi.fn(),
  /** Wektor frazy - `clubSemantic.functions`, mockowany razem z warstwą. */
  embedClubQuery: vi.fn(),
};

/** Zeruje wywołania I zaplanowane odpowiedzi między testami. */
export function resetClubApiMock(): void {
  for (const fn of Object.values(clubApiMock)) fn.mockReset();
  // Domyślna zwrotka wektora: brak warstwy semantycznej. Test, który jej
  // potrzebuje, nadpisuje ją jawnie - tak jak produkcja, gdzie bramka AI
  // bywa niedostępna.
  clubApiMock.embedClubQuery.mockResolvedValue(null);
}
