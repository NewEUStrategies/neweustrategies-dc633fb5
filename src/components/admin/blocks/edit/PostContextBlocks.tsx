// Admin edytory dla bloków Phase 2 batch 7: author-bio, related-posts.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Block, Json } from "@/lib/blocks/types";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
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
import { ExpertPicker } from "@/components/admin/experts/ExpertPicker";
import { readProfileCardStyle } from "@/lib/builder/profileCardStyle";
import { PROFILE_CARD_DEFAULTS } from "@/components/ui/profile-card";
import { toJson } from "@/lib/builder/types";

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
  const i18n = useBlocksI18n();
  const pc = (k: string) => i18n.editor("postContextBlocks", k);
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
            <span className="text-[10px] text-muted-foreground">{pc("none")}</span>
          )}
        </div>
        <div className="flex-1 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setPickAvatarOpen(true)}>
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            {author.avatarUrl ? pc("changePhoto") : pc("uploadPhoto")}
          </Button>
          {author.avatarUrl && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onChange({ avatarUrl: "" })}
            >
              <XClose className="h-3.5 w-3.5 mr-1.5" />
              {i18n.editor("common", "remove")}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {field("name", pc("fName"), pc("fNamePh"))}
        {field("jobTitle", pc("fJobTitle"), pc("fJobTitlePh"))}
        {field("company", pc("fCompany"), pc("fCompanyPh"))}
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {pc("fSlug")}
          </span>
          <Input
            value={author.slug ?? ""}
            placeholder={pc("fSlugPh")}
            onChange={(e) => onChange({ slug: e.target.value })}
            className="mt-1 h-9 text-xs"
          />
        </label>
        {field("contactEmail", pc("fContactEmail"), pc("fContactEmailPh"), "email")}
        {field("phone", pc("fPhone"), pc("fPhonePh"), "tel")}
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
          {pc("socialMedia")}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {field("xUrl", "X (x.com)", "https://x.com/...", "url")}
          {field("linkedinUrl", "LinkedIn", "https://linkedin.com/in/...", "url")}
          {field("facebookUrl", "Facebook", "https://facebook.com/...", "url")}
          {field("instagramUrl", "Instagram", "https://instagram.com/...", "url")}
          {field("spotifyUrl", "Spotify", "https://open.spotify.com/...", "url")}
          {field("websiteUrl", pc("fWebsite"), "https://...", "url")}
        </div>
      </div>

      <div className="pt-2 border-t border-border/60 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {pc("customLinks")}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => updateSocials([...socials, { label: "", url: "", iconUrl: "" }])}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            {pc("addLink")}
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
              title={pc("uploadIcon")}
            >
              {s.iconUrl ? (
                <img src={s.iconUrl} alt="" className="w-6 h-6 object-contain" />
              ) : (
                <Upload className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>
            <Input
              value={s.label}
              placeholder={pc("linkName")}
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
              aria-label={pc("removeLink")}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {socials.length === 0 && (
          <p className="text-[11px] text-muted-foreground italic">{pc("noCustomLinks")}</p>
        )}
      </div>

      <MediaPickerDialog
        open={pickAvatarOpen}
        onOpenChange={setPickAvatarOpen}
        onPick={(url) => onChange({ avatarUrl: url })}
        accept="image"
        title={pc("pickAvatarTitle")}
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
        title={pc("pickIconTitle")}
      />
    </div>
  );
}

/** Warianty bloku `author-bio` - jedno źródło prawdy dla panelu i podglądów. */
const AUTHOR_BIO_VARIANTS = ["card", "split", "inline", "minimal", "profile"] as const;
type AuthorBioVariant = (typeof AUTHOR_BIO_VARIANTS)[number];

const AUTHOR_BIO_VARIANT_LABEL_KEY: Record<AuthorBioVariant, string> = {
  card: "variantNameCard",
  split: "variantNameSplit",
  inline: "variantNameInline",
  minimal: "variantNameMinimal",
  profile: "variantNameProfile",
};

/**
 * Ustawienia prezentacji wariantu „Karta profilu". Klucze SĄ TE SAME, co w
 * panelu widgetu `author-profile-card` w builderze (lib/builder/profileCardStyle),
 * więc ten sam dokument wygląda identycznie w obu edytorach i na stronie.
 */
function ProfileVariantSettings({
  block,
  set,
}: {
  block: Block;
  set: (patch: Record<string, Json>) => void;
}) {
  const i18n = useBlocksI18n();
  const pc = (k: string) => i18n.editor("postContextBlocks", k);
  const d = PROFILE_CARD_DEFAULTS;
  const numValue = (key: string, fallback: number) => {
    const v = block.data[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
    return fallback;
  };
  const strValue = (key: string, fallback: string) =>
    typeof block.data[key] === "string" && block.data[key] ? String(block.data[key]) : fallback;

  const numberField = (
    key: string,
    label: string,
    fallback: number,
    min: number,
    max: number,
    step: number,
  ) => (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        className="mt-1 w-full text-xs bg-background border border-border rounded-[6px] px-2 py-2 h-9"
        value={numValue(key, fallback)}
        // Puste pole = „wróć do domyślnej", nie 0 px (patrz readProfileCardStyle).
        onChange={(e) => set({ [key]: e.target.value === "" ? "" : Number(e.target.value) })}
      />
    </label>
  );

  return (
    <div className="space-y-3 rounded-[6px] border border-border/60 bg-background/40 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {pc("profileStyleTitle")}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {numberField("imageSize", pc("fImageSize"), d.imageSize, 200, 720, 10)}
        {numberField("overlap", pc("fOverlap"), d.overlap, 0, 200, 5)}
        {numberField("cardMaxWidth", pc("fMaxWidth"), d.maxWidth, 480, 1600, 20)}
        {numberField("socialSize", pc("fSocialSize"), d.socialSize, 28, 72, 2)}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {pc("fShadow")}
          </span>
          <AdminSelect
            className="mt-1 w-full text-xs bg-background border border-border rounded-[6px] px-2 py-2 h-9"
            value={strValue("shadow", d.shadow)}
            onChange={(e) => set({ shadow: e.target.value })}
          >
            <option value="none">{pc("shadowNone")}</option>
            <option value="sm">{pc("shadowSm")}</option>
            <option value="md">{pc("shadowMd")}</option>
            <option value="lg">{pc("shadowLg")}</option>
            <option value="xl">{pc("shadowXl")}</option>
          </AdminSelect>
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {pc("fSocialStyle")}
          </span>
          <AdminSelect
            className="mt-1 w-full text-xs bg-background border border-border rounded-[6px] px-2 py-2 h-9"
            value={strValue("socialStyle", d.socialStyle)}
            onChange={(e) => set({ socialStyle: e.target.value })}
          >
            <option value="solid">{pc("socialSolid")}</option>
            <option value="outline">{pc("socialOutline")}</option>
          </AdminSelect>
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {pc("fMobileAlign")}
          </span>
          <AdminSelect
            className="mt-1 w-full text-xs bg-background border border-border rounded-[6px] px-2 py-2 h-9"
            value={strValue("mobileAlign", d.align)}
            onChange={(e) => set({ mobileAlign: e.target.value })}
          >
            <option value="center">{pc("alignCenter")}</option>
            <option value="left">{pc("alignLeft")}</option>
          </AdminSelect>
        </label>
        <div className="flex items-end pb-2">
          <Toggle
            checked={block.data.animate !== false}
            onChange={(v) => set({ animate: v })}
            label={pc("toggleAnimate")}
          />
        </div>
      </div>
    </div>
  );
}

export function AuthorBioBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const { i18n: i18next } = useTranslation();
  const lang: "pl" | "en" = (i18next.language ?? "pl").startsWith("en") ? "en" : "pl";
  const pc = (k: string) => i18n.editor("postContextBlocks", k);
  const variantName = (v: string) =>
    pc(AUTHOR_BIO_VARIANT_LABEL_KEY[v as AuthorBioVariant] ?? AUTHOR_BIO_VARIANT_LABEL_KEY.minimal);
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
    set({ inlineAuthor: toJson({ ...inlineAuthor, ...patch }) });

  // Podgląd czyta ustawienia prezentacji tym samym czytnikiem, co renderer
  // publiczny - panel nie może obiecać innego wyglądu niż strona.
  const profileStyle = readProfileCardStyle(block.data);

  const useInlinePreview = authorSource === "inline" && !!inlineAuthor.name;
  const previewCtx = useInlinePreview
    ? { ...PLACEHOLDER_POST_CTX, author: inlineAuthor }
    : { ...PLACEHOLDER_POST_CTX, author: PLACEHOLDER_POST_CTX.author as CurrentPostAuthor };
  const previewLabel =
    authorSource === "inline"
      ? inlineAuthor.name
        ? pc("previewInline")
        : pc("previewFillInline")
      : selectedAuthorId
        ? ""
        : pc("previewSample");

  return (
    <Shell label={pc("authorBioLabel")}>
      {/* Wybór źródła danych autora */}
      <div className="flex gap-2 text-xs">
        <button
          type="button"
          className={`px-3 py-1.5 rounded border transition-colors ${authorSource === "existing" ? "bg-accent text-accent-foreground border-border" : "border-border/60 hover:bg-muted"}`}
          onClick={() => set({ authorSource: "existing" })}
        >
          {pc("existingAuthor")}
        </button>
        <button
          type="button"
          className={`px-3 py-1.5 rounded border transition-colors ${authorSource === "inline" ? "bg-accent text-accent-foreground border-border" : "border-border/60 hover:bg-muted"}`}
          onClick={() => set({ authorSource: "inline" })}
        >
          {pc("newInlineAuthor")}
        </button>
      </div>

      {authorSource === "existing" ? (
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {pc("authorLabel")}
          </span>
          {/* Ta sama kontrolka, co w builderze: wyszukiwarka po bazie
              wewnętrznej ekspertów ze zdjęciem, stanowiskiem i licznikiem. */}
          <div className="mt-1">
            <ExpertPicker
              lang={lang}
              value={selectedAuthorId}
              noneLabel={pc("currentPostAuthor")}
              onSelect={(e) => set({ authorId: e.id })}
              onClear={() => set({ authorId: "" })}
            />
          </div>
        </label>
      ) : (
        <>
          <InlineAuthorForm author={inlineAuthor} onChange={setInline} />
          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            {pc("globalNote")}
            <a
              href="/admin/users"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              {pc("createProfile")} <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </>
      )}

      <label className="block">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {pc("variant")}
        </span>
        <AdminSelect
          className="mt-1 w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={variant}
          onChange={(e) => set({ variant: e.target.value })}
        >
          <option value="card">{i18n.editor("newsletter", "variantCard")}</option>
          <option value="split">{pc("optSplit")}</option>
          <option value="inline">{pc("optInline")}</option>
          <option value="minimal">{pc("optMinimal")}</option>
          <option value="profile">{pc("optProfile")}</option>
        </AdminSelect>
      </label>

      {variant === "profile" && <ProfileVariantSettings block={block} set={set} />}

      <div className="flex flex-wrap gap-3">
        <Toggle
          checked={showAvatar}
          onChange={(v) => set({ showAvatar: v })}
          label={pc("toggleAvatar")}
        />
        <Toggle
          checked={showSocial}
          onChange={(v) => set({ showSocial: v })}
          label={pc("toggleSocial")}
        />
        <Toggle
          checked={showPostsCount}
          onChange={(v) => set({ showPostsCount: v })}
          label={pc("togglePostsCount")}
        />
      </div>

      <div className="pt-2 border-t border-border/60 space-y-3">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {pc("previewPrefix")} {variantName(variant)}
          {previewLabel && <span className="ml-1 italic normal-case">{previewLabel}</span>}
        </div>
        <CurrentPostProvider value={previewCtx}>
          <AuthorBioView
            showAvatar={showAvatar}
            showSocial={showSocial}
            showPostsCount={showPostsCount}
            variant={variant as AuthorBioVariant}
            authorId={!useInlinePreview && selectedAuthorId ? selectedAuthorId : undefined}
            authorOverride={useInlinePreview ? inlineAuthor : undefined}
            profileStyle={profileStyle}
          />
        </CurrentPostProvider>

        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer select-none">{pc("seeOtherVariants")}</summary>
          <div className="mt-3 space-y-4">
            {AUTHOR_BIO_VARIANTS.filter((v) => v !== variant).map((v) => (
              <div key={v} className="space-y-1">
                <div className="text-[10px] uppercase tracking-wide">{variantName(v)}</div>
                <CurrentPostProvider value={previewCtx}>
                  <AuthorBioView
                    showAvatar={showAvatar}
                    showSocial={showSocial}
                    showPostsCount={showPostsCount}
                    variant={v}
                    authorId={!useInlinePreview && selectedAuthorId ? selectedAuthorId : undefined}
                    authorOverride={useInlinePreview ? inlineAuthor : undefined}
                    profileStyle={v === "profile" ? profileStyle : undefined}
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
  const i18n = useBlocksI18n();
  const pc = (k: string) => i18n.editor("postContextBlocks", k);
  const limit = Number(block.data.limit ?? 3);
  const strategy = String(block.data.strategy ?? "category");
  const layout = String(block.data.layout ?? "grid");
  const heading = String(block.data.heading ?? "");
  const set = (patch: Record<string, Json>) =>
    onChange({ ...block, data: { ...block.data, ...patch } });

  return (
    <Shell label={pc("relatedLabel")}>
      <input
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        value={heading}
        placeholder={pc("relatedHeading")}
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
          <option value="category">{pc("strategyCategory")}</option>
          <option value="tag">{pc("strategyTag")}</option>
          <option value="author">{pc("strategyAuthor")}</option>
          <option value="latest">{pc("strategyLatest")}</option>
        </AdminSelect>
        <AdminSelect
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={layout}
          onChange={(e) => set({ layout: e.target.value })}
        >
          <option value="grid">Grid</option>
          <option value="list">{pc("layoutList")}</option>
          <option value="compact">{pc("layoutCompact")}</option>
        </AdminSelect>
      </div>
    </Shell>
  );
}
