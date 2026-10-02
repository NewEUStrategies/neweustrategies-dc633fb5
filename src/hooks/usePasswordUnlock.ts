import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { unlockContentPassword } from "@/lib/auth/bruteforce.functions";
import type { BodyParts } from "@/lib/access/gating";

type EntityType = "post" | "page";

/** Powód odmowy: złe hasło, serwerowy limit prób albo awaria samej weryfikacji. */
export type PasswordUnlockFailure = "invalid" | "rate_limited" | "failed";

export type PasswordVerifyResult = { ok: true } | { ok: false; reason: PasswordUnlockFailure };

// sessionStorage bywa niedostępny: SSR nie ma `window`, a tryb prywatny /
// zablokowane dane witryny rzucają SecurityError już przy odczycie
// właściwości. Pamięć hasła to wygoda, nie warunek odblokowania - każda awaria
// znaczy "brak zapamiętanego hasła".
function cachedPassword(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function rememberPassword(key: string, password: string | null): void {
  try {
    if (password === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, password);
  } catch {
    /* quota / tryb prywatny - ignorujemy */
  }
}

const storageKeyFor = (entityType: EntityType, entityId: string) =>
  `content-pwd:${entityType}:${entityId}`;

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
  const storageKey = entityId ? storageKeyFor(entityType, entityId) : null;
  // Body i stan "w toku" niosą klucz bytu, dla którego powstały: trasa `$` nie
  // przemontowuje strony między wpisami, więc bez tego treść odblokowana na
  // wpisie A (albo spóźniona odpowiedź dla A) renderowałaby się na wpisie B.
  // MAPA, nie jedno miejsce: spóźniona odpowiedź dla A nie może wyprzeć body B
  // odblokowanego w międzyczasie (cicho, z hasła zapamiętanego w karcie).
  const [unlocked, setUnlocked] = useState<Readonly<Record<string, BodyParts>>>({});
  const unlockedKeys = useRef(new Set<string>());
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const runUnlock = useServerFn(unlockContentPassword);

  const verify = useCallback(
    async (password: string): Promise<PasswordVerifyResult> => {
      if (!entityId) return { ok: false, reason: "invalid" };
      const key = storageKeyFor(entityType, entityId);
      setPendingKey(key);
      let result: PasswordVerifyResult;
      try {
        const row = await runUnlock({
          data: { entityType, entityId, password },
        });
        if (!row || row.ok !== true) {
          result = { ok: false, reason: "invalid" };
        } else {
          const body: BodyParts = {
            content_pl: row.content_pl ?? null,
            content_en: row.content_en ?? null,
            builder_data: row.builder_data ?? null,
            blocks_data: row.blocks_data ?? null,
          };
          unlockedKeys.current.add(key);
          setUnlocked((prev) => ({ ...prev, [key]: body }));
          rememberPassword(key, password);
          result = { ok: true };
        }
      } catch (e) {
        // Wyjątek to nigdy "złe hasło" (to wraca jako ok: false) - UI nie może
        // go liczyć jako nieudanej próby ani pokazywać jako błędnego hasła.
        const msg = e instanceof Error ? e.message : "";
        result = { ok: false, reason: msg.includes("rate_limited") ? "rate_limited" : "failed" };
      }
      setPendingKey((current) => (current === key ? null : current));
      return result;
    },
    [entityType, entityId, runUnlock],
  );

  // Silent re-unlock on mount when a valid password sits in sessionStorage.
  // Wpis odblokowany już w tej sesji (powrót A -> B -> A) nie pyta serwera
  // drugi raz - body czeka w mapie.
  useEffect(() => {
    if (!enabled || !storageKey || unlockedKeys.current.has(storageKey)) return;
    const cached = cachedPassword(storageKey);
    if (!cached) return;
    void verify(cached).then((result) => {
      // Zapamiętane hasło unieważnia tylko jednoznaczna odmowa - chwilowa
      // awaria albo limit prób nie mogą kasować poprawnego hasła karty.
      if (!result.ok && result.reason === "invalid") rememberPassword(storageKey, null);
    });
  }, [enabled, storageKey, verify]);

  const body = storageKey ? (unlocked[storageKey] ?? null) : null;
  const loading = pendingKey !== null && pendingKey === storageKey;
  return { body, verify, loading };
}
