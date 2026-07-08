// Fire-and-forget post-view recording. Triggers once per (post, mount).
// The 5-min anti-spam window lives server-side in `record_post_view`.
import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { recordPostView } from "@/lib/views/postViews.functions";
import { getViewerHash } from "@/lib/views/viewerHash";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

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
    const viewerHash = getViewerHash();
    // 1.5 s delay - filters out instant back/forward navigation.
    const t = window.setTimeout(() => {
      const userId = userIdRef.current;
      // Don't let an author inflate their own post's public view count / trending
      // rank by reloading it (best-effort; anon views still count as designed).
      const isAuthor = !!userId && !!authorIdRef.current && userId === authorIdRef.current;
      if (!isAuthor) {
        recordRef.current({ data: { postId, viewerHash } }).catch(() => {
          /* silent: view counts are best-effort */
        });
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
    return () => window.clearTimeout(t);
  }, [postId]);
}
