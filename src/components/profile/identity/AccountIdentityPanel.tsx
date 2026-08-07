// Panel "Dane podstawowe" skonsolidowanej edycji tożsamości (/profile/edit).
// Wyodrębnione 1:1 z dawnej trasy /profile/account (teraz przekierowanie) -
// zachowanie bez zmian: RPC get_own_profile, update profiles, avatar/cover
// z kadrowaniem, sekcja prywatności/powiadomień.
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FieldLabel } from "@/components/profile/FieldLabel";
import { ProfileMediaPreview } from "@/components/profile/ProfileMediaPreview";
import { Lock, ArrowRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ImageCropDialog, CROP_PRESETS } from "@/components/media/ImageCropDialog";

type Gender = "male" | "female" | "neutral";

interface ProfileRow {
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  current_company: string | null;
  location: string | null;
  phone: string | null;
  bio: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  tenant_id: string | null;
  gender: Gender | null;
}

const ACCEPT = "image/jpeg,image/png,image/webp,image/avif";
const MAX_AVATAR = 2 * 1024 * 1024;
const MAX_COVER = 5 * 1024 * 1024;

/** Wskazówka nawigacyjna do huba prywatności - jedyny ślad po sekcji, która
 *  mieszkała w tym formularzu do 06.08. */
function PrivacyHubHint() {
  const { t } = useTranslation();
  return (
    <Link
      to="/profile/privacy"
      className="flex items-start gap-3 rounded-[6px] border border-border/60 bg-muted/30 px-4 py-3 transition-colors hover:bg-muted/60"
    >
      <span
        aria-hidden
        className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
      >
        <Lock className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium leading-snug">
          {t("profile.account.privacyHintTitle")}
        </span>
        <span className="mt-1 block text-xs leading-snug text-muted-foreground">
          {t("profile.account.privacyHintBody")}
        </span>
      </span>
      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

export function AccountIdentityPanel() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [data, setData] = useState<ProfileRow>({
    display_name: "",
    first_name: "",
    last_name: "",
    job_title: "",
    current_company: "",
    location: "",
    phone: "",
    bio: "",
    avatar_url: "",
    cover_url: "",
    tenant_id: null,
    gender: null,
  });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<"avatar" | "cover" | null>(null);
  const [progress, setProgress] = useState<Record<"avatar" | "cover", number>>({
    avatar: 0,
    cover: 0,
  });
  const [status, setStatus] = useState<
    Record<"avatar" | "cover", "idle" | "uploading" | "success" | "failed">
  >({
    avatar: "idle",
    cover: "idle",
  });
  const avatarInput = useRef<HTMLInputElement | null>(null);
  const coverInput = useRef<HTMLInputElement | null>(null);
  const [cropKind, setCropKind] = useState<"avatar" | "cover" | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const refresh = async (uid: string) => {
    // Own-row read via SECURITY DEFINER RPC (hard-scoped to auth.uid()) instead
    // of a direct profiles select: the personal PII columns (contact_email,
    // phone, gender, location) are no longer granted to `authenticated`
    // role-wide, so they can only be read for one's own row through this RPC.
    const { data: ownRows } = await supabase.rpc("get_own_profile");
    const row = ownRows?.[0];
    if (!row) return;

    // Prefill empty profile fields from auth signup metadata
    const meta = (user?.user_metadata ?? {}) as Record<string, string | undefined>;
    const nameFromFull = (meta.full_name ?? meta.name ?? "").trim();
    const fullParts = nameFromFull.split(/\s+/).filter(Boolean);
    const metaFirst = meta.first_name || meta.given_name || fullParts[0] || "";
    const metaLast =
      meta.last_name ||
      meta.family_name ||
      (fullParts.length > 1 ? fullParts.slice(1).join(" ") : "");
    const metaDisplay = meta.display_name || meta.name || nameFromFull || "";
    const metaAvatar = meta.avatar_url || meta.picture || "";

    const rowBioPl = (row as { bio_pl?: string | null }).bio_pl;
    const merged: ProfileRow = {
      ...(row as ProfileRow),
      first_name: row.first_name || metaFirst || null,
      last_name: row.last_name || metaLast || null,
      display_name: row.display_name || metaDisplay || null,
      avatar_url: row.avatar_url || metaAvatar || null,
      // Canonical bio = bio_pl (fallback to legacy single-language `bio`).
      bio: rowBioPl ?? row.bio ?? null,
    };
    setData(merged);

    // Persist auto-prefilled values so they show across the platform
    const patch: {
      first_name?: string;
      last_name?: string;
      display_name?: string;
      avatar_url?: string;
    } = {};
    if (!row.first_name && metaFirst) patch.first_name = metaFirst;
    if (!row.last_name && metaLast) patch.last_name = metaLast;
    if (!row.display_name && metaDisplay) patch.display_name = metaDisplay;
    if (!row.avatar_url && metaAvatar) patch.avatar_url = metaAvatar;
    if (Object.keys(patch).length > 0) {
      await supabase.from("profiles").update(patch).eq("id", uid);
    }
  };

  useEffect(() => {
    if (!user) return;
    void refresh(user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const upload = async (blob: Blob, kind: "avatar" | "cover") => {
    if (!user || !data.tenant_id) return;
    const max = kind === "avatar" ? MAX_AVATAR : MAX_COVER;
    if (blob.size > max) {
      setStatus((s) => ({ ...s, [kind]: "failed" }));
      toast.error(t("profile.account.fileTooLarge"));
      return;
    }
    setUploading(kind);
    setStatus((s) => ({ ...s, [kind]: "uploading" }));
    setProgress((p) => ({ ...p, [kind]: 0 }));

    const ext = "jpg";
    const path = `${data.tenant_id}/users/${user.id}/${kind}-${Date.now()}.${ext}`;

    try {
      // Signed upload URL gives us real progress via XHR
      const { data: signed, error: signErr } = await supabase.storage
        .from("media")
        .createSignedUploadUrl(path);
      if (signErr || !signed) throw signErr ?? new Error("sign failed");

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", signed.signedUrl);
        xhr.setRequestHeader("Content-Type", blob.type || "image/jpeg");
        xhr.setRequestHeader("x-upsert", "true");
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable) {
            setProgress((p) => ({ ...p, [kind]: Math.round((evt.loaded / evt.total) * 100) }));
          }
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error(`HTTP ${xhr.status}`));
        xhr.onerror = () => reject(new Error("network"));
        xhr.send(blob);
      });

      const { data: pub } = supabase.storage.from("media").getPublicUrl(path);
      const publicUrl = pub.publicUrl;
      const patch = kind === "avatar" ? { avatar_url: publicUrl } : { cover_url: publicUrl };

      const { error: updErr } = await supabase.from("profiles").update(patch).eq("id", user.id);
      if (updErr) throw updErr;

      setProgress((p) => ({ ...p, [kind]: 100 }));
      setStatus((s) => ({ ...s, [kind]: "success" }));
      await refresh(user.id);
      toast.success(t("profile.account.uploadSuccess"));
    } catch {
      setStatus((s) => ({ ...s, [kind]: "failed" }));
      toast.error(t("profile.account.uploadError"));
    } finally {
      setUploading(null);
    }
  };

  const qc = useQueryClient();

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: data.display_name,
        first_name: data.first_name,
        last_name: data.last_name,
        job_title: data.job_title,
        current_company: data.current_company,
        location: data.location,
        phone: data.phone,
        // Canonical localized bio (mirror trigger keeps legacy `bio` in sync);
        // keeps this editor consistent with /profile/social and public pages.
        bio_pl: data.bio,
        avatar_url: data.avatar_url,
        cover_url: data.cover_url,
        gender: data.gender,
      })
      .eq("id", user.id);
    setBusy(false);
    if (error) {
      toast.error(t("profile.account.saveError"));
      return;
    }
    toast.success(t("profile.account.saved"));
    qc.invalidateQueries({ queryKey: ["header-profile", user.id] });
    qc.invalidateQueries({ queryKey: ["greeting", user.id] });
    // Refresh the profile sidebar (name + initials), which reads its own query.
    qc.invalidateQueries({ queryKey: ["profile-sidebar", user.id] });
  };

  return (
    <TooltipProvider>
      <Card>
        <CardHeader>
          <CardTitle>{t("profile.nav.account")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-5" onSubmit={save}>
            {/* Prywatność i widoczność przeniosły się do huba /profile/privacy
                (§10 audytu IA). Mieszkały tutaj, w środku formularza tożsamości,
                pod przyciskiem „Zapisz", którego wcale nie dotyczyły - każdy
                przełącznik zapisywał się od razu własną mutacją. Zostaje
                wskazówka, żeby nikt nie szukał ich tu na oślep. */}
            <PrivacyHubHint />

            {/* Personal */}
            <section className="grid gap-4">
              <h3 className="text-sm font-semibold text-foreground/80">
                {t("profile.account.personalSection")}
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <FieldLabel htmlFor="first_name" tip={t("profile.account.tip.firstName")}>
                    {t("profile.account.firstName")}
                  </FieldLabel>
                  <Input
                    id="first_name"
                    value={data.first_name ?? ""}
                    onChange={(e) => setData({ ...data, first_name: e.target.value })}
                    maxLength={80}
                  />
                </div>
                <div className="grid gap-2">
                  <FieldLabel htmlFor="last_name" tip={t("profile.account.tip.lastName")}>
                    {t("profile.account.lastName")}
                  </FieldLabel>
                  <Input
                    id="last_name"
                    value={data.last_name ?? ""}
                    onChange={(e) => setData({ ...data, last_name: e.target.value })}
                    maxLength={80}
                  />
                </div>
                <div className="grid gap-2">
                  <FieldLabel htmlFor="job_title" tip={t("profile.account.tip.jobTitle")}>
                    {t("profile.account.jobTitle")}
                  </FieldLabel>
                  <Input
                    id="job_title"
                    value={data.job_title ?? ""}
                    onChange={(e) => setData({ ...data, job_title: e.target.value })}
                    maxLength={120}
                  />
                </div>
                <div className="grid gap-2">
                  <FieldLabel
                    htmlFor="current_company"
                    tip={t("profile.account.tip.currentCompany")}
                  >
                    {t("profile.account.currentCompany")}
                  </FieldLabel>
                  <Input
                    id="current_company"
                    value={data.current_company ?? ""}
                    onChange={(e) => setData({ ...data, current_company: e.target.value })}
                    maxLength={160}
                  />
                </div>
                <div className="grid gap-2">
                  <FieldLabel htmlFor="location" tip={t("profile.account.tip.location")}>
                    {t("profile.account.location")}
                  </FieldLabel>
                  <Input
                    id="location"
                    value={data.location ?? ""}
                    onChange={(e) => setData({ ...data, location: e.target.value })}
                    maxLength={160}
                    placeholder={t("profile.account.locationPh")}
                  />
                </div>
                <div className="grid gap-2">
                  <FieldLabel htmlFor="phone" tip={t("profile.account.tip.phone")}>
                    {t("profile.account.phone")}
                  </FieldLabel>
                  <Input
                    id="phone"
                    type="tel"
                    value={data.phone ?? ""}
                    onChange={(e) => setData({ ...data, phone: e.target.value })}
                    maxLength={32}
                    placeholder={t("profile.account.phonePh")}
                  />
                </div>
                <div className="grid gap-2">
                  <FieldLabel htmlFor="gender" tip={t("profile.account.genderHint")}>
                    {t("profile.account.gender")}
                  </FieldLabel>
                  <Select
                    value={data.gender ?? "auto"}
                    onValueChange={(v) =>
                      setData({ ...data, gender: v === "auto" ? null : (v as Gender) })
                    }
                  >
                    <SelectTrigger id="gender">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">{t("profile.account.genderAuto")}</SelectItem>
                      <SelectItem value="female">{t("profile.account.genderFemale")}</SelectItem>
                      <SelectItem value="male">{t("profile.account.genderMale")}</SelectItem>
                      <SelectItem value="neutral">{t("profile.account.genderNeutral")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            {/* Contact */}
            <section className="grid gap-4">
              <h3 className="text-sm font-semibold text-foreground/80">
                {t("profile.account.contactSection")}
              </h3>
              <div className="grid gap-2">
                <FieldLabel htmlFor="email" tip={t("profile.account.tip.email")}>
                  {t("profile.account.email")}
                </FieldLabel>
                <Input id="email" type="email" value={user?.email ?? ""} readOnly disabled />
                <p className="text-xs text-muted-foreground">
                  {t("profile.account.emailReadonly")}
                </p>
              </div>
              <div className="grid gap-2">
                <FieldLabel
                  htmlFor="display_name"
                  tip={t("profile.account.tip.displayName")}
                  hint={t("profile.account.displayNameAlt")}
                >
                  {t("profile.account.displayName")}
                </FieldLabel>
                <Input
                  id="display_name"
                  value={data.display_name ?? ""}
                  onChange={(e) => setData({ ...data, display_name: e.target.value })}
                  maxLength={120}
                />
              </div>
              <div className="grid gap-2">
                <FieldLabel htmlFor="bio" tip={t("profile.account.tip.bio")}>
                  {t("profile.account.bio")}
                </FieldLabel>
                <Textarea
                  id="bio"
                  value={data.bio ?? ""}
                  onChange={(e) => setData({ ...data, bio: e.target.value })}
                  maxLength={500}
                  rows={4}
                />
              </div>
            </section>

            {/* Media preview */}
            <section className="grid gap-4">
              <h3 className="text-sm font-semibold text-foreground/80">
                {t("profile.account.mediaSection")}
              </h3>
              <ProfileMediaPreview
                firstName={data.first_name}
                lastName={data.last_name}
                displayName={data.display_name}
                jobTitle={data.job_title}
                currentCompany={data.current_company}
                location={data.location}
                bio={data.bio}
                avatarUrl={data.avatar_url}
                coverUrl={data.cover_url}
                uploading={uploading}
                progress={progress}
                status={status}
                onAvatarUrlChange={(url) => setData({ ...data, avatar_url: url })}
                onCoverUrlChange={(url) => setData({ ...data, cover_url: url })}
                onAvatarUploadClick={() => avatarInput.current?.click()}
                onCoverUploadClick={() => coverInput.current?.click()}
                t={t}
              />
              {/* Hidden file inputs triggered by the preview component */}
              <input
                ref={avatarInput}
                type="file"
                accept={ACCEPT}
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setPendingFile(f);
                    setCropKind("avatar");
                  }
                  e.target.value = "";
                }}
              />
              <input
                ref={coverInput}
                type="file"
                accept={ACCEPT}
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setPendingFile(f);
                    setCropKind("cover");
                  }
                  e.target.value = "";
                }}
              />
              <ImageCropDialog
                open={cropKind !== null}
                file={pendingFile}
                kind={cropKind ?? "avatar"}
                preset={CROP_PRESETS[cropKind ?? "avatar"]}
                onOpenChange={(o) => {
                  if (!o) {
                    setCropKind(null);
                    setPendingFile(null);
                  }
                }}
                onConfirm={(blob) => {
                  const k = cropKind;
                  if (k) void upload(blob, k);
                }}
              />
            </section>

            <Button type="submit" disabled={busy} title={t("profile.account.tip.save")}>
              {t("profile.account.save")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
