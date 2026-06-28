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
import { Twitter, Linkedin, Globe, Facebook, Instagram, Music2, Mail } from "lucide-react";

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
  facebook_url: string | null;
  instagram_url: string | null;
  spotify_url: string | null;
  contact_email: string | null;
}

const URL_RE = /^https?:\/\/.+/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

function SocialPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [data, setData] = useState<SocialRow>({
    slug: "", bio_pl: "", bio_en: "",
    twitter_url: "", linkedin_url: "", website_url: "",
    facebook_url: "", instagram_url: "", spotify_url: "", contact_email: "",
  });
  const [busy, setBusy] = useState(false);
  // Track whether slug is "owned" by user (manually edited) or auto-synced.
  const [slugManual, setSlugManual] = useState(false);
  // Source string we auto-derive from: "first last" || display_name || email-local.
  const [autoSource, setAutoSource] = useState("");

  useEffect(() => {
    if (!user) return;
    let active = true;
    void supabase
      .from("profiles")
      .select("slug, bio_pl, bio_en, twitter_url, linkedin_url, website_url, facebook_url, instagram_url, spotify_url, contact_email, display_name, first_name, last_name")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data: row }) => {
        if (!active || !row) return;
        const r = row as SocialRow & {
          display_name?: string | null;
          first_name?: string | null;
          last_name?: string | null;
        };
        const nameParts = [r.first_name, r.last_name].filter((p): p is string => !!p && p.trim().length > 0).join(" ").trim();
        const base = nameParts || r.display_name?.trim() || user.email?.split("@")[0] || "";
        const autoSlug = slugify(base);
        const storedSlug = (r.slug ?? "").trim();
        // If stored slug matches what we'd auto-generate (or is empty), treat as auto.
        const isManual = storedSlug.length > 0 && storedSlug !== autoSlug;
        setAutoSource(base);
        setSlugManual(isManual);
        setData({
          slug: storedSlug || autoSlug,
          bio_pl: r.bio_pl, bio_en: r.bio_en,
          twitter_url: r.twitter_url, linkedin_url: r.linkedin_url, website_url: r.website_url,
          facebook_url: r.facebook_url, instagram_url: r.instagram_url, spotify_url: r.spotify_url,
          contact_email: r.contact_email,
        });
      });
    return () => { active = false; };
  }, [user]);

  // Re-sync slug live if the user updates name fields in another tab (BroadcastChannel-free fallback: poll on focus).
  useEffect(() => {
    if (!user || slugManual) return;
    const onFocus = async () => {
      const { data: row } = await supabase
        .from("profiles")
        .select("display_name, first_name, last_name")
        .eq("id", user.id)
        .maybeSingle();
      if (!row) return;
      const r = row as { display_name?: string | null; first_name?: string | null; last_name?: string | null };
      const nameParts = [r.first_name, r.last_name].filter((p): p is string => !!p && p.trim().length > 0).join(" ").trim();
      const base = nameParts || r.display_name?.trim() || "";
      if (!base || base === autoSource) return;
      setAutoSource(base);
      setData((d) => ({ ...d, slug: slugify(base) }));
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [user, slugManual, autoSource]);

  const onSlugChange = (value: string) => {
    setSlugManual(true);
    setData({ ...data, slug: value });
  };

  const resetSlugAuto = () => {
    setSlugManual(false);
    setData({ ...data, slug: slugify(autoSource) });
  };


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
      ["facebook_url", data.facebook_url], ["instagram_url", data.instagram_url], ["spotify_url", data.spotify_url],
    ] as const) {
      if (v && !URL_RE.test(v)) {
        toast.error(`${k}: must start with http(s)://`);
        return;
      }
    }
    if (data.contact_email && !EMAIL_RE.test(data.contact_email)) {
      toast.error("contact_email: invalid format");
      return;
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
        facebook_url: data.facebook_url ?? null,
        instagram_url: data.instagram_url ?? null,
        spotify_url: data.spotify_url ?? null,
        contact_email: data.contact_email ?? null,
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
            <Input id="slug" value={data.slug ?? ""} onChange={(e) => onSlugChange(e.target.value)} maxLength={64} placeholder="jan-kowalski" />
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{t("profile.social.slugHint")}</p>
              {slugManual && autoSource ? (
                <button type="button" onClick={resetSlugAuto} className="text-xs text-primary hover:underline">
                  {t("profile.social.slugReset", { defaultValue: "Auto z imienia i nazwiska" })}
                </button>
              ) : null}
            </div>
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
            <Label htmlFor="twitter" className="flex items-center gap-2">
              <BrandIcon name="x" fallback={Twitter} className="h-4 w-4" alt="X / Twitter" />
              {t("profile.social.twitter")}
            </Label>
            <Input id="twitter" type="url" value={data.twitter_url ?? ""} onChange={(e) => setData({ ...data, twitter_url: e.target.value })} placeholder="https://x.com/..." />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="linkedin" className="flex items-center gap-2">
              <BrandIcon name="linkedin" fallback={Linkedin} className="h-4 w-4" alt="LinkedIn" />
              {t("profile.social.linkedin")}
            </Label>
            <Input id="linkedin" type="url" value={data.linkedin_url ?? ""} onChange={(e) => setData({ ...data, linkedin_url: e.target.value })} placeholder="https://linkedin.com/in/..." />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="website" className="flex items-center gap-2">
              <BrandIcon name="website" fallback={Globe} className="h-4 w-4" alt="Website" />
              {t("profile.social.website")}
            </Label>
            <Input id="website" type="url" value={data.website_url ?? ""} onChange={(e) => setData({ ...data, website_url: e.target.value })} placeholder="https://..." />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="facebook" className="flex items-center gap-2">
              <BrandIcon name="facebook" fallback={Facebook} className="h-4 w-4" alt="Facebook" />
              {t("profile.social.facebook")}
            </Label>
            <Input id="facebook" type="url" value={data.facebook_url ?? ""} onChange={(e) => setData({ ...data, facebook_url: e.target.value })} placeholder="https://facebook.com/..." />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="instagram" className="flex items-center gap-2">
              <BrandIcon name="instagram" fallback={Instagram} className="h-4 w-4" alt="Instagram" />
              {t("profile.social.instagram")}
            </Label>
            <Input id="instagram" type="url" value={data.instagram_url ?? ""} onChange={(e) => setData({ ...data, instagram_url: e.target.value })} placeholder="https://instagram.com/..." />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="spotify" className="flex items-center gap-2">
              <BrandIcon name="spotify" fallback={Music2} className="h-4 w-4" alt="Spotify" />
              {t("profile.social.spotify")}
            </Label>
            <Input id="spotify" type="url" value={data.spotify_url ?? ""} onChange={(e) => setData({ ...data, spotify_url: e.target.value })} placeholder="https://open.spotify.com/..." />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="contact_email" className="flex items-center gap-2">
              <BrandIcon name="email" fallback={Mail} className="h-4 w-4" alt="E-mail" />
              {t("profile.social.email")}
            </Label>
            <Input id="contact_email" type="email" value={data.contact_email ?? ""} onChange={(e) => setData({ ...data, contact_email: e.target.value })} placeholder="kontakt@example.com" />
          </div>
          <Button type="submit" disabled={busy}>{t("profile.social.save")}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
