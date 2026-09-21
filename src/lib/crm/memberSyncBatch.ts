import type { MemberCrmSnapshot } from "./memberSync.server";

export interface MemberSyncBatchResult {
  people: number;
  companies: number;
  skipped: number;
  errors: number;
  nextCursor: string | null;
  done: boolean;
}

/** Acknowledge only completed profiles. A failed profile is the first item on
 * resume, including when the previous HTTP response was lost after commit. */
export async function runMemberSyncBatch(input: {
  cursor: string | null;
  limit: number;
  readPage: (
    cursor: string | null,
    limit: number,
  ) => Promise<readonly { id: string; email: string | null }[]>;
  sync: (userId: string) => Promise<MemberCrmSnapshot | null>;
}): Promise<MemberSyncBatchResult> {
  const rows = await input.readPage(input.cursor, input.limit + 1);
  const result: MemberSyncBatchResult = {
    people: 0,
    companies: 0,
    skipped: 0,
    errors: 0,
    nextCursor: input.cursor,
    done: false,
  };
  for (const row of rows.slice(0, input.limit)) {
    if (!row.email?.trim()) {
      result.skipped += 1;
    } else {
      const snapshot = await input.sync(row.id);
      if (!snapshot?.leadId) {
        result.errors += 1;
        return result;
      }
      result.people += 1;
      if (snapshot.companyCreated) result.companies += 1;
    }
    result.nextCursor = row.id;
  }
  result.done = rows.length <= input.limit;
  return result;
}
