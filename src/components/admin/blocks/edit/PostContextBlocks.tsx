// Admin edytory dla bloków Phase 2 batch 7: author-bio, related-posts.
import { useQuery } from "@tanstack/react-query";
import type { Block, Json } from "@/lib/blocks/types";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import { AdminSelect } from "../AdminSelect";
import { AuthorBioView } from "@/components/blocks/PostContextViews";
import {
  CurrentPostProvider,
  PLACEHOLDER_POST_CTX,
  type CurrentPostAuthor,
} from "@/lib/builder/currentPostContext";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

function Shell({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-2 bg-muted/20">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

interface AuthorOption {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  slug: string | null;
  bio_pl: string | null;
  bio_en: string | null;
  twitter_url: string | null;
  linkedin_url: string | null;
  website_url: string | null;
  email: string | null;
  roles: string[] | null;
}

const AUTHOR_ROLES = new Set(["author", "editor", "admin", "super_admin"]);

function useAuthorOptions() {
  return useQuery({
    queryKey: ["admin", "author-options"],
    staleTime: 60_000,
    queryFn: async (): Promise<AuthorOption[]> => {
      const { data, error } = await supabase.rpc("admin_list_users");
      if (error) throw error;
      const rows = (data ?? []) as AuthorOption[];
      return rows
        .filter((r) => (r.roles ?? []).some((role) => AUTHOR_ROLES.has(role)))
        .sort((a, b) =>
          (a.display_name ?? "").localeCompare(b.display_name ?? "", undefined, {
            sensitivity: "base",
          }),
        );
    },
  });
}

export function AuthorBioBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const showAvatar = block.data.showAvatar !== false;
  const showSocial = block.data.showSocial !== false;
  const showPostsCount = block.data.showPostsCount !== false;
  const variant = String(block.data.variant ?? "card");
  const selectedAuthorId = typeof block.data.authorId === "string" ? block.data.authorId : "";
  const set = (patch: Record<string, Json>) =>
    onChange({ ...block, data: { ...block.data, ...patch } });

  const { data: authors = [] } = useAuthorOptions();

  return (
    <Shell label="Bio autora">
      <label className="block">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Autor</span>
        <AdminSelect
          className="mt-1 w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={selectedAuthorId}
          onChange={(e) => set({ authorId: e.target.value })}
        >
          <option value="">Autor bieżącego wpisu</option>
          {authors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.display_name ?? a.slug ?? a.id}
            </option>
          ))}
        </AdminSelect>
      </label>

      <label className="block">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Wariant</span>
        <AdminSelect
          className="mt-1 w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={variant}
          onChange={(e) => set({ variant: e.target.value })}
        >
          <option value="card">{i18n.editor("newsletter", "variantCard")}</option>
          <option value="inline">Inline</option>
          <option value="minimal">Minimalna</option>
        </AdminSelect>
      </label>

      <div className="flex flex-wrap gap-3">
        <Toggle checked={showAvatar} onChange={(v) => set({ showAvatar: v })} label="Avatar" />
        <Toggle
          checked={showSocial}
          onChange={(v) => set({ showSocial: v })}
          label="Linki social"
        />
        <Toggle
          checked={showPostsCount}
          onChange={(v) => set({ showPostsCount: v })}
          label="Licznik wpisów"
        />
      </div>

      <div className="pt-2 border-t border-border/60 space-y-3">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Podgląd - {variant === "card" ? "Karta" : variant === "inline" ? "Inline" : "Minimalna"}
          {!selectedAuthorId && <span className="ml-1 italic normal-case">(przykładowe dane)</span>}
        </div>
        <CurrentPostProvider
          value={{
            ...PLACEHOLDER_POST_CTX,
            author: PLACEHOLDER_POST_CTX.author as CurrentPostAuthor,
          }}
        >
          <AuthorBioView
            showAvatar={showAvatar}
            showSocial={showSocial}
            showPostsCount={showPostsCount}
            variant={variant as "card" | "inline" | "minimal"}
            authorId={selectedAuthorId || undefined}
          />
        </CurrentPostProvider>

        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer select-none">Zobacz pozostałe warianty</summary>
          <div className="mt-3 space-y-4">
            {(["card", "inline", "minimal"] as const)
              .filter((v) => v !== variant)
              .map((v) => (
                <div key={v} className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wide">
                    {v === "card" ? "Karta" : v === "inline" ? "Inline" : "Minimalna"}
                  </div>
                  <CurrentPostProvider
                    value={{
                      ...PLACEHOLDER_POST_CTX,
                      author: PLACEHOLDER_POST_CTX.author as CurrentPostAuthor,
                    }}
                  >
                    <AuthorBioView
                      showAvatar={showAvatar}
                      showSocial={showSocial}
                      showPostsCount={showPostsCount}
                      variant={v}
                      authorId={selectedAuthorId || undefined}
                    />
                  </CurrentPostProvider>
                </div>
              ))}
          </div>
        </details>
      </div>
    </Shell>
  );
}

export function RelatedPostsBlock({ block, onChange }: Props) {
  const limit = Number(block.data.limit ?? 3);
  const strategy = String(block.data.strategy ?? "category");
  const layout = String(block.data.layout ?? "grid");
  const heading = String(block.data.heading ?? "");
  const set = (patch: Record<string, Json>) =>
    onChange({ ...block, data: { ...block.data, ...patch } });

  return (
    <Shell label="Powiązane wpisy">
      <input
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        value={heading}
        placeholder="Nagłówek (opcjonalnie)"
        onChange={(e) => set({ heading: e.target.value })}
      />
      <div className="grid grid-cols-3 gap-2">
        <input
          type="number"
          min={1}
          max={12}
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={limit}
          onChange={(e) => set({ limit: Number(e.target.value) || 3 })}
        />
        <AdminSelect
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={strategy}
          onChange={(e) => set({ strategy: e.target.value })}
        >
          <option value="category">Wg kategorii</option>
          <option value="tag">Wg tagu</option>
          <option value="author">Wg autora</option>
          <option value="latest">Najnowsze</option>
        </AdminSelect>
        <AdminSelect
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={layout}
          onChange={(e) => set({ layout: e.target.value })}
        >
          <option value="grid">Grid</option>
          <option value="list">Lista</option>
          <option value="compact">Kompakt</option>
        </AdminSelect>
      </div>
    </Shell>
  );
}
