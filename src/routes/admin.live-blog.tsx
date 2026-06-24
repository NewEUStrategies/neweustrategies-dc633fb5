// Admin route: zarządzanie wpisami Live Blog dla wybranego postu i bloku.
// URL: /admin/live-blog?postId=...&blockId=...&lang=pl
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useRequiredTenant } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

interface SearchParams {
  postId?: string;
  blockId?: string;
  lang?: "pl" | "en";
}

export const Route = createFileRoute("/admin/live-blog")({
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    postId: typeof s.postId === "string" ? s.postId : undefined,
    blockId: typeof s.blockId === "string" ? s.blockId : undefined,
    lang: s.lang === "en" ? "en" : "pl",
  }),
  component: LiveBlogAdmin,
  head: () => ({ meta: [{ title: "Live Blog - Admin" }] }),
  errorComponent: ({ error }) => <div role="alert" className="p-6">{error.message}</div>,
  notFoundComponent: () => <div className="p-6">404</div>,
});

interface EntryRow {
  id: string;
  post_id: string;
  block_id: string;
  lang: "pl" | "en";
  title: string | null;
  body_html: string;
  pinned: boolean;
  occurred_at: string;
}

function LiveBlogAdmin() {
  const tenantId = useRequiredTenant();
  const qc = useQueryClient();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const [postId, setPostId] = useState(search.postId ?? "");
  const [blockId, setBlockId] = useState(search.blockId ?? "");
  const lang: "pl" | "en" = search.lang ?? "pl";

  const enabled = !!search.postId && !!search.blockId;
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["liveBlogEntries", search.postId, search.blockId, lang] as const,
    enabled,
    queryFn: async (): Promise<EntryRow[]> => {
      const { data, error } = await supabase
        .from("live_blog_entries")
        .select("id, post_id, block_id, lang, title, body_html, pinned, occurred_at")
        .eq("post_id", search.postId!)
        .eq("block_id", search.blockId!)
        .eq("lang", lang)
        .order("occurred_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as EntryRow[];
    },
  });

  const [draft, setDraft] = useState({ title: "", body_html: "", pinned: false });

  const refresh = () => qc.invalidateQueries({ queryKey: ["liveBlogEntries"] });

  const addEntry = async () => {
    if (!enabled) { toast.error("Najpierw wybierz post i blok"); return; }
    if (!draft.body_html.trim()) { toast.error("Pusta treść"); return; }
    const { error } = await supabase.from("live_blog_entries").insert({
      tenant_id: tenantId,
      post_id: search.postId!,
      block_id: search.blockId!,
      lang,
      title: draft.title || null,
      body_html: draft.body_html,
      pinned: draft.pinned,
      occurred_at: new Date().toISOString(),
    });
    if (error) { toast.error(error.message); return; }
    setDraft({ title: "", body_html: "", pinned: false });
    toast.success("Dodano wpis");
    refresh();
  };

  const togglePin = async (e: EntryRow) => {
    const { error } = await supabase
      .from("live_blog_entries")
      .update({ pinned: !e.pinned })
      .eq("id", e.id);
    if (error) { toast.error(error.message); return; }
    refresh();
  };

  const remove = async (id: string) => {
    if (!confirm("Usunąć wpis?")) return;
    const { error } = await supabase.from("live_blog_entries").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    refresh();
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <header>
        <h1 className="font-display text-2xl">Live Blog - moderacja</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Wpisy publikowane na żywo w bloku Live Blog. Realtime: zmiany pojawiają się
          natychmiast na stronie publicznej.
        </p>
      </header>

      <section className="rounded-md border p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label>Post ID</Label>
            <Input value={postId} onChange={(e) => setPostId(e.target.value)} placeholder="uuid" />
          </div>
          <div>
            <Label>Block ID</Label>
            <Input value={blockId} onChange={(e) => setBlockId(e.target.value)} placeholder="b_xxx" />
          </div>
          <div>
            <Label>Język</Label>
            <Select value={lang} onValueChange={(v) => navigate({ search: (p) => ({ ...p, lang: v as "pl" | "en" }) })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pl">PL</SelectItem>
                <SelectItem value="en">EN</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button
          onClick={() => navigate({ search: (p) => ({ ...p, postId, blockId }) })}
          disabled={!postId || !blockId}
        >
          Wczytaj wpisy
        </Button>
      </section>

      {enabled && (
        <section className="rounded-md border p-4 space-y-3">
          <h2 className="font-medium">Nowy wpis</h2>
          <div>
            <Label>Tytuł (opcjonalny)</Label>
            <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </div>
          <div>
            <Label>Treść (HTML, sanitizowany przy renderze)</Label>
            <Textarea
              rows={5}
              value={draft.body_html}
              onChange={(e) => setDraft({ ...draft, body_html: e.target.value })}
              placeholder="<p>...</p>"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={draft.pinned} onCheckedChange={(v) => setDraft({ ...draft, pinned: v })} />
            <span className="text-sm">Przypięte</span>
          </div>
          <Button onClick={addEntry}>Opublikuj</Button>
        </section>
      )}

      {enabled && (
        <section className="space-y-3">
          <h2 className="font-medium">
            Wpisy ({entries.length}){isLoading && " - ładowanie..."}
          </h2>
          <ul className="space-y-2">
            {entries.map((e) => (
              <li key={e.id} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2">
                    <time className="text-xs font-mono text-muted-foreground">
                      {new Date(e.occurred_at).toLocaleString("pl-PL")}
                    </time>
                    {e.pinned && <span className="text-[10px] uppercase text-amber-600">Przypięty</span>}
                    {e.title && <strong>{e.title}</strong>}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => togglePin(e)}>
                      {e.pinned ? "Odepnij" : "Przypnij"}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => remove(e.id)}>
                      Usuń
                    </Button>
                  </div>
                </div>
                <div className="prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: e.body_html }} />
              </li>
            ))}
            {entries.length === 0 && !isLoading && (
              <li className="text-sm text-muted-foreground">Brak wpisów.</li>
            )}
          </ul>
        </section>
      )}
    </div>
  );
}
