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
import { Trash2, Plus, Upload, ShieldAlert } from "lucide-react";
import { IdentityEditorsHint } from "@/components/profile/IdentityEditorsHint";
import { preferCanonicalBio } from "@/lib/profile/canonicalBio";

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
  contact_email: string | null;
  phone: string | null;
  website_url: string | null;
  x_url: string | null;
  linkedin_url: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  spotify_url: string | null;
  custom_socials: CustomSocial[];
  is_public: boolean;
}

const EMPTY: AuthorProfileRow = {
  avatar_url: null,
  job_title: null,
  company: null,
  bio_pl: null,
  bio_en: null,
  contact_email: null,
  phone: null,
  website_url: null,
  x_url: null,
  linkedin_url: null,
  facebook_url: null,
  instagram_url: null,
  spotify_url: null,
  custom_socials: [],
  is_public: true,
};

const ACCEPT = "image/jpeg,image/png,image/webp,image/avif";
const MAX_AVATAR = 2 * 1024 * 1024;

function isAuthorRole(roles: string[]): boolean {
  return roles.some((r) => r === "author" || r === "admin" || r === "super_admin");
}

function AuthorProfilePage() {
  const { t } = useTranslation();
  const { user, roles, tenantId, loading } = useAuth();
  const qc = useQueryClient();
  const [data, setData] = useState<AuthorProfileRow>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [exists, setExists] = useState(false);
  const [uploading, setUploading] = useState(false);
  const avatarInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      // Bio przychodzi z kanonicznego źródła (profiles), reszta persony
      // autorskiej z author_profiles. Fallback na legacy author_profiles.bio_*
      // tylko dla kont, które nigdy nie zapisały bio w profiles.
      const [{ data: row }, { data: prof }] = await Promise.all([
        supabase
          .from("author_profiles")
          .select(
            "avatar_url, job_title, company, bio_pl, bio_en, contact_email, phone, website_url, x_url, linkedin_url, facebook_url, instagram_url, spotify_url, custom_socials, is_public",
          )
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase.from("profiles").select("bio_pl, bio_en").eq("id", user.id).maybeSingle(),
      ]);
      const canonicalBio = {
        bio_pl: preferCanonicalBio(prof?.bio_pl, row?.bio_pl ?? null),
        bio_en: preferCanonicalBio(prof?.bio_en, row?.bio_en ?? null),
      };
      if (row) {
        const cs = Array.isArray(row.custom_socials)
          ? (row.custom_socials as unknown as CustomSocial[])
          : [];
        setData({
          ...(row as unknown as AuthorProfileRow),
          ...canonicalBio,
          custom_socials: cs,
        });
        setExists(true);
      } else if (prof) {
        setData((d) => ({ ...d, ...canonicalBio }));
      }
    })();
  }, [user]);

  if (loading) return null;

  if (!user) return null;

  if (!isAuthorRole(roles)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-muted-foreground" />
            {t("profile.author.title", { defaultValue: "Profil autora" })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t("profile.author.noRole", {
              defaultValue:
                "Profil autora jest dostępny tylko dla użytkowników z rolą autora lub administratora.",
            })}
          </p>
        </CardContent>
      </Card>
    );
  }

  const upload = async (file: File) => {
    if (!user || !tenantId) return;
    if (file.size > MAX_AVATAR) {
      toast.error(t("profile.account.fileTooLarge"));
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${tenantId}/users/${user.id}/author-avatar-${Date.now()}.${ext}`;
      const { data: signed, error: signErr } = await supabase.storage
        .from("media")
        .createSignedUploadUrl(path);
      if (signErr || !signed) throw signErr ?? new Error("sign failed");
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", signed.signedUrl);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.setRequestHeader("x-upsert", "true");
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error(`HTTP ${xhr.status}`));
        xhr.onerror = () => reject(new Error("network"));
        xhr.send(file);
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
      contact_email: data.contact_email,
      phone: data.phone,
      website_url: data.website_url,
      x_url: data.x_url,
      linkedin_url: data.linkedin_url,
      facebook_url: data.facebook_url,
      instagram_url: data.instagram_url,
      spotify_url: data.spotify_url,
      custom_socials: data.custom_socials as unknown as never,
      is_public: data.is_public,
    };
    // Bio zapisujemy do kanonicznego źródła (profiles.bio_pl/bio_en - trigger
    // profiles_mirror_bio utrzymuje legacy profiles.bio). Persona autorska
    // (avatar, kontakt, socials) zostaje w author_profiles.
    const [{ error }, { error: bioError }] = await Promise.all([
      supabase.from("author_profiles").upsert(payload, { onConflict: "user_id" }),
      supabase
        .from("profiles")
        .update({ bio_pl: data.bio_pl, bio_en: data.bio_en })
        .eq("id", user.id),
    ]);
    setBusy(false);
    if (error || bioError) {
      toast.error(t("profile.account.saveError"));
      return;
    }
    setExists(true);
    toast.success(t("profile.account.saved"));
    qc.invalidateQueries({ queryKey: ["public", "resolved"] });
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

  return (
    <TooltipProvider>
      <IdentityEditorsHint current="author" />
      <Card>
        <CardHeader>
          <CardTitle>{t("profile.author.title", { defaultValue: "Profil autora" })}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("profile.author.intro", {
              defaultValue:
                "Publiczny profil wyświetlany w widget BIO autora w CMS. Niezależny od profilu prywatnego - dane kontaktowe mogą się różnić.",
            })}
          </p>
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
              <h3 className="text-sm font-semibold text-foreground/80">
                {t("profile.author.avatarSection", { defaultValue: "Zdjęcie autora" })}
              </h3>
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
                    if (f) void upload(f);
                    e.target.value = "";
                  }}
                />
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
                {t("profile.author.bioShared", {
                  defaultValue:
                    "Bio jest wspólne z Twoim profilem (konto / wizytówka) - edycja tutaj aktualizuje je wszędzie.",
                })}
              </p>
              <div className="grid gap-2">
                <FieldLabel htmlFor="bio_pl">
                  {t("profile.author.bioPl", { defaultValue: "Bio (PL)" })}
                </FieldLabel>
                <Textarea
                  id="bio_pl"
                  value={data.bio_pl ?? ""}
                  onChange={(e) => setData({ ...data, bio_pl: e.target.value })}
                  maxLength={1000}
                  rows={4}
                />
              </div>
              <div className="grid gap-2">
                <FieldLabel htmlFor="bio_en">
                  {t("profile.author.bioEn", { defaultValue: "Bio (EN)" })}
                </FieldLabel>
                <Textarea
                  id="bio_en"
                  value={data.bio_en ?? ""}
                  onChange={(e) => setData({ ...data, bio_en: e.target.value })}
                  maxLength={1000}
                  rows={4}
                />
              </div>
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
                ).map(([key, label]) => (
                  <div key={key} className="grid gap-2">
                    <FieldLabel htmlFor={key}>{label}</FieldLabel>
                    <Input
                      id={key}
                      type="url"
                      placeholder="https://..."
                      value={data[key] ?? ""}
                      onChange={(e) => setData({ ...data, [key]: e.target.value })}
                    />
                  </div>
                ))}
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
                    className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_2fr_1fr_auto]"
                  >
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
                  : t("profile.author.create", { defaultValue: "Utwórz profil autora" })}
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
