// Fire-and-forget post-view recording. Triggers once per (post, mount).
// The 5-min anti-spam window lives server-side in `record_post_view`.
import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { recordPostView } from "@/lib/views/postViews.functions";
import { clearViewerHash, getViewerHash } from "@/lib/views/viewerHash";
import { hasAnalyticsConsent } from "@/lib/ads/consent";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { afterPrerendering } from "@/lib/prerender";

export function useRecordPostView(postId: string | undefined | null, authorId?: string | null) {
  const record = useServerFn(recordPostView);
  const { user } = useAuth();

  const fired = useRef<string | null>(null);
  // Read identity/callbacks through refs so the recording effect depends only on
  // `postId`. Previously `user?.id` (and `record`/`authorId`) were in the deps:
  // client auth resolves null->id shortly after mount, which tore down the
  // pending 1.5s timer and re-ran the effect, where the `fired` guard early-
  // returned WITHOUT rescheduling - so a signed-in user's view and read-history
  // were never recorded on a hard page load (the common case).
  const userIdRef = useRef<string | undefined>(undefined);
  userIdRef.current = user?.id;
  const authorIdRef = useRef<string | null | undefined>(authorId);
  authorIdRef.current = authorId;
  const recordRef = useRef(record);
  recordRef.current = record;

  useEffect(() => {
    if (!postId || fired.current === postId) return;
    fired.current = postId;
    let t: number | undefined;
    // Strona prerenderowana spekulacyjnie (Speculation Rules) nie jest
    // odsłoną - odliczanie rusza dopiero po aktywacji (prerenderingchange).
    const stopPrerenderWait = afterPrerendering(() => {
      // 1.5 s delay - filters out instant back/forward navigation.
      t = window.setTimeout(() => {
        const userId = userIdRef.current;
        // `post_views.viewer_hash` łączy odsłony jednej osoby między sesjami,
        // a /cookies deklaruje `post_views` w kategorii „analityka” - bez tej
        // zgody nie wolno ani policzyć odsłony, ani zapisać identyfikatora
        // w localStorage. Decyzję czytamy dopiero tutaj (jak beacony w
        // lib/analytics/track.ts), więc zgoda udzielona PO upływie 1,5 s nie
        // policzy tej odsłony - ta sama populacja co GA4, celowo.
        if (hasAnalyticsConsent()) {
          // Don't let an author inflate their own post's public view count / trending
          // rank by reloading it (best-effort; anon views still count as designed).
          const isAuthor = !!userId && !!authorIdRef.current && userId === authorIdRef.current;
          if (!isAuthor) {
            recordRef.current({ data: { postId, viewerHash: getViewerHash() } }).catch(() => {
              /* silent: view counts are best-effort */
            });
          }
        } else {
          // Identyfikator z czasów poprzedniej zgody nie ma prawa jej przeżyć.
          clearViewerHash();
        }
        // The view counter runs as anon and can't attribute the read to the user,
        // so record the signed-in user's read history here (owner-RLS, authed
        // session). This is what feeds recommendations' "already read" exclusion
        // and read-based interest scoring - previously nothing ever wrote it.
        if (userId) {
          void supabase
            .from("user_read_history")
            .upsert(
              { user_id: userId, post_id: postId, read_at: new Date().toISOString() },
              { onConflict: "user_id,post_id" },
            )
            .then(undefined, () => {
              /* best-effort */
            });
        }
      }, 1500);
    });
    return () => {
      stopPrerenderWait();
      if (t !== undefined) window.clearTimeout(t);
    };
  }, [postId]);
}
