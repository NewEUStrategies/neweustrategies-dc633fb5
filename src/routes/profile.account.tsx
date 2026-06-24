import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
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
}

function AccountPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [data, setData] = useState<ProfileRow>({ display_name: "", bio: "", avatar_url: "", cover_url: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void supabase
      .from("profiles")
      .select("display_name, bio, avatar_url, cover_url")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data: row }) => {
        if (active && row) setData(row as ProfileRow);
      });
    return () => { active = false; };
  }, [user]);

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
          <div className="grid gap-2">
            <Label htmlFor="avatar">{t("profile.account.avatar")}</Label>
            <Input
              id="avatar"
              value={data.avatar_url ?? ""}
              onChange={(e) => setData({ ...data, avatar_url: e.target.value })}
              placeholder="https://..."
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="cover">{t("profile.account.cover")}</Label>
            <Input
              id="cover"
              value={data.cover_url ?? ""}
              onChange={(e) => setData({ ...data, cover_url: e.target.value })}
              placeholder="https://..."
            />
          </div>
          <Button type="submit" disabled={busy}>{t("profile.account.save")}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
