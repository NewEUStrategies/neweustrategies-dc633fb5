// Fire-and-forget post-view recording. Triggers once per (post, mount).
// The 5-min anti-spam window lives server-side in `record_post_view`.
import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { recordPostView } from "@/lib/views/postViews.functions";
import { getViewerHash } from "@/lib/views/viewerHash";

export function useRecordPostView(postId: string | undefined | null) {
  const record = useServerFn(recordPostView);
  const fired = useRef<string | null>(null);

  useEffect(() => {
    if (!postId || fired.current === postId) return;
    fired.current = postId;
    const viewerHash = getViewerHash();
    // 1.5 s delay — filters out instant back/forward navigation.
    const t = window.setTimeout(() => {
      record({ data: { postId, viewerHash } }).catch(() => {
        /* silent: view counts are best-effort */
      });
    }, 1500);
    return () => window.clearTimeout(t);
  }, [postId, record]);
}
