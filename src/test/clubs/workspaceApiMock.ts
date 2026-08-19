// Atrapy warstwy danych PRZESTRZENI ROBOCZEJ i SIECI klubu - dla testów hooków.
//
// Trzy osobne obiekty, bo `vi.mock` podmienia moduł w całości i mieszanie ich
// w jeden dałoby atrapę, która „ma" funkcje nieistniejące w podmienianym
// module - czyli test przechodzący obok literówki w imporcie.
//
// Listy są PEŁNE (wszystkie eksporty `async function` danego pliku): brak
// jednej pozycji to `undefined is not a function` w losowym teście zamiast
// czytelnego błędu.
import { vi } from "vitest";

export const workspaceApiMock = {
  deleteClubDocument: vi.fn(),
  deleteClubEvent: vi.fn(),
  deleteClubMilestone: vi.fn(),
  fetchClubActivitySeries: vi.fn(),
  fetchClubDocuments: vi.fn(),
  fetchClubEvents: vi.fn(),
  fetchClubMilestones: vi.fn(),
  fetchClubWorkspaceStats: vi.fn(),
  registerClubDocumentDownload: vi.fn(),
  setClubEventRsvp: vi.fn(),
  upsertClubDocument: vi.fn(),
  upsertClubEvent: vi.fn(),
  upsertClubMilestone: vi.fn(),
};

export const threadApiMock = {
  addClubThreadLink: vi.fn(),
  answerClubThreadQuestion: vi.fn(),
  askClubThreadQuestion: vi.fn(),
  createClubThreadPoll: vi.fn(),
  detachClubThreadPoll: vi.fn(),
  fetchClubThreadDocuments: vi.fn(),
  fetchClubThreadInsights: vi.fn(),
  fetchClubThreadLinks: vi.fn(),
  fetchClubThreadMilestones: vi.fn(),
  fetchClubThreadParticipants: vi.fn(),
  fetchClubThreadPolls: vi.fn(),
  fetchClubThreadQuestions: vi.fn(),
  fetchClubThreadWorkspace: vi.fn(),
  removeClubThreadDocument: vi.fn(),
  removeClubThreadLink: vi.fn(),
  removeClubThreadMilestone: vi.fn(),
  searchClubThread: vi.fn(),
  upsertClubThreadDocument: vi.fn(),
  upsertClubThreadMilestone: vi.fn(),
  voteClubThreadQuestion: vi.fn(),
};

export const networkApiMock = {
  closeClubBoardNotice: vi.fn(),
  createClubBoardNotice: vi.fn(),
  deleteClubSpotlight: vi.fn(),
  fetchClubBoardNotices: vi.fn(),
  fetchClubEvent: vi.fn(),
  fetchClubEventAttendees: vi.fn(),
  fetchClubExpertiseAreas: vi.fn(),
  fetchClubExperts: vi.fn(),
  fetchClubRosterSignal: vi.fn(),
  fetchClubSpotlight: vi.fn(),
  fetchClubSpotlightHistory: vi.fn(),
  fetchClubThreadExperts: vi.fn(),
  fetchMyClubExpertise: vi.fn(),
  pinClubSpotlight: vi.fn(),
  pingClubThreadExpert: vi.fn(),
  setMyClubExpertise: vi.fn(),
};

function resetAll(mock: Record<string, { mockReset: () => void }>): void {
  for (const fn of Object.values(mock)) fn.mockReset();
}

export function resetWorkspaceApiMock(): void {
  resetAll(workspaceApiMock);
}

export function resetThreadApiMock(): void {
  resetAll(threadApiMock);
}

export function resetNetworkApiMock(): void {
  resetAll(networkApiMock);
}
