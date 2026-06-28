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
import { BrandIcon } from "@/components/atoms/BrandIcon";
import { Twitter, Linkedin, Globe } from "lucide-react";

export const Route = createFileRoute("/profile/social")({
  component: SocialPage,
});

interface SocialRow {
  slug: string | null;
  bio_pl: string | null;
  bio_en: string | null;
  twitter_url: string | null;
  linkedin_url: string | null;
  website_url: string | null;
}

const URL_RE = /^https?:\/\/.+/i;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

function SocialPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [data, setData] = useState<SocialRow>({
    slug: "", bio_pl: "", bio_en: "", twitter_url: "", linkedin_url: "", website_url: "",
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void supabase
      .from("profiles")
      .select("slug, bio_pl, bio_en, twitter_url, linkedin_url, website_url")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data: row }) => { if (active && row) setData(row as SocialRow); });
    return () => { active = false; };
  }, [user]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const slug = (data.slug ?? "").trim().toLowerCase() || null;
    if (slug && !SLUG_RE.test(slug)) {
      toast.error("slug: a-z, 0-9, -");
      return;
    }
    for (const [k, v] of [
      ["twitter_url", data.twitter_url], ["linkedin_url", data.linkedin_url], ["website_url", data.website_url],
    ] as const) {
      if (v && !URL_RE.test(v)) {
        toast.error(`${k}: must start with http(s)://`);
        return;
      }
    }
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        slug,
        bio_pl: data.bio_pl ?? null,
        bio_en: data.bio_en ?? null,
        twitter_url: data.twitter_url ?? null,
        linkedin_url: data.linkedin_url ?? null,
        website_url: data.website_url ?? null,
      })
      .eq("id", user.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t("profile.social.saved"));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("profile.social.title")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("profile.social.subtitle")}</p>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 max-w-xl" onSubmit={save}>
          <div className="grid gap-2">
            <Label htmlFor="slug">{t("profile.social.slug")}</Label>
            <Input id="slug" value={data.slug ?? ""} onChange={(e) => setData({ ...data, slug: e.target.value })} maxLength={64} placeholder="jan-kowalski" />
            <p className="text-xs text-muted-foreground">{t("profile.social.slugHint")}</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bio_pl">{t("profile.social.bioPl")}</Label>
            <Textarea id="bio_pl" rows={3} maxLength={1000} value={data.bio_pl ?? ""} onChange={(e) => setData({ ...data, bio_pl: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bio_en">{t("profile.social.bioEn")}</Label>
            <Textarea id="bio_en" rows={3} maxLength={1000} value={data.bio_en ?? ""} onChange={(e) => setData({ ...data, bio_en: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="twitter">{t("profile.social.twitter")}</Label>
            <Input id="twitter" type="url" value={data.twitter_url ?? ""} onChange={(e) => setData({ ...data, twitter_url: e.target.value })} placeholder="https://x.com/..." />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="linkedin">{t("profile.social.linkedin")}</Label>
            <Input id="linkedin" type="url" value={data.linkedin_url ?? ""} onChange={(e) => setData({ ...data, linkedin_url: e.target.value })} placeholder="https://linkedin.com/in/..." />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="website">{t("profile.social.website")}</Label>
            <Input id="website" type="url" value={data.website_url ?? ""} onChange={(e) => setData({ ...data, website_url: e.target.value })} placeholder="https://..." />
          </div>
          <Button type="submit" disabled={busy}>{t("profile.social.save")}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
