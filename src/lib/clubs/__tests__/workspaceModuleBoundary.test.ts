import { describe, expect, it } from "vitest";
import {
  groupSearchResults,
  panelBadge,
  toInsightSeries,
  toWorkspaceSummary,
} from "@/lib/clubs/workspaceTypes";
import {
  groupSearchResults as groupThreadSearchResults,
  panelBadge as threadPanelBadge,
  toInsightSeries as toThreadInsightSeries,
  toWorkspaceSummary as toThreadWorkspaceSummary,
} from "@/lib/clubs/threadWorkspaceTypes";
import { fetchClubThreadDocuments, fetchClubThreadWorkspace } from "@/lib/clubs/workspaceApi";
import {
  fetchClubThreadDocuments as fetchThreadDocuments,
  fetchClubThreadWorkspace as fetchThreadWorkspace,
} from "@/lib/clubs/threadWorkspaceApi";
import { useClubThreadDocuments, useClubThreadWorkspace } from "@/lib/clubs/useClubWorkspace";
import {
  useClubThreadDocuments as useThreadDocuments,
  useClubThreadWorkspace as useThreadWorkspace,
} from "@/lib/clubs/useThreadWorkspace";
import type { ClubDocumentInput, ClubMilestoneInput } from "@/lib/clubs/workspaceApi";
import type {
  ClubThreadDocumentRow,
  ClubThreadMilestoneRow,
  ClubWorkspaceSummary,
} from "@/lib/clubs/workspaceTypes";

/**
 * PR #206 (workspace klubu) i PR #207 (workspace watku) pierwotnie zmienialy
 * te same trzy moduly. Ta bramka pilnuje architektury po scaleniu:
 * implementacja watku zyje w osobnych plikach, a historyczne importy z warstwy
 * klubu pozostaja kompatybilne przez re-eksporty.
 *
 * Importy typow sa celowe - ich znikniecie zatrzymuje typecheck zanim 23 widoki
 * workspace ponownie trafia na produkcje z czerwonym buildem.
 */
describe("club and thread workspace module boundary", () => {
  it("re-exports thread domain helpers from the club compatibility module", () => {
    expect(groupSearchResults).toBe(groupThreadSearchResults);
    expect(panelBadge).toBe(threadPanelBadge);
    expect(toInsightSeries).toBe(toThreadInsightSeries);
    expect(toWorkspaceSummary).toBe(toThreadWorkspaceSummary);
  });

  it("re-exports thread RPC clients without duplicating their implementation", () => {
    expect(fetchClubThreadDocuments).toBe(fetchThreadDocuments);
    expect(fetchClubThreadWorkspace).toBe(fetchThreadWorkspace);
  });

  it("re-exports thread hooks without merging both hook implementations", () => {
    expect(useClubThreadDocuments).toBe(useThreadDocuments);
    expect(useClubThreadWorkspace).toBe(useThreadWorkspace);
  });

  it("keeps the component-facing type contract available", () => {
    const documentInput: ClubDocumentInput = {
      thread_id: "thread-1",
      kind: "document",
      title: "Source",
      url: null,
      description: null,
      source_label: null,
      published_on: null,
    };
    const milestoneInput: ClubMilestoneInput = {
      thread_id: "thread-1",
      kind: "milestone",
      status: "planned",
      title: "Deadline",
      description: null,
      starts_at: "2026-08-08T20:00:00.000Z",
      ends_at: null,
      all_day: false,
      location: null,
      url: null,
    };
    const rows: Array<ClubThreadDocumentRow | ClubThreadMilestoneRow> = [];
    const summary: ClubWorkspaceSummary = toWorkspaceSummary(null);

    expect(documentInput.thread_id).toBe("thread-1");
    expect(milestoneInput.status).toBe("planned");
    expect(rows).toEqual([]);
    expect(summary.threadId).toBeNull();
  });
});
