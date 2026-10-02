import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { brandedMediaUrl } from "@/lib/media/publicUrl";
import { fetchOwnProfileRow, type OwnProfileRow } from "@/lib/profile/ownProfile";

type Gender = "male" | "female" | "neutral";

export interface ProfileEditorRow {
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  current_company: string | null;
  current_company_id: string | null;
  specialization: string | null;
  location: string | null;
  phone: string | null;
  bio: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  tenant_id: string | null;
  gender: Gender | null;
  linkedin_url: string | null;
  twitter_url: string | null;
  /** Znacznik weryfikacji profilu (read-only dla właściciela). */
  verified_at: string | null;
}

/**
 * Pola, których właściciel NIE zapisuje: rola `authenticated` nie ma na nich
 * grantu UPDATE (20260905212431 / 20260915092000), więc `saveField` na nich
 * kończyłby się 42501. Zawężenie typu zamyka tę klasę błędu w czasie
 * kompilacji, zamiast zostawiać ją na toast z komunikatem PostgREST-a.
 */
export type ProfileEditorField = Exclude<keyof ProfileEditorRow, "tenant_id" | "verified_at">;

const EMPTY: ProfileEditorRow = {
  display_name: null,
  first_name: null,
  last_name: null,
  job_title: null,
  current_company: null,
  current_company_id: null,
  specialization: null,
  location: null,
  phone: null,
  bio: null,
  avatar_url: null,
  cover_url: null,
  tenant_id: null,
  gender: null,
  linkedin_url: null,
  twitter_url: null,
  verified_at: null,
};

type UploadKind = "avatar" | "cover";
type Status = "idle" | "uploading" | "success" | "failed";

const MAX_SIZE: Record<UploadKind, number> = {
  avatar: 2 * 1024 * 1024,
  cover: 5 * 1024 * 1024,
};

// `bio` here is the canonical localized bio (bio_pl); we read bio_pl and fall
// back to legacy single-language `bio`. The single-field inline editor edits
// the primary locale; the /profile/social editor manages full PL/EN. All
// user-bio editors thus converge on profiles.bio_pl (mirror trigger keeps the
// legacy `bio` column populated for older readers).
//
// Wiersz przychodzi z `get_own_profile()` (patrz `ownProfile.ts`), bo edytor
// potrzebuje kolumn prywatnych bez grantu SELECT (`phone`, `location`,
// `gender`, `current_company_id`). RPC oddaje CAŁY wiersz, łącznie z `email`
// i `prefs` - do cache trafia wyłącznie to, co edytor rysuje, żeby dane
// prywatne nie leżały w React Query dłużej i szerzej, niż muszą.
function toEditorRow(row: OwnProfileRow): ProfileEditorRow {
  return {
    display_name: row.display_name,
    first_name: row.first_name,
    last_name: row.last_name,
    job_title: row.job_title,
    current_company: row.current_company,
    current_company_id: row.current_company_id,
    specialization: row.specialization,
    location: row.location,
    phone: row.phone,
    // Canonical bio = bio_pl (fallback to legacy single-language `bio`).
    bio: row.bio_pl ?? row.bio ?? null,
    avatar_url: row.avatar_url,
    cover_url: row.cover_url,
    tenant_id: row.tenant_id,
    gender: row.gender,
    linkedin_url: row.linkedin_url,
    twitter_url: row.twitter_url,
    verified_at: row.verified_at,
  };
}

export const profileEditorKey = (uid: string | null | undefined) =>
  ["profile-editor", uid ?? undefined] as const;

/**
 * Inline profile editor: per-field optimistic save with toast feedback.
 *
 * Reads the identity from `useAuth()` context (single AuthProvider round-trip)
 * and caches the profile row in React Query under `profileEditorKey(uid)` with
 * staleTime 5 min / gcTime 30 min. Navigating away from and back to any editor
 * surface reuses the cached row instead of re-hitting the Data API. Mutations
 * update the cache via `setQueryData` (optimistic) and revert on error.
 *
 * TRZY ROZŁĄCZNE STANY ODCZYTU: `loading` (wiersz w drodze), `loadFailed`
 * (odczyt padł i NIE MA potwierdzonego wiersza) oraz dane - gdzie brak wiersza
 * w bazie daje pusty formularz, a nie awarię. Sklejenie awarii z pustym
 * profilem pokazywało człowiekowi z uzupełnionym kontem „Dodaj firmę",
 * „Dodaj telefon" - i zapraszało do zapisu, który nadpisywał dane.
 */
export function useProfileEditor() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const uid = user?.id;

  const query = useQuery({
    queryKey: profileEditorKey(uid),
    enabled: !!uid,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    queryFn: async (): Promise<ProfileEditorRow> => {
      // Błąd RPC leci dalej do React Query (stan `error`), brak wiersza to
      // pusty formularz - to są dwie różne odpowiedzi i tu się rozchodzą.
      const row = await fetchOwnProfileRow();
      return row ? toEditorRow(row) : EMPTY;
    },
  });

  const { refetch } = query;
  const data: ProfileEditorRow = query.data ?? EMPTY;
  const hasRow = query.data !== undefined;
  // Awaria liczy się tylko wtedy, gdy NIE MA potwierdzonego wiersza: nieudane
  // odświeżenie w tle zostawia ostatnie prawdziwe dane i nie ma powodu ich
  // chować. Ponowienie po awarii (`isFetching`) wraca do wskaźnika ładowania.
  const loadFailed = !!uid && !hasRow && query.isError && !query.isFetching;
  // `!hasRow` zamiast `isLoading`: zapytanie wstrzymane bez sieci (status
  // `pending`, `fetchStatus: "paused"`) ma `isLoading === false` i wcześniej
  // spadało na pusty formularz - teraz czeka na wskaźniku.
  const loading = !!uid && !hasRow && !loadFailed;

  const reload = useCallback(() => {
    void refetch();
  }, [refetch]);

  const [progress, setProgress] = useState<Record<UploadKind, number>>({ avatar: 0, cover: 0 });
  const [status, setStatus] = useState<Record<UploadKind, Status>>({
    avatar: "idle",
    cover: "idle",
  });

  const invalidateHeader = useCallback(() => {
    if (!uid) return;
    void qc.invalidateQueries({ queryKey: ["header-profile", uid] });
    void qc.invalidateQueries({ queryKey: ["greeting", uid] });
    // The profile sidebar (name + initials) reads its own query; without this it
    // kept showing the pre-edit name until a full reload.
    void qc.invalidateQueries({ queryKey: ["profile-sidebar", uid] });
  }, [qc, uid]);

  const saveField = useCallback(
    async <K extends ProfileEditorField>(field: K, value: ProfileEditorRow[K]) => {
      if (!uid) return;
      const key = profileEditorKey(uid);
      // Zapis WYMAGA potwierdzonego wiersza. Zapytanie istnieje, a danych brak
      // = odczyt w locie albo nieudany: formularz pokazywałby pustkę, więc
      // zapis pola „uzupełniałby" wartość, którą użytkownik już ma, a cofnięcie
      // optymistyczne nie miałoby do czego wrócić. Sprawdzamy stan w chwili
      // wywołania (nie domknięcie z renderu), bo awaria mogła przyjść później.
      const state = qc.getQueryState<ProfileEditorRow>(key);
      if (state && state.data === undefined) return;
      const prevRow = qc.getQueryData<ProfileEditorRow>(key) ?? EMPTY;
      const prev = prevRow[field];
      // optimistic
      qc.setQueryData<ProfileEditorRow>(key, { ...prevRow, [field]: value });
      // "bio" is canonical bio_pl on the wire, so a single-field edit writes the
      // same column the social/public surfaces read (no more divergent bios).
      const column = field === "bio" ? "bio_pl" : field;
      const patch = { [column]: value } as Record<string, ProfileEditorRow[K]>;
      const { error } = await supabase
        .from("profiles")
        .update(patch as never)
        .eq("id", uid);
      if (error) {
        qc.setQueryData<ProfileEditorRow>(key, { ...prevRow, [field]: prev });
        toast.error(error.message);
        return;
      }
      invalidateHeader();
    },
    [uid, qc, invalidateHeader],
  );

  const upload = useCallback(
    async (file: File, kind: UploadKind) => {
      if (!uid || !data.tenant_id) return;
      if (file.size > MAX_SIZE[kind]) {
        setStatus((s) => ({ ...s, [kind]: "failed" }));
        toast.error("File too large");
        return;
      }
      setStatus((s) => ({ ...s, [kind]: "uploading" }));
      setProgress((p) => ({ ...p, [kind]: 0 }));

      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${data.tenant_id}/users/${uid}/${kind}-${Date.now()}.${ext}`;

      try {
        const { data: signed, error: signErr } = await supabase.storage
          .from("media")
          .createSignedUploadUrl(path);
        if (signErr || !signed) throw signErr ?? new Error("sign failed");

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", signed.signedUrl);
          xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
          xhr.setRequestHeader("x-upsert", "true");
          xhr.upload.onprogress = (evt) => {
            if (evt.lengthComputable) {
              setProgress((p) => ({ ...p, [kind]: Math.round((evt.loaded / evt.total) * 100) }));
            }
          };
          xhr.onload = () =>
            xhr.status >= 200 && xhr.status < 300
              ? resolve()
              : reject(new Error(`HTTP ${xhr.status}`));
          xhr.onerror = () => reject(new Error("network"));
          xhr.send(file);
        });

        const { data: pub } = supabase.storage.from("media").getPublicUrl(path);
        const publicUrl = brandedMediaUrl(pub.publicUrl);
        const field: ProfileEditorField = kind === "avatar" ? "avatar_url" : "cover_url";
        await saveField(field, publicUrl);
        setStatus((s) => ({ ...s, [kind]: "success" }));
        setProgress((p) => ({ ...p, [kind]: 100 }));
      } catch (e) {
        setStatus((s) => ({ ...s, [kind]: "failed" }));
        toast.error(e instanceof Error ? e.message : "Upload failed");
      }
    },
    [uid, data.tenant_id, saveField],
  );

  return {
    data,
    loading,
    loadFailed,
    reload,
    saveField,
    upload,
    progress,
    status,
  };
}
