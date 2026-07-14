import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FieldLabel } from "@/components/profile/FieldLabel";
import { toast } from "sonner";
import { Trash2, Plus, Upload, ShieldAlert, Info, RefreshCcw, ExternalLink, Linkedin as LucideLinkedin, Facebook as LucideFacebook, Instagram as LucideInstagram, Link2 as LucideLink } from "lucide-react";
import { BrandIcon } from "@/components/atoms/BrandIcon";
import { XIcon } from "@/components/atoms/XIcon";
import type { ComponentType, SVGAttributes } from "react";

// Spotify nie ma w lucide-react - prosty SVG fallback zgodny z brandingiem.
const SpotifyFallback: ComponentType<{ className?: string } & SVGAttributes<SVGSVGElement>> = ({ className, ...rest }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true" {...rest}>
    <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm4.6 14.42a.62.62 0 0 1-.86.21c-2.36-1.44-5.32-1.77-8.82-.97a.63.63 0 1 1-.28-1.22c3.82-.87 7.1-.5 9.75 1.12a.62.62 0 0 1 .21.86zm1.23-2.74a.78.78 0 0 1-1.07.26c-2.7-1.66-6.82-2.14-10.02-1.17a.78.78 0 0 1-.46-1.5c3.66-1.1 8.2-.57 11.29 1.34a.78.78 0 0 1 .26 1.07zm.11-2.85c-3.24-1.92-8.58-2.1-11.67-1.16a.94.94 0 1 1-.55-1.8c3.55-1.08 9.44-.87 13.17 1.34a.94.94 0 1 1-.95 1.62z" />
  </svg>
);

// Mapa: pole -> (slug w admin/ikony, fallback lucide). Slugi zgodne z ALIASES w BrandIcon.
const SOCIAL_ICONS: Record<string, { slug: string; Fallback: ComponentType<{ className?: string } & SVGAttributes<SVGSVGElement>> }> = {
  x_url: { slug: "x", Fallback: XIcon },
  linkedin_url: { slug: "linkedin", Fallback: LucideLinkedin },
  facebook_url: { slug: "facebook", Fallback: LucideFacebook },
  instagram_url: { slug: "instagram", Fallback: LucideInstagram },
  spotify_url: { slug: "spotify", Fallback: SpotifyFallback },
};
import { IdentityEditorsHint } from "@/components/profile/IdentityEditorsHint";
import { ImageCropDialog, CROP_PRESETS } from "@/components/media/ImageCropDialog";
import { useServerFn } from "@tanstack/react-start";
import { refreshAuthorOgImage } from "@/lib/experts/refreshOg.functions";
import { preferCanonicalBio } from "@/lib/profile/canonicalBio";
import type { OrgFunction } from "@/lib/experts/types";
import { useExpertLayoutSettings } from "@/hooks/useExpertLayoutSettings";
import { EXPERT_LAYOUT_PRESETS } from "@/lib/expertLayouts";
import "@/lib/i18n-experts";

export const Route = createFileRoute("/profile/author")({
  component: AuthorProfilePage,
});

interface CustomSocial {
  label: string;
  url: string;
  iconUrl?: string;
}

interface AuthorProfileRow {
  avatar_url: string | null;
  job_title: string | null;
  company: string | null;
  /** Bio jest kanoniczne w profiles.bio_pl/bio_en - tu tylko edytowane, zapis idzie do profiles. */
  bio_pl: string | null;
  bio_en: string | null;
  /** Pełna biografia huba eksperta (HTML) - author_profiles.full_bio_*. */
  full_bio_pl: string | null;
  full_bio_en: string | null;
  org_functions: OrgFunction[];
  contact_email: string | null;
  phone: string | null;
  website_url: string | null;
  x_url: string | null;
  linkedin_url: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  spotify_url: string | null;
  media_contact_name: string | null;
  media_contact_email: string | null;
  media_contact_phone: string | null;
  custom_socials: CustomSocial[];
  is_public: boolean;
}

const EMPTY: AuthorProfileRow = {
  avatar_url: null,
  job_title: null,
  company: null,
  bio_pl: null,
  bio_en: null,
  full_bio_pl: null,
  full_bio_en: null,
  org_functions: [],
  contact_email: null,
  phone: null,
  website_url: null,
  x_url: null,
  linkedin_url: null,
  facebook_url: null,
  instagram_url: null,
  spotify_url: null,
  media_contact_name: null,
  media_contact_email: null,
  media_contact_phone: null,
  custom_socials: [],
  is_public: true,
};

interface ExpertiseAreaOption {
  id: string;
  name_pl: string;
  name_en: string;
}

const ACCEPT = "image/jpeg,image/png,image/webp,image/avif";
const MAX_AVATAR = 2 * 1024 * 1024;
const MAX_BIO_BULLETS = 5;
const MAX_BULLET_LEN = 200;

/** Rozkłada bio na maks. 5 punktorów - splituje po newline lub znaku listy. */
function bioToBullets(bio: string | null): string[] {
  if (!bio) return [];
  const parts = bio
    .split(/\r?\n+/)
    .map((l) => l.replace(/^\s*[-•*·]\s*/, "").trim())
    .filter(Boolean);
  return parts.slice(0, MAX_BIO_BULLETS);
}

/** Serializuje punktory z powrotem do TEXT (jedna linia = jeden bullet). */
function bulletsToBio(bullets: string[]): string {
  return bullets.map((b) => b.trim()).filter(Boolean).join("\n");
}

function isAuthorRole(roles: string[]): boolean {
  return roles.some((r) => r === "author" || r === "admin" || r === "super_admin");
}

/** Doprowadza expert_expertise_areas do stanu `desired` (insert/delete różnicy).
 *  Zwraca błąd (jeśli był) - null gdy OK. */
async function syncExpertiseAreas(
  userId: string,
  desired: Set<string>,
): Promise<Error | null> {
  const { data: current, error: readErr } = await supabase
    .from("expert_expertise_areas")
    .select("area_id")
    .eq("user_id", userId);
  if (readErr) return readErr;
  const currentIds = new Set((current ?? []).map((r) => (r as { area_id: string }).area_id));
  const toAdd = [...desired].filter((id) => !currentIds.has(id));
  const toRemove = [...currentIds].filter((id) => !desired.has(id));

  if (toAdd.length > 0) {
    const { error } = await supabase
      .from("expert_expertise_areas")
      .insert(toAdd.map((area_id) => ({ user_id: userId, area_id })));
    if (error) return error;
  }
  if (toRemove.length > 0) {
    const { error } = await supabase
      .from("expert_expertise_areas")
      .delete()
      .eq("user_id", userId)
      .in("area_id", toRemove);
    if (error) return error;
  }
  return null;
}

function AuthorProfilePage() {
  const { t, i18n } = useTranslation();
  const { user, roles, tenantId, loading } = useAuth();
  const qc = useQueryClient();
  const [data, setData] = useState<AuthorProfileRow>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [exists, setExists] = useState(false);
  const [uploading, setUploading] = useState(false);
  const avatarInput = useRef<HTMLInputElement | null>(null);
  // Obszary ekspertyzy: pełna taksonomia + zestaw wybrany przez eksperta.
  const [areaOptions, setAreaOptions] = useState<ExpertiseAreaOption[]>([]);
  const [selectedAreaIds, setSelectedAreaIds] = useState<Set<string>>(new Set());
  // Bio jako punktory (max 5) - dziedziczy prezentację z admin/expert-layouts.
  const [bulletsPl, setBulletsPl] = useState<string[]>([]);
  const [bulletsEn, setBulletsEn] = useState<string[]>([]);
  // Ustawienia layoutu eksperta (per tenant) - do informacyjnego banera.
  const { data: layoutSettings } = useExpertLayoutSettings();
  const presetLabel = layoutSettings
    ? EXPERT_LAYOUT_PRESETS.find((p) => p.id === layoutSettings.default_preset)?.[
        i18n.language === "en" ? "label_en" : "label_pl"
      ] ?? layoutSettings.default_preset
    : null;

  // Regeneracja og:image - bumpuje `profiles.updated_at`, przez co
  // wersja `?v=` doklejana w head() rośnie i social scrapery pobierają
  // świeży plik po ping'u w Post Debuggerze.
  const refreshOg = useServerFn(refreshAuthorOgImage);
  const [refreshingOg, setRefreshingOg] = useState(false);
  const [ogDebuggers, setOgDebuggers] = useState<{
    facebook: string;
    linkedin: string;
    twitter: string;
  } | null>(null);
  const onRefreshOg = async () => {
    setRefreshingOg(true);
    try {
      const res = await refreshOg({});
      if (!res.ok || !res.debuggers) {
        toast.error(
          t("profile.author.ogRefreshError", {
            defaultValue:
              "Nie udało się odświeżyć podglądu społecznościowego. Uzupełnij slug profilu i spróbuj ponownie.",
          }),
        );
        return;
      }
      setOgDebuggers(res.debuggers);
      toast.success(
        t("profile.author.ogRefreshOk", {
          defaultValue:
            "Podgląd społecznościowy zaktualizowany. Otwórz Post Debugger, aby wymusić rescrape.",
        }),
      );
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRefreshingOg(false);
    }
  };


  useEffect(() => {
    if (!user) return;
    void (async () => {
      // Bio przychodzi z kanonicznego źródła (profiles), reszta persony
      // autorskiej z author_profiles. Fallback na legacy author_profiles.bio_*
      // tylko dla kont, które nigdy nie zapisały bio w profiles.
      const [{ data: row }, { data: prof }, { data: areas }, { data: myAreas }] =
        await Promise.all([
          supabase
            .from("author_profiles")
            .select(
              "avatar_url, job_title, company, bio_pl, bio_en, full_bio_pl, full_bio_en, org_functions, contact_email, phone, website_url, x_url, linkedin_url, facebook_url, instagram_url, spotify_url, media_contact_name, media_contact_email, media_contact_phone, custom_socials, is_public",
            )
            .eq("user_id", user.id)
            .maybeSingle(),
          supabase.from("profiles").select("bio_pl, bio_en").eq("id", user.id).maybeSingle(),
          supabase.from("expertise_areas").select("id, name_pl, name_en").order("sort_order"),
          supabase.from("expert_expertise_areas").select("area_id").eq("user_id", user.id),
        ]);
      const canonicalBio = {
        bio_pl: preferCanonicalBio(prof?.bio_pl, row?.bio_pl ?? null),
        bio_en: preferCanonicalBio(prof?.bio_en, row?.bio_en ?? null),
      };
      if (row) {
        const cs = Array.isArray(row.custom_socials)
          ? (row.custom_socials as unknown as CustomSocial[])
          : [];
        const orgFns = Array.isArray(row.org_functions)
          ? (row.org_functions as unknown as OrgFunction[])
          : [];
        setData({
          ...(row as unknown as AuthorProfileRow),
          ...canonicalBio,
          org_functions: orgFns,
          custom_socials: cs,
        });
        setExists(true);
      } else if (prof) {
        setData((d) => ({ ...d, ...canonicalBio }));
      }
      setAreaOptions((areas ?? []) as ExpertiseAreaOption[]);
      setSelectedAreaIds(
        new Set((myAreas ?? []).map((a) => (a as { area_id: string }).area_id)),
      );
      setBulletsPl(bioToBullets(canonicalBio.bio_pl));
      setBulletsEn(bioToBullets(canonicalBio.bio_en));
    })();
  }, [user]);

  if (loading) return null;

  if (!user) return null;

  if (!isAuthorRole(roles)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BrandIcon name="shield-alert" fallback={ShieldAlert} className="h-5 w-5 text-muted-foreground" alt="" />
            {t("profile.author.title", { defaultValue: "Profil eksperta" })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t("profile.author.noRole", {
              defaultValue:
                "Profil eksperta jest dostępny tylko dla użytkowników z rolą autora lub administratora.",
            })}
          </p>
        </CardContent>
      </Card>
    );
  }

  const upload = async (blob: Blob) => {
    if (!user || !tenantId) return;
    if (blob.size > MAX_AVATAR) {
      toast.error(t("profile.account.fileTooLarge"));
      return;
    }
    setUploading(true);
    try {
      const path = `${tenantId}/users/${user.id}/author-avatar-${Date.now()}.jpg`;
      const { data: signed, error: signErr } = await supabase.storage
        .from("media")
        .createSignedUploadUrl(path);
      if (signErr || !signed) throw signErr ?? new Error("sign failed");
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", signed.signedUrl);
        xhr.setRequestHeader("Content-Type", blob.type || "image/jpeg");
        xhr.setRequestHeader("x-upsert", "true");
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error(`HTTP ${xhr.status}`));
        xhr.onerror = () => reject(new Error("network"));
        xhr.send(blob);
      });
      const { data: pub } = supabase.storage.from("media").getPublicUrl(path);
      setData((d) => ({ ...d, avatar_url: pub.publicUrl }));
      toast.success(t("profile.account.uploadSuccess"));
    } catch {
      toast.error(t("profile.account.uploadError"));
    } finally {
      setUploading(false);
    }
  };

  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [cropOpen, setCropOpen] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !tenantId) return;
    setBusy(true);
    const payload = {
      user_id: user.id,
      tenant_id: tenantId,
      avatar_url: data.avatar_url,
      job_title: data.job_title,
      company: data.company,
      full_bio_pl: data.full_bio_pl,
      full_bio_en: data.full_bio_en,
      // Odsiewamy puste funkcje przed zapisem (JSONB [{pl,en}]).
      org_functions: data.org_functions.filter(
        (f) => f.pl.trim() || f.en.trim(),
      ) as unknown as never,
      contact_email: data.contact_email,
      phone: data.phone,
      website_url: data.website_url,
      x_url: data.x_url,
      linkedin_url: data.linkedin_url,
      facebook_url: data.facebook_url,
      instagram_url: data.instagram_url,
      spotify_url: data.spotify_url,
      media_contact_name: data.media_contact_name,
      media_contact_email: data.media_contact_email,
      media_contact_phone: data.media_contact_phone,
      custom_socials: data.custom_socials as unknown as never,
      is_public: data.is_public,
    };
    // Bio zapisujemy do kanonicznego źródła (profiles.bio_pl/bio_en - trigger
    // profiles_mirror_bio utrzymuje legacy profiles.bio). Persona autorska
    // (avatar, kontakt, socials, hub eksperta) zostaje w author_profiles.
    const bioPlOut = bulletsToBio(bulletsPl);
    const bioEnOut = bulletsToBio(bulletsEn);
    const [{ error }, { error: bioError }] = await Promise.all([
      supabase.from("author_profiles").upsert(
        { ...payload, bio_pl: bioPlOut, bio_en: bioEnOut },
        { onConflict: "user_id" },
      ),
      supabase
        .from("profiles")
        .update({ bio_pl: bioPlOut, bio_en: bioEnOut })
        .eq("id", user.id),
    ]);

    // Synchronizacja obszarów ekspertyzy: różnica dodane/usunięte
    // (RLS pozwala właścicielowi zarządzać tylko własnymi wierszami).
    const areaError = await syncExpertiseAreas(user.id, selectedAreaIds);

    setBusy(false);
    if (error || bioError || areaError) {
      toast.error(t("profile.account.saveError"));
      return;
    }
    setExists(true);
    toast.success(t("profile.account.saved"));
    qc.invalidateQueries({ queryKey: ["public", "resolved"] });
    qc.invalidateQueries({ queryKey: ["public", "expert"] });
  };

  const toggleArea = (id: string) => {
    setSelectedAreaIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const updateCustom = (idx: number, patch: Partial<CustomSocial>) => {
    setData((d) => {
      const next = [...d.custom_socials];
      next[idx] = { ...next[idx], ...patch };
      return { ...d, custom_socials: next };
    });
  };

  const removeCustom = (idx: number) => {
    setData((d) => ({
      ...d,
      custom_socials: d.custom_socials.filter((_, i) => i !== idx),
    }));
  };

  const addCustom = () => {
    setData((d) => ({
      ...d,
      custom_socials: [...d.custom_socials, { label: "", url: "" }],
    }));
  };

  const updateOrgFn = (idx: number, patch: Partial<OrgFunction>) => {
    setData((d) => {
      const next = [...d.org_functions];
      next[idx] = { ...next[idx], ...patch };
      return { ...d, org_functions: next };
    });
  };

  const removeOrgFn = (idx: number) => {
    setData((d) => ({ ...d, org_functions: d.org_functions.filter((_, i) => i !== idx) }));
  };

  const addOrgFn = () => {
    setData((d) => ({ ...d, org_functions: [...d.org_functions, { pl: "", en: "" }] }));
  };

  return (
    <TooltipProvider>
      <IdentityEditorsHint current="author" />
      <Card>
        <CardHeader>
          <CardTitle>{t("profile.author.title", { defaultValue: "Profil eksperta" })}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("profile.author.intro", {
              defaultValue:
                "Publiczny profil eksperta - widoczny na /author/<slug> oraz w widget BIO we wpisach. Niezależny od profilu prywatnego (dane kontaktowe mogą się różnić).",
            })}
          </p>
          {layoutSettings && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                Layout, kolory hero, akcent i punktory BIO są dziedziczone z{" "}
                <b>ustawień tenanta</b> (admin › Layouty ekspertów
                {presetLabel ? <> - preset „{presetLabel}"</> : null}). Admin może nadpisać
                pojedyncze pola z poziomu panelu.
              </span>
            </div>
          )}
        </CardHeader>
        <CardContent>
          <form className="grid gap-6" onSubmit={save}>
            {/* Widoczność */}
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
              <div>
                <Label htmlFor="is_public" className="font-semibold">
                  {t("profile.author.isPublic", { defaultValue: "Widoczny publicznie" })}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("profile.author.isPublicHint", {
                    defaultValue: "Wyłączenie ukrywa profil w widget BIO autora we wpisach.",
                  })}
                </p>
              </div>
              <Switch
                id="is_public"
                checked={data.is_public}
                onCheckedChange={(v) => setData({ ...data, is_public: v })}
              />
            </div>

            {/* Avatar */}
          <section className="grid gap-3">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground/80">
                  {t("profile.author.avatarSection", { defaultValue: "Zdjęcie eksperta" })}
                </h3>
                <span className="text-[11px] text-muted-foreground">
                  Rekomendowane: <b>600 × 600 px</b> (kwadrat, JPG/PNG/WebP, do 2 MB)
                </span>
              </div>
              <div className="flex items-center gap-4">
                {data.avatar_url ? (
                  <img
                    src={data.avatar_url}
                    alt=""
                    className="h-20 w-20 rounded-[7px] object-cover"
                  />
                ) : (
                  <div className="grid h-20 w-20 place-items-center rounded-[7px] bg-muted text-xs text-muted-foreground">
                    {t("profile.account.avatarPlaceholder")}
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={uploading}
                    onClick={() => avatarInput.current?.click()}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    {uploading ? t("profile.account.uploading") : t("profile.account.uploadAvatar")}
                  </Button>
                  {data.avatar_url && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setData({ ...data, avatar_url: null })}
                    >
                      {t("common.remove", { defaultValue: "Usuń" })}
                    </Button>
                  )}
                </div>
                <input
                  ref={avatarInput}
                  type="file"
                  accept={ACCEPT}
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setPendingFile(f);
                      setCropOpen(true);
                    }
                    e.target.value = "";
                  }}
                />
                <ImageCropDialog
                  open={cropOpen}
                  file={pendingFile}
                  kind="avatar"
                  preset={CROP_PRESETS.avatar}
                  onOpenChange={(o) => {
                    setCropOpen(o);
                    if (!o) setPendingFile(null);
                  }}
                  onConfirm={(blob) => void upload(blob)}
                />
              </div>
              {/* Odświeżenie podglądu społecznościowego (og:image cache-bust) */}
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
                <div className="text-xs text-muted-foreground">
                  {t("profile.author.ogRefreshHint", {
                    defaultValue:
                      "Po zmianie zdjęcia lub bio odśwież podgląd społecznościowy - wymusi to nowy og:image w linkach.",
                  })}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  disabled={refreshingOg}
                  onClick={() => void onRefreshOg()}
                >
                  <RefreshCcw className={`mr-2 h-4 w-4 ${refreshingOg ? "animate-spin" : ""}`} />
                  {refreshingOg
                    ? t("common.working", { defaultValue: "Odświeżam…" })
                    : t("profile.author.ogRefreshBtn", {
                        defaultValue: "Odśwież podgląd społecznościowy",
                      })}
                </Button>
                {ogDebuggers && (
                  <div className="w-full flex flex-wrap gap-2 pt-1">
                    {(["facebook", "linkedin", "twitter"] as const).map((k) => (
                      <a
                        key={k}
                        href={ogDebuggers[k]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" aria-hidden />
                        {k === "twitter" ? "X (Twitter)" : k.charAt(0).toUpperCase() + k.slice(1)}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Podstawowe */}
            <section className="grid gap-4">
              <h3 className="text-sm font-semibold text-foreground/80">
                {t("profile.author.basicSection", { defaultValue: "Dane zawodowe" })}
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <FieldLabel htmlFor="job_title">{t("profile.account.jobTitle")}</FieldLabel>
                  <Input
                    id="job_title"
                    value={data.job_title ?? ""}
                    onChange={(e) => setData({ ...data, job_title: e.target.value })}
                    maxLength={160}
                  />
                </div>
                <div className="grid gap-2">
                  <FieldLabel htmlFor="company">{t("profile.account.currentCompany")}</FieldLabel>
                  <Input
                    id="company"
                    value={data.company ?? ""}
                    onChange={(e) => setData({ ...data, company: e.target.value })}
                    maxLength={160}
                  />
                </div>
              </div>
              <p className="m-0 text-xs text-muted-foreground">
                {t("profile.author.bioBulletsHint", {
                  defaultValue:
                    "Bio w formie punktorów - maksymalnie 5. Kolor punktora dziedziczony z ustawień tenanta (admin › Layouty ekspertów). Edycja synchronizuje profil prywatny.",
                })}
              </p>
              <BulletEditor
                idPrefix="bio_pl"
                label={t("profile.author.bioPl", { defaultValue: "Bio - punktory (PL)" })}
                bullets={bulletsPl}
                onChange={setBulletsPl}
              />
              <BulletEditor
                idPrefix="bio_en"
                label={t("profile.author.bioEn", { defaultValue: "Bio - punktory (EN)" })}
                bullets={bulletsEn}
                onChange={setBulletsEn}
              />
            </section>

            {/* Hub eksperta: pełna biografia + funkcje + obszary */}
            <section className="grid gap-4">
              <h3 className="text-sm font-semibold text-foreground/80">
                {t("expert.editHubHeading")}
              </h3>
              <div className="grid gap-2">
                <FieldLabel htmlFor="full_bio_pl">{t("expert.fullBioPl")}</FieldLabel>
                <Textarea
                  id="full_bio_pl"
                  value={data.full_bio_pl ?? ""}
                  onChange={(e) => setData({ ...data, full_bio_pl: e.target.value })}
                  maxLength={8000}
                  rows={6}
                />
                <p className="text-xs text-muted-foreground">{t("expert.fullBioHint")}</p>
              </div>
              <div className="grid gap-2">
                <FieldLabel htmlFor="full_bio_en">{t("expert.fullBioEn")}</FieldLabel>
                <Textarea
                  id="full_bio_en"
                  value={data.full_bio_en ?? ""}
                  onChange={(e) => setData({ ...data, full_bio_en: e.target.value })}
                  maxLength={8000}
                  rows={6}
                />
              </div>

              {/* Funkcje organizacyjne */}
              <div className="grid gap-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">{t("expert.orgFunctions")}</Label>
                  <Button type="button" size="sm" variant="outline" onClick={addOrgFn}>
                    <Plus className="mr-1 h-4 w-4" />
                    {t("common.add", { defaultValue: "Dodaj" })}
                  </Button>
                </div>
                <p className="-mt-1 text-xs text-muted-foreground">
                  {t("expert.orgFunctionsHint")}
                </p>
                {data.org_functions.map((f, idx) => (
                  <div
                    key={idx}
                    className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_1fr_auto]"
                  >
                    <Input
                      placeholder={t("expert.orgFunctionPl")}
                      value={f.pl}
                      onChange={(e) => updateOrgFn(idx, { pl: e.target.value })}
                      maxLength={160}
                    />
                    <Input
                      placeholder={t("expert.orgFunctionEn")}
                      value={f.en}
                      onChange={(e) => updateOrgFn(idx, { en: e.target.value })}
                      maxLength={160}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeOrgFn(idx)}
                      aria-label="remove"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>

              {/* Obszary ekspertyzy */}
              {areaOptions.length > 0 && (
                <div className="grid gap-2">
                  <Label className="text-sm font-medium">{t("expert.expertiseHeading")}</Label>
                  <p className="-mt-1 text-xs text-muted-foreground">{t("expert.expertiseHint")}</p>
                  <div className="flex flex-wrap gap-2">
                    {areaOptions.map((a) => {
                      const active = selectedAreaIds.has(a.id);
                      return (
                        <button
                          type="button"
                          key={a.id}
                          onClick={() => toggleArea(a.id)}
                          aria-pressed={active}
                          className={
                            active
                              ? "rounded-full border border-[var(--brand)] bg-[var(--brand)]/10 px-3 py-1 text-sm text-foreground"
                              : "rounded-full border border-border bg-muted/30 px-3 py-1 text-sm text-muted-foreground hover:border-border"
                          }
                        >
                          {i18n.language === "en" ? a.name_en : a.name_pl}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            {/* Kontakt */}
            <section className="grid gap-4">
              <h3 className="text-sm font-semibold text-foreground/80">
                {t("profile.author.contactSection", {
                  defaultValue: "Publiczne dane kontaktowe (mogą się różnić od profilu prywatnego)",
                })}
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <FieldLabel htmlFor="contact_email">
                    {t("profile.author.contactEmail", { defaultValue: "Publiczny e-mail" })}
                  </FieldLabel>
                  <Input
                    id="contact_email"
                    type="email"
                    value={data.contact_email ?? ""}
                    onChange={(e) => setData({ ...data, contact_email: e.target.value })}
                    maxLength={255}
                  />
                </div>
                <div className="grid gap-2">
                  <FieldLabel htmlFor="phone">{t("profile.account.phone")}</FieldLabel>
                  <Input
                    id="phone"
                    type="tel"
                    value={data.phone ?? ""}
                    onChange={(e) => setData({ ...data, phone: e.target.value })}
                    maxLength={32}
                  />
                </div>
                <div className="grid gap-2 sm:col-span-2">
                  <FieldLabel htmlFor="website_url">
                    {t("profile.author.website", { defaultValue: "Strona WWW" })}
                  </FieldLabel>
                  <Input
                    id="website_url"
                    type="url"
                    placeholder="https://..."
                    value={data.website_url ?? ""}
                    onChange={(e) => setData({ ...data, website_url: e.target.value })}
                  />
                </div>
              </div>
            </section>

            {/* Kontakt dla mediów (osobny od bezpośredniego) */}
            <section className="grid gap-4">
              <h3 className="text-sm font-semibold text-foreground/80">
                {t("expert.mediaContactHeading")}
              </h3>
              <p className="-mt-2 text-xs text-muted-foreground">{t("expert.mediaContactHint")}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2 sm:col-span-2">
                  <FieldLabel htmlFor="media_contact_name">
                    {t("expert.mediaContactName")}
                  </FieldLabel>
                  <Input
                    id="media_contact_name"
                    value={data.media_contact_name ?? ""}
                    onChange={(e) => setData({ ...data, media_contact_name: e.target.value })}
                    maxLength={160}
                  />
                </div>
                <div className="grid gap-2">
                  <FieldLabel htmlFor="media_contact_email">
                    {t("expert.mediaContactEmail")}
                  </FieldLabel>
                  <Input
                    id="media_contact_email"
                    type="email"
                    value={data.media_contact_email ?? ""}
                    onChange={(e) => setData({ ...data, media_contact_email: e.target.value })}
                    maxLength={255}
                  />
                </div>
                <div className="grid gap-2">
                  <FieldLabel htmlFor="media_contact_phone">
                    {t("expert.mediaContactPhone")}
                  </FieldLabel>
                  <Input
                    id="media_contact_phone"
                    type="tel"
                    value={data.media_contact_phone ?? ""}
                    onChange={(e) => setData({ ...data, media_contact_phone: e.target.value })}
                    maxLength={32}
                  />
                </div>
              </div>
            </section>

            {/* Social */}
            <section className="grid gap-4">
              <h3 className="text-sm font-semibold text-foreground/80">
                {t("profile.author.socialSection", { defaultValue: "Media społecznościowe" })}
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                {(
                  [
                    ["x_url", "X (x.com)"],
                    ["linkedin_url", "LinkedIn"],
                    ["facebook_url", "Facebook"],
                    ["instagram_url", "Instagram"],
                    ["spotify_url", "Spotify"],
                  ] as const
                ).map(([key, label]) => {
                  const meta = SOCIAL_ICONS[key];
                  return (
                    <div key={key} className="grid gap-2">
                      <FieldLabel htmlFor={key}>
                        <span className="inline-flex items-center gap-2">
                          {meta && (
                            <BrandIcon
                              name={meta.slug}
                              fallback={meta.Fallback}
                              className="h-4 w-4 shrink-0 text-muted-foreground"
                              alt=""
                            />
                          )}
                          {label}
                        </span>
                      </FieldLabel>
                      <Input
                        id={key}
                        type="url"
                        placeholder="https://..."
                        value={data[key] ?? ""}
                        onChange={(e) => setData({ ...data, [key]: e.target.value })}
                      />
                    </div>
                  );
                })}
              </div>

              {/* Custom socials */}
              <div className="grid gap-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">
                    {t("profile.author.customSocials", {
                      defaultValue: "Własne linki (z ikoną)",
                    })}
                  </Label>
                  <Button type="button" size="sm" variant="outline" onClick={addCustom}>
                    <Plus className="mr-1 h-4 w-4" />
                    {t("common.add", { defaultValue: "Dodaj" })}
                  </Button>
                </div>
                {data.custom_socials.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t("profile.author.noCustomSocials", {
                      defaultValue: "Brak własnych linków. Dodaj np. Threads, Bluesky, Mastodon...",
                    })}
                  </p>
                )}
                {data.custom_socials.map((s, idx) => (
                  <div
                    key={idx}
                    className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[auto_1fr_2fr_1fr_auto] sm:items-center"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted/30 text-muted-foreground">
                      {s.iconUrl ? (
                        <img
                          src={s.iconUrl}
                          alt=""
                          className="h-5 w-5 object-contain"
                          loading="lazy"
                          decoding="async"
                          draggable={false}
                        />
                      ) : (
                        <BrandIcon
                          name={s.label || "link"}
                          fallback={LucideLink}
                          className="h-4 w-4"
                          alt=""
                        />
                      )}
                    </div>
                    <Input
                      placeholder={t("profile.author.socialLabel", { defaultValue: "Etykieta" })}
                      value={s.label}
                      onChange={(e) => updateCustom(idx, { label: e.target.value })}
                    />
                    <Input
                      type="url"
                      placeholder="https://..."
                      value={s.url}
                      onChange={(e) => updateCustom(idx, { url: e.target.value })}
                    />
                    <Input
                      placeholder={t("profile.author.iconUrl", {
                        defaultValue: "URL ikony (opcjonalnie)",
                      })}
                      value={s.iconUrl ?? ""}
                      onChange={(e) => updateCustom(idx, { iconUrl: e.target.value })}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeCustom(idx)}
                      aria-label="remove"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </section>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={busy}>
                {exists
                  ? t("profile.account.save")
                  : t("profile.author.create", { defaultValue: "Utwórz profil eksperta" })}
              </Button>
              <Link
                to="/profile/account"
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {t("profile.author.editPrivate", {
                  defaultValue: "Edytuj profil prywatny →",
                })}
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}

/**
 * Edytor punktorów BIO - maksymalnie 5 pozycji. Kolor markerów jest
 * dziedziczony na stronie publicznej (/author/$slug) z `expert_layout_settings`
 * (admin/expert-layouts) via CSS variable `--pv-bio-bullet`.
 */
function BulletEditor({
  idPrefix,
  label,
  bullets,
  onChange,
}: {
  idPrefix: string;
  label: string;
  bullets: string[];
  onChange: (next: string[]) => void;
}) {
  const update = (idx: number, value: string) => {
    const next = [...bullets];
    next[idx] = value;
    onChange(next);
  };
  const remove = (idx: number) => onChange(bullets.filter((_, i) => i !== idx));
  const add = () => {
    if (bullets.length >= MAX_BIO_BULLETS) return;
    onChange([...bullets, ""]);
  };
  const canAdd = bullets.length < MAX_BIO_BULLETS;
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <FieldLabel htmlFor={`${idPrefix}-0`}>{label}</FieldLabel>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {bullets.length}/{MAX_BIO_BULLETS}
        </span>
      </div>
      <ul className="grid gap-2">
        {bullets.map((b, idx) => (
          <li
            key={idx}
            className="flex items-start gap-2 rounded-md border border-border bg-card px-2 py-1.5"
          >
            <span
              aria-hidden
              className="mt-2.5 inline-block h-1.5 w-1.5 shrink-0 rounded-[2px] bg-[var(--brand)]"
            />
            <Input
              id={`${idPrefix}-${idx}`}
              value={b}
              onChange={(e) => update(idx, e.target.value)}
              maxLength={MAX_BULLET_LEN}
              placeholder="Krótki punkt (max 200 znaków)"
              className="h-8 border-0 bg-transparent px-1 focus-visible:ring-0"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => remove(idx)}
              aria-label="remove"
              className="h-7 w-7 shrink-0"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        disabled={!canAdd}
        className="w-fit"
      >
        <Plus className="mr-1 h-4 w-4" />
        Dodaj punktor
      </Button>
    </div>
  );
}
