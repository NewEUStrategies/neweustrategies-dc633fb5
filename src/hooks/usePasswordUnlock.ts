import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { BodyParts } from "@/lib/access/gating";

type EntityType = "post" | "page";

/**
 * Client-side password unlock for content_access rules whose mode is
 * `password`. The plaintext is verified server-side by the SECURITY DEFINER
 * `verify_content_password` RPC, which returns the gated body only when the
 * password matches the bcrypt hash stored in `content_access.password_hash`.
 *
 * The verified password is cached in `sessionStorage` (per entity) so a page
 * refresh silently re-unlocks the same tab without asking again. It never
 * touches `localStorage`, so closing the tab wipes the cached password.
 */
export function usePasswordUnlock(
  entityType: EntityType,
  entityId: string | null,
  enabled: boolean,
) {
  const storageKey = entityId ? `content-pwd:${entityType}:${entityId}` : null;
  const [body, setBody] = useState<BodyParts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const verify = useCallback(
    async (password: string): Promise<boolean> => {
      if (!entityId) return false;
      setLoading(true);
      setError(null);
      const { data, error: rpcErr } = await supabase.rpc("verify_content_password", {
        _entity_type: entityType,
        _entity_id: entityId,
        _password: password,
      });
      setLoading(false);
      const row = Array.isArray(data) ? data[0] : null;
      if (rpcErr || !row || !row.ok) {
        setError("invalid");
        return false;
      }
      setBody({
        content_pl: row.content_pl ?? null,
        content_en: row.content_en ?? null,
        builder_data: row.builder_data ?? null,
        blocks_data: row.blocks_data ?? null,
      });
      if (storageKey && typeof window !== "undefined") {
        try {
          window.sessionStorage.setItem(storageKey, password);
        } catch {
          /* quota / privacy mode - ignore */
        }
      }
      return true;
    },
    [entityType, entityId, storageKey],
  );

  const clear = useCallback(() => {
    setBody(null);
    if (storageKey && typeof window !== "undefined") {
      try {
        window.sessionStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
    }
  }, [storageKey]);

  // Silent re-unlock on mount when a valid password sits in sessionStorage.
  useEffect(() => {
    if (!enabled || !storageKey || typeof window === "undefined") return;
    const cached = window.sessionStorage.getItem(storageKey);
    if (!cached) return;
    void verify(cached).then((ok) => {
      if (!ok) {
        try {
          window.sessionStorage.removeItem(storageKey);
        } catch {
          /* ignore */
        }
      }
    });
  }, [enabled, storageKey, verify]);

  return { body, verify, clear, error, loading };
}
