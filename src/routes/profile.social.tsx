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
import { TooltipProvider } from "@/components/ui/tooltip";
import { FieldLabel } from "@/components/profile/FieldLabel";
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
const RESERVED = new Set([
  "admin", "api", "auth", "author", "profile", "login", "logout",
  "register", "settings", "about", "contact", "search", "tag",
  "category", "page", "post", "rss", "sitemap", "static", "public",
  "new", "edit", "delete", "me", "user", "users", "superadmin",
]);

type SlugStatus = "idle" | "checking" | "ok" | "invalid" | "short" | "taken" | "reserved";

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
  // Suggestion source: "first last" || display_name || email-local. Never written automatically.
  const [suggestSource, setSuggestSource] = useState("");
  const [slugStatus, setSlugStatus] = useState<SlugStatus>("idle");
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);


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
        setSuggestSource(base);
        setData({
          slug: (r.slug ?? "").trim(),
          bio_pl: r.bio_pl, bio_en: r.bio_en,
          twitter_url: r.twitter_url, linkedin_url: r.linkedin_url, website_url: r.website_url,
          facebook_url: r.facebook_url, instagram_url: r.instagram_url, spotify_url: r.spotify_url,
          contact_email: r.contact_email,
        });
      });
    return () => { active = false; };
  }, [user]);

  const onSlugChange = (value: string) => {
    // Normalize as user types: lowercase + replace invalid chars with dash.
    const normalized = value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-{2,}/g, "-");
    setData((d) => ({ ...d, slug: normalized }));
  };

  const suggestSlug = () => {
    const suggestion = slugify(suggestSource);
    if (suggestion) setData((d) => ({ ...d, slug: suggestion }));
  };

  // Debounced slug validation + uniqueness check.
  useEffect(() => {
    if (!user) return;
    const raw = (data.slug ?? "").trim().toLowerCase();
    if (!raw) { setSlugStatus("idle"); return; }
    if (raw.length < 3) { setSlugStatus("short"); return; }
    if (!SLUG_RE.test(raw)) { setSlugStatus("invalid"); return; }
    if (RESERVED.has(raw)) { setSlugStatus("reserved"); return; }
    setSlugStatus("checking");
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data: hit } = await supabase
        .from("profiles")
        .select("id")
        .eq("slug", raw)
        .neq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      setSlugStatus(hit ? "taken" : "ok");
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [data.slug, user]);

  const slugBlocked = slugStatus === "invalid" || slugStatus === "short" || slugStatus === "taken" || slugStatus === "reserved";



  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const slug = (data.slug ?? "").trim().toLowerCase() || null;
    if (slug && !SLUG_RE.test(slug)) {
      toast.error(t("profile.social.slugInvalid"));
      return;
    }
    if (slugBlocked) {
      toast.error(t(`profile.social.slug${slugStatus === "taken" ? "Taken" : slugStatus === "reserved" ? "Reserved" : slugStatus === "short" ? "TooShort" : "Invalid"}`));
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
    <TooltipProvider>
    <Card>
      <CardHeader>
        <CardTitle>{t("profile.social.title")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("profile.social.subtitle")}</p>
      </CardHeader>
      <CardContent>
        <form className="grid gap-5" onSubmit={save}>
          {/* Identity */}
          <div className="grid gap-2">
            <FieldLabel htmlFor="slug" tip={t("profile.social.tip.slug")}>{t("profile.social.slug")}</FieldLabel>
            <Input
              id="slug"
              value={data.slug ?? ""}
              onChange={(e) => onSlugChange(e.target.value)}
              maxLength={64}
              placeholder="jan-kowalski"
              aria-invalid={slugBlocked || undefined}
              className={slugBlocked ? "border-destructive focus-visible:ring-destructive" : slugStatus === "ok" ? "border-emerald-500/60 focus-visible:ring-emerald-500" : ""}
            />
            {data.slug ? (
              <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-2.5 py-1.5 text-xs">
                <span className="text-muted-foreground normal-case tracking-normal font-normal">{t("profile.social.slugPreview")}:</span>
                <code className="font-mono text-foreground truncate">{origin}/author/{slugify(data.slug) || data.slug}</code>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <p className={`text-[11px] normal-case tracking-normal font-normal ${slugStatus === "ok" ? "text-emerald-600 dark:text-emerald-400" : slugBlocked ? "text-destructive" : "text-muted-foreground"}`}>
                {slugStatus === "checking" && t("profile.social.slugChecking")}
                {slugStatus === "ok" && t("profile.social.slugAvailable")}
                {slugStatus === "taken" && t("profile.social.slugTaken")}
                {slugStatus === "reserved" && t("profile.social.slugReserved")}
                {slugStatus === "invalid" && t("profile.social.slugInvalid")}
                {slugStatus === "short" && t("profile.social.slugTooShort")}
                {slugStatus === "idle" && t("profile.social.slugHint")}
              </p>
              {suggestSource && slugify(suggestSource) && slugify(suggestSource) !== (data.slug ?? "").trim() ? (
                <button type="button" onClick={suggestSlug} className="text-[11px] normal-case tracking-normal font-medium text-primary hover:underline shrink-0">
                  {t("profile.social.slugReset")}
                </button>
              ) : null}
            </div>
          </div>

          {/* Bio */}
          <section className="grid gap-3">
            <h3>{t("profile.social.bioPl").replace(/\s*\(PL\)\s*$/i, "")}</h3>
            <div className="profile-grid-2">
              <div className="grid gap-2">
                <FieldLabel htmlFor="bio_pl" tip={t("profile.social.tip.bioPl")}>{t("profile.social.bioPl")}</FieldLabel>
                <Textarea id="bio_pl" rows={3} maxLength={1000} value={data.bio_pl ?? ""} onChange={(e) => setData({ ...data, bio_pl: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <FieldLabel htmlFor="bio_en" tip={t("profile.social.tip.bioEn")}>{t("profile.social.bioEn")}</FieldLabel>
                <Textarea id="bio_en" rows={3} maxLength={1000} value={data.bio_en ?? ""} onChange={(e) => setData({ ...data, bio_en: e.target.value })} />
              </div>
            </div>
          </section>

          {/* Socials */}
          <section className="grid gap-3">
            <h3>Social</h3>
            <div className="profile-grid-2">
              <div className="grid gap-2">
                <FieldLabel htmlFor="twitter" tip={t("profile.social.tip.twitter")}>
                  <span className="inline-flex items-center gap-2"><BrandIcon name="x" fallback={Twitter} className="h-3.5 w-3.5" alt="X / Twitter" />
                    {t("profile.social.twitter")}
                  </span>
                </FieldLabel>
                <Input id="twitter" type="url" value={data.twitter_url ?? ""} onChange={(e) => setData({ ...data, twitter_url: e.target.value })} placeholder="https://x.com/..." />
              </div>
              <div className="grid gap-2">
                <FieldLabel htmlFor="linkedin" tip={t("profile.social.tip.linkedin")}>
                  <span className="inline-flex items-center gap-2"><BrandIcon name="linkedin" fallback={Linkedin} className="h-3.5 w-3.5" alt="LinkedIn" />
                    {t("profile.social.linkedin")}
                  </span>
                </FieldLabel>
                <Input id="linkedin" type="url" value={data.linkedin_url ?? ""} onChange={(e) => setData({ ...data, linkedin_url: e.target.value })} placeholder="https://linkedin.com/in/..." />
              </div>
              <div className="grid gap-2">
                <FieldLabel htmlFor="facebook" tip={t("profile.social.tip.facebook")}>
                  <span className="inline-flex items-center gap-2"><BrandIcon name="facebook" fallback={Facebook} className="h-3.5 w-3.5" alt="Facebook" />
                    {t("profile.social.facebook")}
                  </span>
                </FieldLabel>
                <Input id="facebook" type="url" value={data.facebook_url ?? ""} onChange={(e) => setData({ ...data, facebook_url: e.target.value })} placeholder="https://facebook.com/..." />
              </div>
              <div className="grid gap-2">
                <FieldLabel htmlFor="instagram" tip={t("profile.social.tip.instagram")}>
                  <span className="inline-flex items-center gap-2"><BrandIcon name="instagram" fallback={Instagram} className="h-3.5 w-3.5" alt="Instagram" />
                    {t("profile.social.instagram")}
                  </span>
                </FieldLabel>
                <Input id="instagram" type="url" value={data.instagram_url ?? ""} onChange={(e) => setData({ ...data, instagram_url: e.target.value })} placeholder="https://instagram.com/..." />
              </div>
              <div className="grid gap-2">
                <FieldLabel htmlFor="spotify" tip={t("profile.social.tip.spotify")}>
                  <span className="inline-flex items-center gap-2"><BrandIcon name="spotify" fallback={Music2} className="h-3.5 w-3.5" alt="Spotify" />
                    {t("profile.social.spotify")}
                  </span>
                </FieldLabel>
                <Input id="spotify" type="url" value={data.spotify_url ?? ""} onChange={(e) => setData({ ...data, spotify_url: e.target.value })} placeholder="https://open.spotify.com/..." />
              </div>
              <div className="grid gap-2">
                <FieldLabel htmlFor="website" tip={t("profile.social.tip.website")}>
                  <span className="inline-flex items-center gap-2"><BrandIcon name="website" fallback={Globe} className="h-3.5 w-3.5" alt="Website" />
                    {t("profile.social.website")}
                  </span>
                </FieldLabel>
                <Input id="website" type="url" value={data.website_url ?? ""} onChange={(e) => setData({ ...data, website_url: e.target.value })} placeholder="https://..." />
              </div>
              <div className="grid gap-2 col-full">
                <FieldLabel htmlFor="contact_email" tip={t("profile.social.tip.email")}>
                  <span className="inline-flex items-center gap-2"><BrandIcon name="email" fallback={Mail} className="h-3.5 w-3.5" alt="E-mail" />
                    {t("profile.social.email")}
                  </span>
                </FieldLabel>
                <Input id="contact_email" type="email" value={data.contact_email ?? ""} onChange={(e) => setData({ ...data, contact_email: e.target.value })} placeholder="kontakt@example.com" />
              </div>
            </div>
          </section>

          <Button type="submit" disabled={busy || slugBlocked || slugStatus === "checking"} title={t("profile.social.tip.save")}>{t("profile.social.save")}</Button>
        </form>
      </CardContent>
    </Card>
    </TooltipProvider>
  );
}
