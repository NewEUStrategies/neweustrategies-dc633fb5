import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export type Gender = "male" | "female" | "neutral";

export interface ProfileEditorRow {
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  current_company: string | null;
  location: string | null;
  phone: string | null;
  bio: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  tenant_id: string | null;
  gender: Gender | null;
}

const EMPTY: ProfileEditorRow = {
  display_name: null,
  first_name: null,
  last_name: null,
  job_title: null,
  current_company: null,
  location: null,
  phone: null,
  bio: null,
  avatar_url: null,
  cover_url: null,
  tenant_id: null,
  gender: null,
};

type UploadKind = "avatar" | "cover";
type Status = "idle" | "uploading" | "success" | "failed";

const MAX_SIZE: Record<UploadKind, number> = {
  avatar: 2 * 1024 * 1024,
  cover: 5 * 1024 * 1024,
};

const FIELDS = "display_name, first_name, last_name, job_title, current_company, location, phone, bio, avatar_url, cover_url, tenant_id, gender";

/**
 * Inline profile editor: per-field optimistic save with toast feedback.
 * Mirrors the public profile shape so the same UI is both viewer and editor.
 */
export function useProfileEditor() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [data, setData] = useState<ProfileEditorRow>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<Record<UploadKind, number>>({ avatar: 0, cover: 0 });
  const [status, setStatus] = useState<Record<UploadKind, Status>>({ avatar: "idle", cover: "idle" });

  const refresh = useCallback(async (uid: string) => {
    const { data: row } = await supabase
      .from("profiles")
      .select(FIELDS)
      .eq("id", uid)
      .maybeSingle();
    if (row) setData(row as ProfileEditorRow);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!user) return;
    void refresh(user.id);
  }, [user, refresh]);

  const invalidateHeader = useCallback(() => {
    if (!user) return;
    void qc.invalidateQueries({ queryKey: ["header-profile", user.id] });
    void qc.invalidateQueries({ queryKey: ["greeting", user.id] });
  }, [qc, user]);

  const saveField = useCallback(
    async <K extends keyof ProfileEditorRow>(field: K, value: ProfileEditorRow[K]) => {
      if (!user) return;
      const prev = data[field];
      // optimistic
      setData((d) => ({ ...d, [field]: value }));
      const { error } = await supabase
        .from("profiles")
        .update({ [field]: value })
        .eq("id", user.id);
      if (error) {
        setData((d) => ({ ...d, [field]: prev }));
        toast.error(error.message);
        return;
      }
      invalidateHeader();
    },
    [user, data, invalidateHeader],
  );

  const upload = useCallback(
    async (file: File, kind: UploadKind) => {
      if (!user || !data.tenant_id) return;
      if (file.size > MAX_SIZE[kind]) {
        setStatus((s) => ({ ...s, [kind]: "failed" }));
        toast.error("File too large");
        return;
      }
      setStatus((s) => ({ ...s, [kind]: "uploading" }));
      setProgress((p) => ({ ...p, [kind]: 0 }));

      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${data.tenant_id}/users/${user.id}/${kind}-${Date.now()}.${ext}`;

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
          xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`)));
          xhr.onerror = () => reject(new Error("network"));
          xhr.send(file);
        });

        const { data: pub } = supabase.storage.from("media").getPublicUrl(path);
        const publicUrl = pub.publicUrl;
        const field: keyof ProfileEditorRow = kind === "avatar" ? "avatar_url" : "cover_url";
        await saveField(field, publicUrl);
        setStatus((s) => ({ ...s, [kind]: "success" }));
        setProgress((p) => ({ ...p, [kind]: 100 }));
      } catch (e) {
        setStatus((s) => ({ ...s, [kind]: "failed" }));
        toast.error(e instanceof Error ? e.message : "Upload failed");
      }
    },
    [user, data.tenant_id, saveField],
  );

  return {
    data,
    loading,
    saveField,
    upload,
    progress,
    status,
  };
}
