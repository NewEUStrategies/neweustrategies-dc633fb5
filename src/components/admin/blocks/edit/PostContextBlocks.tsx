// Admin edytory dla bloków Phase 2 batch 7: author-bio, related-posts.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Block, Json } from "@/lib/blocks/types";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import { AdminSelect } from "../AdminSelect";
import { AuthorBioView } from "@/components/blocks/PostContextViews";
import { MediaPickerDialog } from "@/components/admin/media/MediaPickerDialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Upload, X as XClose, ExternalLink } from "lucide-react";
import {
  CurrentPostProvider,
  PLACEHOLDER_POST_CTX,
  type CurrentPostAuthor,
  type CustomAuthorSocial,
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

/**
 * Formularz danych autora inline - używany, gdy authorSource="inline".
 * Wszystkie pola są opcjonalne - w widoku puste pola nie renderują placeholderów.
 */
function InlineAuthorForm({
  author,
  onChange,
}: {
  author: CurrentPostAuthor;
  onChange: (patch: Partial<CurrentPostAuthor>) => void;
}) {
  const [pickAvatarOpen, setPickAvatarOpen] = useState(false);
  const [pickIconIdx, setPickIconIdx] = useState<number | null>(null);
  const socials: CustomAuthorSocial[] = Array.isArray(author.customSocials)
    ? author.customSocials
    : [];
  const updateSocials = (next: CustomAuthorSocial[]) => onChange({ customSocials: next });

  const field = (
    key: keyof CurrentPostAuthor,
    label: string,
    placeholder?: string,
    type: "text" | "email" | "tel" | "url" = "text",
  ) => (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <Input
        type={type}
        value={(author[key] as string | undefined) ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange({ [key]: e.target.value })}
        className="mt-1 h-9 text-xs"
      />
    </label>
  );

  return (
    <div className="space-y-3 rounded-md border border-border bg-background/60 p-3">
      {/* Avatar */}
      <div className="flex items-start gap-3">
        <div className="w-16 h-16 shrink-0 rounded-[7px] overflow-hidden border border-border bg-muted flex items-center justify-center">
          {author.avatarUrl ? (
            <img src={author.avatarUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-[10px] text-muted-foreground">brak</span>
          )}
        </div>
        <div className="flex-1 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setPickAvatarOpen(true)}
          >
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            {author.avatarUrl ? "Zmień zdjęcie" : "Wgraj zdjęcie"}
          </Button>
          {author.avatarUrl && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onChange({ avatarUrl: "" })}
            >
              <XClose className="h-3.5 w-3.5 mr-1.5" />
              Usuń
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {field("name", "Imię i nazwisko", "Jan Kowalski")}
        {field("jobTitle", "Stanowisko", "Redaktor naczelny")}
        {field("company", "Firma / organizacja", "Acme Media")}
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Slug (URL profilu, opcjonalnie)
          </span>
          <Input
            value={author.slug ?? ""}
            placeholder="jan-kowalski"
            onChange={(e) => onChange({ slug: e.target.value })}
            className="mt-1 h-9 text-xs"
          />
        </label>
        {field("contactEmail", "E-mail kontaktowy", "kontakt@example.com", "email")}
        {field("phone", "Telefon", "+48 500 000 000", "tel")}
      </div>

      <label className="block">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Bio (PL)</span>
        <textarea
          value={author.bio_pl ?? ""}
          onChange={(e) => onChange({ bio_pl: e.target.value })}
          className="mt-1 w-full min-h-[64px] text-xs bg-background border border-border rounded px-2 py-2"
        />
      </label>
      <label className="block">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Bio (EN)</span>
        <textarea
          value={author.bio_en ?? ""}
          onChange={(e) => onChange({ bio_en: e.target.value })}
          className="mt-1 w-full min-h-[64px] text-xs bg-background border border-border rounded px-2 py-2"
        />
      </label>

      <div className="pt-2 border-t border-border/60 space-y-2">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Social media
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {field("xUrl", "X (x.com)", "https://x.com/...", "url")}
          {field("linkedinUrl", "LinkedIn", "https://linkedin.com/in/...", "url")}
          {field("facebookUrl", "Facebook", "https://facebook.com/...", "url")}
          {field("instagramUrl", "Instagram", "https://instagram.com/...", "url")}
          {field("spotifyUrl", "Spotify", "https://open.spotify.com/...", "url")}
          {field("websiteUrl", "Strona www", "https://...", "url")}
        </div>
      </div>

      <div className="pt-2 border-t border-border/60 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Własne linki (dowolne platformy)
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => updateSocials([...socials, { label: "", url: "", iconUrl: "" }])}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Dodaj link
          </Button>
        </div>
        {socials.map((s, i) => (
          <div
            key={i}
            className="grid grid-cols-[40px_1fr_1fr_auto] gap-2 items-center rounded border border-border/60 p-2 bg-muted/20"
          >
            <button
              type="button"
              onClick={() => setPickIconIdx(i)}
              className="w-10 h-10 rounded-[7px] border border-border bg-background flex items-center justify-center overflow-hidden hover:border-foreground/40"
              title="Wgraj ikonę"
            >
              {s.iconUrl ? (
                <img src={s.iconUrl} alt="" className="w-6 h-6 object-contain" />
              ) : (
                <Upload className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>
            <Input
              value={s.label}
              placeholder="Nazwa (np. Substack)"
              className="h-9 text-xs"
              onChange={(e) => {
                const next = [...socials];
                next[i] = { ...s, label: e.target.value };
                updateSocials(next);
              }}
            />
            <Input
              value={s.url}
              placeholder="https://..."
              type="url"
              className="h-9 text-xs"
              onChange={(e) => {
                const next = [...socials];
                next[i] = { ...s, url: e.target.value };
                updateSocials(next);
              }}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => updateSocials(socials.filter((_, j) => j !== i))}
              aria-label="Usuń link"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {socials.length === 0 && (
          <p className="text-[11px] text-muted-foreground italic">
            Brak własnych linków. Jeśli brakuje ikony dla platformy, wgraj własną - w przeciwnym
            razie użyta zostanie ikona łańcucha.
          </p>
        )}
      </div>

      <MediaPickerDialog
        open={pickAvatarOpen}
        onOpenChange={setPickAvatarOpen}
        onPick={(url) => onChange({ avatarUrl: url })}
        accept="image"
        title="Wybierz zdjęcie autora"
      />
      <MediaPickerDialog
        open={pickIconIdx !== null}
        onOpenChange={(o) => !o && setPickIconIdx(null)}
        onPick={(url) => {
          if (pickIconIdx === null) return;
          const next = [...socials];
          next[pickIconIdx] = { ...next[pickIconIdx], iconUrl: url };
          updateSocials(next);
          setPickIconIdx(null);
        }}
        accept="image"
        title="Wybierz ikonę social"
      />
    </div>
  );
}

export function AuthorBioBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const showAvatar = block.data.showAvatar !== false;
  const showSocial = block.data.showSocial !== false;
  const showPostsCount = block.data.showPostsCount !== false;
  const variant = String(block.data.variant ?? "card");
  const authorSource: "existing" | "inline" =
    block.data.authorSource === "inline" ? "inline" : "existing";
  const selectedAuthorId = typeof block.data.authorId === "string" ? block.data.authorId : "";
  const inlineAuthor: CurrentPostAuthor =
    block.data.inlineAuthor &&
    typeof block.data.inlineAuthor === "object" &&
    !Array.isArray(block.data.inlineAuthor)
      ? (block.data.inlineAuthor as unknown as CurrentPostAuthor)
      : {};

  const set = (patch: Record<string, Json>) =>
    onChange({ ...block, data: { ...block.data, ...patch } });
  const setInline = (patch: Partial<CurrentPostAuthor>) =>
    set({ inlineAuthor: { ...inlineAuthor, ...patch } as unknown as Json });

  const { data: authors = [] } = useAuthorOptions();

  const useInlinePreview = authorSource === "inline" && !!inlineAuthor.name;
  const previewCtx = useInlinePreview
    ? { ...PLACEHOLDER_POST_CTX, author: inlineAuthor }
    : { ...PLACEHOLDER_POST_CTX, author: PLACEHOLDER_POST_CTX.author as CurrentPostAuthor };
  const previewLabel =
    authorSource === "inline"
      ? inlineAuthor.name
        ? "(autor inline)"
        : "(uzupełnij dane inline)"
      : selectedAuthorId
        ? ""
        : "(przykładowe dane)";

  return (
    <Shell label="Bio autora">
      {/* Wybór źródła danych autora */}
      <div className="flex gap-2 text-xs">
        <button
          type="button"
          className={`px-3 py-1.5 rounded border transition-colors ${authorSource === "existing" ? "bg-accent text-accent-foreground border-border" : "border-border/60 hover:bg-muted"}`}
          onClick={() => set({ authorSource: "existing" })}
        >
          Istniejący autor
        </button>
        <button
          type="button"
          className={`px-3 py-1.5 rounded border transition-colors ${authorSource === "inline" ? "bg-accent text-accent-foreground border-border" : "border-border/60 hover:bg-muted"}`}
          onClick={() => set({ authorSource: "inline" })}
        >
          Nowy autor (inline)
        </button>
      </div>

      {authorSource === "existing" ? (
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
      ) : (
        <>
          <InlineAuthorForm author={inlineAuthor} onChange={setInline} />
          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            Chcesz, żeby ten autor był dostępny globalnie w innych wpisach?
            <a
              href="/admin/users"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              Utwórz profil w bazie <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </>
      )}

      <label className="block">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Wariant</span>
        <AdminSelect
          className="mt-1 w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={variant}
          onChange={(e) => set({ variant: e.target.value })}
        >
          <option value="card">{i18n.editor("newsletter", "variantCard")}</option>
          <option value="split">Split (kolorowy panel)</option>
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
          Podgląd -{" "}
          {variant === "card"
            ? "Karta"
            : variant === "split"
              ? "Split"
              : variant === "inline"
                ? "Inline"
                : "Minimalna"}
          {previewLabel && <span className="ml-1 italic normal-case">{previewLabel}</span>}
        </div>
        <CurrentPostProvider value={previewCtx}>
          <AuthorBioView
            showAvatar={showAvatar}
            showSocial={showSocial}
            showPostsCount={showPostsCount}
            variant={variant as "card" | "inline" | "minimal" | "split"}
            authorId={
              !useInlinePreview && selectedAuthorId ? selectedAuthorId : undefined
            }
            authorOverride={useInlinePreview ? inlineAuthor : undefined}
          />
        </CurrentPostProvider>

        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer select-none">Zobacz pozostałe warianty</summary>
          <div className="mt-3 space-y-4">
            {(["card", "split", "inline", "minimal"] as const)
              .filter((v) => v !== variant)
              .map((v) => (
                <div key={v} className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wide">
                    {v === "card"
                      ? "Karta"
                      : v === "split"
                        ? "Split"
                        : v === "inline"
                          ? "Inline"
                          : "Minimalna"}
                  </div>
                  <CurrentPostProvider value={previewCtx}>
                    <AuthorBioView
                      showAvatar={showAvatar}
                      showSocial={showSocial}
                      showPostsCount={showPostsCount}
                      variant={v}
                      authorId={
                        !useInlinePreview && selectedAuthorId ? selectedAuthorId : undefined
                      }
                      authorOverride={useInlinePreview ? inlineAuthor : undefined}
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
