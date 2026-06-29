import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FieldLabel } from "@/components/profile/FieldLabel";
import { toast } from "sonner";

function StatusBadge({ status, percent, t }: { status: "idle" | "uploading" | "success" | "failed"; percent: number; t: (k: string, v?: Record<string, unknown>) => string }) {
  if (status === "idle") return null;
  if (status === "uploading") {
    return (
      <div className="grid gap-1">
        <Progress value={percent} className="h-1.5" />
        <p className="text-xs text-muted-foreground" aria-live="polite">{t("profile.account.uploadProgress", { percent })}</p>
      </div>
    );
  }
  const cls = status === "success" ? "text-green-600 dark:text-green-400" : "text-destructive";
  return (
    <p className={`text-xs ${cls}`} role="status" aria-live="polite">
      {t(status === "success" ? "profile.account.uploadSuccess" : "profile.account.uploadFailed")}
    </p>
  );
}

export const Route = createFileRoute("/profile/account")({
  component: AccountPage,
});

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

function AccountPage() {
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
  const [progress, setProgress] = useState<Record<"avatar" | "cover", number>>({ avatar: 0, cover: 0 });
  const [status, setStatus] = useState<Record<"avatar" | "cover", "idle" | "uploading" | "success" | "failed">>({
    avatar: "idle",
    cover: "idle",
  });
  const avatarInput = useRef<HTMLInputElement | null>(null);
  const coverInput = useRef<HTMLInputElement | null>(null);

  const refresh = async (uid: string) => {
    const { data: row } = await supabase
      .from("profiles")
      .select("display_name, first_name, last_name, job_title, current_company, location, phone, bio, avatar_url, cover_url, tenant_id")
      .eq("id", uid)
      .maybeSingle();
    if (!row) return;

    // Prefill empty profile fields from auth signup metadata
    const meta = (user?.user_metadata ?? {}) as Record<string, string | undefined>;
    const nameFromFull = (meta.full_name ?? meta.name ?? "").trim();
    const fullParts = nameFromFull.split(/\s+/).filter(Boolean);
    const metaFirst = meta.first_name || meta.given_name || fullParts[0] || "";
    const metaLast = meta.last_name || meta.family_name || (fullParts.length > 1 ? fullParts.slice(1).join(" ") : "");
    const metaDisplay = meta.display_name || meta.name || nameFromFull || "";
    const metaAvatar = meta.avatar_url || meta.picture || "";

    const merged: ProfileRow = {
      ...(row as ProfileRow),
      first_name: row.first_name || metaFirst || null,
      last_name: row.last_name || metaLast || null,
      display_name: row.display_name || metaDisplay || null,
      avatar_url: row.avatar_url || metaAvatar || null,
    };
    setData(merged);

    // Persist auto-prefilled values so they show across the platform
    const patch: { first_name?: string; last_name?: string; display_name?: string; avatar_url?: string } = {};
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


  const upload = async (file: File, kind: "avatar" | "cover") => {
    if (!user || !data.tenant_id) return;
    const max = kind === "avatar" ? MAX_AVATAR : MAX_COVER;
    if (file.size > max) {
      setStatus((s) => ({ ...s, [kind]: "failed" }));
      toast.error(t("profile.account.fileTooLarge"));
      return;
    }
    setUploading(kind);
    setStatus((s) => ({ ...s, [kind]: "uploading" }));
    setProgress((p) => ({ ...p, [kind]: 0 }));

    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
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
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.setRequestHeader("x-upsert", "true");
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable) {
            setProgress((p) => ({ ...p, [kind]: Math.round((evt.loaded / evt.total) * 100) }));
          }
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`)));
        xhr.onerror = () => reject(new Error("network"));
        xhr.send(file);
      });

      const { data: pub } = supabase.storage.from("media").getPublicUrl(path);
      const publicUrl = pub.publicUrl;
      const patch = kind === "avatar" ? { avatar_url: publicUrl } : { cover_url: publicUrl };

      const { error: updErr } = await supabase
        .from("profiles")
        .update(patch)
        .eq("id", user.id);
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
        bio: data.bio,
        avatar_url: data.avatar_url,
        cover_url: data.cover_url,
      })
      .eq("id", user.id);
    setBusy(false);
    if (error) {
      toast.error(t("profile.account.saveError"));
      return;
    }
    toast.success(t("profile.account.saved"));
  };


  return (
    <TooltipProvider>
    <Card>
      <CardHeader>
        <CardTitle>{t("profile.nav.account")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-5" onSubmit={save}>
          {/* Personal */}
          <section className="grid gap-4">
            <h3 className="text-sm font-semibold text-foreground/80">{t("profile.account.personalSection")}</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <FieldLabel htmlFor="first_name" tip={t("profile.account.tip.firstName")}>{t("profile.account.firstName")}</FieldLabel>
                <Input id="first_name" value={data.first_name ?? ""} onChange={(e) => setData({ ...data, first_name: e.target.value })} maxLength={80} />
              </div>
              <div className="grid gap-2">
                <FieldLabel htmlFor="last_name" tip={t("profile.account.tip.lastName")}>{t("profile.account.lastName")}</FieldLabel>
                <Input id="last_name" value={data.last_name ?? ""} onChange={(e) => setData({ ...data, last_name: e.target.value })} maxLength={80} />
              </div>
              <div className="grid gap-2">
                <FieldLabel htmlFor="job_title" tip={t("profile.account.tip.jobTitle")}>{t("profile.account.jobTitle")}</FieldLabel>
                <Input id="job_title" value={data.job_title ?? ""} onChange={(e) => setData({ ...data, job_title: e.target.value })} maxLength={120} />
              </div>
              <div className="grid gap-2">
                <FieldLabel htmlFor="current_company" tip={t("profile.account.tip.currentCompany")}>{t("profile.account.currentCompany")}</FieldLabel>
                <Input id="current_company" value={data.current_company ?? ""} onChange={(e) => setData({ ...data, current_company: e.target.value })} maxLength={160} />
              </div>
              <div className="grid gap-2">
                <FieldLabel htmlFor="location" tip={t("profile.account.tip.location")}>{t("profile.account.location")}</FieldLabel>
                <Input id="location" value={data.location ?? ""} onChange={(e) => setData({ ...data, location: e.target.value })} maxLength={160} placeholder={t("profile.account.locationPh")} />
              </div>
              <div className="grid gap-2">
                <FieldLabel htmlFor="phone" tip={t("profile.account.tip.phone")}>{t("profile.account.phone")}</FieldLabel>
                <Input id="phone" type="tel" value={data.phone ?? ""} onChange={(e) => setData({ ...data, phone: e.target.value })} maxLength={32} placeholder={t("profile.account.phonePh")} />
              </div>
            </div>
          </section>

          {/* Contact */}
          <section className="grid gap-4">
            <h3 className="text-sm font-semibold text-foreground/80">{t("profile.account.contactSection")}</h3>
            <div className="grid gap-2">
              <FieldLabel htmlFor="email" tip={t("profile.account.tip.email")}>{t("profile.account.email")}</FieldLabel>
              <Input id="email" type="email" value={user?.email ?? ""} readOnly disabled />
              <p className="text-xs text-muted-foreground">{t("profile.account.emailReadonly")}</p>
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
              <FieldLabel htmlFor="bio" tip={t("profile.account.tip.bio")}>{t("profile.account.bio")}</FieldLabel>
              <Textarea
                id="bio"
                value={data.bio ?? ""}
                onChange={(e) => setData({ ...data, bio: e.target.value })}
                maxLength={500}
                rows={4}
              />
            </div>
          </section>

          {/* Avatar */}

          <div className="grid gap-2">
            <FieldLabel htmlFor="avatar" tip={t("profile.account.tip.avatar")}>{t("profile.account.avatar")}</FieldLabel>
            <div className="flex items-center gap-3">
              {data.avatar_url ? (
                <img
                  src={data.avatar_url}
                  alt=""
                  className="h-16 w-16 object-cover border border-border"
                  style={{ borderRadius: "6px" }}
                />
              ) : (
                <div
                  className="h-16 w-16 bg-muted border border-border"
                  style={{ borderRadius: "6px" }}
                />
              )}
              <div className="flex-1 grid gap-2">
                <Input
                  id="avatar"
                  value={data.avatar_url ?? ""}
                  onChange={(e) => setData({ ...data, avatar_url: e.target.value })}
                  placeholder="https://..."
                />
                <div className="flex items-center gap-2">
                  <input
                    ref={avatarInput}
                    type="file"
                    accept={ACCEPT}
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void upload(f, "avatar");
                      e.target.value = "";
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => avatarInput.current?.click()}
                    disabled={uploading === "avatar"}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    {uploading === "avatar" ? t("profile.account.uploading") : t("profile.account.uploadAvatar")}
                  </Button>
                </div>
                <StatusBadge status={status.avatar} percent={progress.avatar} t={t} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t("profile.account.avatarHint")}</p>
          </div>


          {/* Cover */}
          <div className="grid gap-2">
            <FieldLabel htmlFor="cover" tip={t("profile.account.tip.cover")}>{t("profile.account.cover")}</FieldLabel>
            {data.cover_url ? (
              <img
                src={data.cover_url}
                alt=""
                className="w-full aspect-[3/1] object-cover border border-border rounded-md"
              />
            ) : (
              <div className="w-full aspect-[3/1] bg-muted border border-border rounded-md" />
            )}
            <Input
              id="cover"
              value={data.cover_url ?? ""}
              onChange={(e) => setData({ ...data, cover_url: e.target.value })}
              placeholder="https://..."
            />
            <div className="flex items-center gap-2">
              <input
                ref={coverInput}
                type="file"
                accept={ACCEPT}
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f, "cover");
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => coverInput.current?.click()}
                disabled={uploading === "cover"}
              >
                <Upload className="h-4 w-4 mr-2" />
                {uploading === "cover" ? t("profile.account.uploading") : t("profile.account.uploadCover")}
              </Button>
            </div>
            <StatusBadge status={status.cover} percent={progress.cover} t={t} />
            <p className="text-xs text-muted-foreground">{t("profile.account.coverHint")}</p>
          </div>

          <Button type="submit" disabled={busy} title={t("profile.account.tip.save")}>{t("profile.account.save")}</Button>
        </form>
      </CardContent>
    </Card>
    </TooltipProvider>
  );
}
