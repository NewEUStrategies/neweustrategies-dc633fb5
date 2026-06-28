import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/profile/account")({
  component: AccountPage,
});

interface ProfileRow {
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  tenant_id: string | null;
}

const ACCEPT = "image/jpeg,image/png,image/webp,image/avif";
const MAX_AVATAR = 2 * 1024 * 1024;
const MAX_COVER = 5 * 1024 * 1024;

function AccountPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [data, setData] = useState<ProfileRow>({
    display_name: "",
    bio: "",
    avatar_url: "",
    cover_url: "",
    tenant_id: null,
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
      .select("display_name, bio, avatar_url, cover_url, tenant_id")
      .eq("id", uid)
      .maybeSingle();
    if (row) setData(row as ProfileRow);
  };

  useEffect(() => {
    if (!user) return;
    void refresh(user.id);
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
    <Card>
      <CardHeader>
        <CardTitle>{t("profile.nav.account")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 max-w-lg" onSubmit={save}>
          <div className="grid gap-2">
            <Label htmlFor="email">{t("profile.account.email")}</Label>
            <Input id="email" type="email" value={user?.email ?? ""} readOnly disabled />
            <p className="text-xs text-muted-foreground">{t("profile.account.emailReadonly")}</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="display_name">{t("profile.account.displayName")}</Label>
            <Input
              id="display_name"
              value={data.display_name ?? ""}
              onChange={(e) => setData({ ...data, display_name: e.target.value })}
              maxLength={120}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bio">{t("profile.account.bio")}</Label>
            <Textarea
              id="bio"
              value={data.bio ?? ""}
              onChange={(e) => setData({ ...data, bio: e.target.value })}
              maxLength={500}
              rows={4}
            />
          </div>

          {/* Avatar */}
          <div className="grid gap-2">
            <Label htmlFor="avatar">{t("profile.account.avatar")}</Label>
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
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t("profile.account.avatarHint")}</p>
          </div>

          {/* Cover */}
          <div className="grid gap-2">
            <Label htmlFor="cover">{t("profile.account.cover")}</Label>
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
            <p className="text-xs text-muted-foreground">{t("profile.account.coverHint")}</p>
          </div>

          <Button type="submit" disabled={busy}>{t("profile.account.save")}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
