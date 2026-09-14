export interface ConsentSnapshotInput {
  key: string;
  text: string;
  given: boolean;
  lang: "pl" | "en";
}

/** Content revision, not proof of identity: the server records receipt separately. */
export async function snapshotConsents(entries: ConsentSnapshotInput[], timestamp: string) {
  return Promise.all(
    entries.map(async (entry) => {
      const bytes = new TextEncoder().encode(JSON.stringify([entry.key, entry.lang, entry.text]));
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      // 96-bit content revision fits the existing server's 32-character limit.
      const hex = Array.from(new Uint8Array(digest))
        .slice(0, 12)
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      return { ...entry, version: `sha256:${hex}`, timestamp };
    }),
  );
}
