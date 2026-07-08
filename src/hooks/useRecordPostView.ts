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

  useEffect(() => {
    if (!postId || fired.current === postId) return;
    fired.current = postId;
    const viewerHash = getViewerHash();
    const userId = user?.id;
    // Don't let an author inflate their own post's public view count / trending
    // rank by reloading it (best-effort; anon views still count as designed).
    const isAuthor = !!userId && !!authorId && userId === authorId;
    // 1.5 s delay - filters out instant back/forward navigation.
    const t = window.setTimeout(() => {
      if (!isAuthor) {
        record({ data: { postId, viewerHash } }).catch(() => {
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
  }, [postId, authorId, record, user?.id]);
}
