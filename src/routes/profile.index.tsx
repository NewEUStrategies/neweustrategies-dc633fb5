import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Eye, Pencil, Mail, MapPin, Briefcase, ShieldCheck, Receipt, Bookmark, Users, Sparkles, Globe, ExternalLink } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useProfileEditor } from "@/lib/profile/useProfileEditor";
import { InlineText } from "@/components/profile/inline/InlineText";
import { InlineTextarea } from "@/components/profile/inline/InlineTextarea";
import { InlineMedia } from "@/components/profile/inline/InlineMedia";

export const Route = createFileRoute("/profile/")({
  component: ProfileInline,
});

type Gender = "male" | "female" | "neutral";

function ProfileInline() {
  const { t } = useTranslation();
  const { user, roles, session } = useAuth();
  const { data, loading, saveField, upload, progress, status } = useProfileEditor();
  const [previewAsGuest, setPreviewAsGuest] = useState(false);

  const fullName =
    [data.first_name, data.last_name].filter(Boolean).join(" ") ||
    data.display_name ||
    user?.email?.split("@")[0] ||
    t("profile.account.unnamed");

  // Bookmark / follow counts shown as inline meta
  const counts = useQuery({
    queryKey: ["profile-counts", user?.id],
    enabled: !!session && !!user,
    queryFn: async () => {
      const [bm, fa, fc, ft] = await Promise.all([
        supabase.from("user_bookmarks").select("id", { count: "exact", head: true }).eq("user_id", user!.id),
        supabase.from("user_follows").select("id", { count: "exact", head: true }).eq("user_id", user!.id).eq("target_type", "author"),
        supabase.from("user_follows").select("id", { count: "exact", head: true }).eq("user_id", user!.id).eq("target_type", "category"),
        supabase.from("user_follows").select("id", { count: "exact", head: true }).eq("user_id", user!.id).eq("target_type", "tag"),
      ]);
      return {
        bookmarks: bm.count ?? 0,
        authors: fa.count ?? 0,
        categories: fc.count ?? 0,
        tags: ft.count ?? 0,
      };
    },
  });

  const isStaff = roles.includes("admin") || roles.includes("super_admin");
  const editable = !previewAsGuest;

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* HERO: cover + avatar */}
        <section className="relative">
          {editable ? (
            <InlineMedia
              avatarUrl={data.avatar_url}
              coverUrl={data.cover_url}
              fullName={fullName}
              onUpload={upload}
              status={status}
              progress={progress}
              t={t}
            />
          ) : (
            <ReadOnlyMedia avatarUrl={data.avatar_url} coverUrl={data.cover_url} fullName={fullName} />
          )}

          {/* Top-right preview toggle */}
          <div className="absolute right-2.5 top-2.5 z-10">
            <Button
              type="button"
              size="sm"
              variant={previewAsGuest ? "default" : "secondary"}
              onClick={() => setPreviewAsGuest((v) => !v)}
              className="h-7 px-2.5 text-[11px] shadow-sm"
            >
              {previewAsGuest ? <Pencil className="mr-1 h-3 w-3" /> : <Eye className="mr-1 h-3 w-3" />}
              {previewAsGuest ? t("profile.inline.editMode") : t("profile.inline.viewAsGuest")}
            </Button>
          </div>
        </section>

        {/* IDENTITY block (offset to clear the overlapping avatar) */}
        <section className="pl-4 pr-4 pt-10 sm:pl-28 sm:pr-2 sm:pt-2">
          <div className="space-y-1">

            {editable ? (
              <InlineText
                value={data.display_name || fullName}
                onSave={(v) => saveField("display_name", v || null)}
                ariaLabel={t("profile.account.displayName")}
                placeholder={t("profile.account.displayName")}
                emptyLabel={t("profile.account.unnamed")}
                variant="title"
                maxLength={120}
              />
            ) : (
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{fullName}</h1>
            )}

            {/* Job title · Company */}
            <div className="flex flex-wrap items-center gap-1.5 text-foreground/85">
              <Briefcase className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              {editable ? (
                <>
                  <InlineText
                    value={data.job_title}
                    onSave={(v) => saveField("job_title", v || null)}
                    ariaLabel={t("profile.account.jobTitle")}
                    placeholder={t("profile.account.jobTitle")}
                    emptyLabel={t("profile.inline.addJobTitle")}
                    variant="subtitle"
                    maxLength={120}
                  />
                  {(data.current_company || data.job_title) && <span className="text-muted-foreground">·</span>}
                  <InlineText
                    value={data.current_company}
                    onSave={(v) => saveField("current_company", v || null)}
                    ariaLabel={t("profile.account.currentCompany")}
                    placeholder={t("profile.account.currentCompany")}
                    emptyLabel={t("profile.inline.addCompany")}
                    variant="subtitle"
                    maxLength={160}
                  />
                </>
              ) : (
                <span className="text-base sm:text-lg">
                  {[data.job_title, data.current_company].filter(Boolean).join(" · ") || "-"}
                </span>
              )}
            </div>

            {/* Location */}
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <MapPin className="h-4 w-4 shrink-0" aria-hidden />
              {editable ? (
                <InlineText
                  value={data.location}
                  onSave={(v) => saveField("location", v || null)}
                  ariaLabel={t("profile.account.location")}
                  placeholder={t("profile.account.locationPh")}
                  emptyLabel={t("profile.inline.addLocation")}
                  variant="muted"
                  maxLength={160}
                />
              ) : (
                <span className="text-sm">{data.location || "-"}</span>
              )}
            </div>

            {/* Email (readonly) */}
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Mail className="h-4 w-4 shrink-0" aria-hidden />
              <a href={`mailto:${user?.email ?? ""}`} className="text-sm hover:text-foreground">
                {user?.email}
              </a>
            </div>

            {/* Roles + admin shortcuts */}
            {roles.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-2">
                {roles.map((r) => (
                  <Badge
                    key={r}
                    variant={r === "super_admin" || r === "admin" ? "default" : "secondary"}
                    className="h-7 rounded-[6px] px-2.5 text-xs font-medium leading-none"
                  >
                    {t(`profile.role.${r}`)}
                  </Badge>
                ))}
                {isStaff && (
                  <Button asChild size="sm" variant="outline" className="h-7 rounded-[6px] px-2.5 text-xs">
                    <Link to="/admin" className="!text-foreground">
                      <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                      {t("profile.inline.adminPanel")}
                    </Link>
                  </Button>
                )}
              </div>
            )}

          </div>
        </section>

        {/* BIO */}
        <section className="grid gap-2 rounded-[6px] border border-border bg-card p-4">
          <header className="flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/70">
              <Sparkles className="h-3.5 w-3.5 text-primary" /> {t("profile.account.bio")}
            </h2>
          </header>
          {editable ? (
            <InlineTextarea
              value={data.bio}
              onSave={(v) => saveField("bio", v || null)}
              ariaLabel={t("profile.account.bio")}
              placeholder={t("profile.inline.bioPlaceholder")}
              emptyLabel={t("profile.inline.bioPlaceholder")}
              maxLength={500}
              rows={3}
            />
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
              {data.bio || "-"}
            </p>
          )}
        </section>

        {/* GRID: meta + activity */}
        <section className="grid gap-3 md:grid-cols-2">
          <div className="rounded-[6px] border border-border bg-card p-4">
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-foreground/70">
              {t("profile.inline.contactSection")}
            </h2>
            <dl className="grid gap-2 text-sm">
              <Row label={t("profile.account.firstName")}>
                {editable ? (
                  <InlineText
                    value={data.first_name}
                    onSave={(v) => saveField("first_name", v || null)}
                    ariaLabel={t("profile.account.firstName")}
                    emptyLabel={t("profile.inline.notSet")}
                    maxLength={80}
                  />
                ) : (
                  <span>{data.first_name || "-"}</span>
                )}
              </Row>
              <Row label={t("profile.account.lastName")}>
                {editable ? (
                  <InlineText
                    value={data.last_name}
                    onSave={(v) => saveField("last_name", v || null)}
                    ariaLabel={t("profile.account.lastName")}
                    emptyLabel={t("profile.inline.notSet")}
                    maxLength={80}
                  />
                ) : (
                  <span>{data.last_name || "-"}</span>
                )}
              </Row>
              <Row label={t("profile.account.phone")}>
                {editable ? (
                  <InlineText
                    value={data.phone}
                    onSave={(v) => saveField("phone", v || null)}
                    ariaLabel={t("profile.account.phone")}
                    placeholder={t("profile.account.phonePh")}
                    emptyLabel={t("profile.inline.notSet")}
                    maxLength={32}
                  />
                ) : (
                  <span>{data.phone || "-"}</span>
                )}
              </Row>
              <Row label={t("profile.account.gender")}>
                {editable ? (
                  <Select
                    value={data.gender ?? "auto"}
                    onValueChange={(v) =>
                      saveField("gender", v === "auto" ? null : (v as Gender))
                    }
                  >
                    <SelectTrigger className="h-7 w-full max-w-[220px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">{t("profile.account.genderAuto")}</SelectItem>
                      <SelectItem value="female">{t("profile.account.genderFemale")}</SelectItem>
                      <SelectItem value="male">{t("profile.account.genderMale")}</SelectItem>
                      <SelectItem value="neutral">{t("profile.account.genderNeutral")}</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <span>{data.gender ? t(`profile.account.gender${cap(data.gender)}`) : "-"}</span>
                )}
              </Row>
            </dl>
          </div>

          <div className="rounded-[6px] border border-border bg-card p-4">
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-foreground/70">
              {t("profile.inline.activitySection")}
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat icon={<Bookmark className="h-3.5 w-3.5" />} value={counts.data?.bookmarks ?? 0} label={t("profile.nav.bookmarks")} to="/profile/bookmarks" />
              <Stat icon={<Users className="h-3.5 w-3.5" />} value={counts.data?.authors ?? 0} label={t("profile.follows.tabAuthors")} to="/profile/follows" />
              <Stat icon={<Globe className="h-3.5 w-3.5" />} value={counts.data?.categories ?? 0} label={t("profile.follows.tabCategories")} to="/profile/follows" />
              <Stat icon={<Sparkles className="h-3.5 w-3.5" />} value={counts.data?.tags ?? 0} label={t("profile.follows.tabTags")} to="/profile/follows" />
            </div>

            <div className="mt-3 grid gap-1">
              <SecondaryLink to="/profile/interests" icon={<Sparkles className="h-3.5 w-3.5" />}>{t("profile.nav.interests")}</SecondaryLink>
              <SecondaryLink to="/profile/social" icon={<ExternalLink className="h-3.5 w-3.5" />}>{t("profile.nav.social")}</SecondaryLink>
              <SecondaryLink to="/profile/billing" icon={<Receipt className="h-3.5 w-3.5" />}>{t("profile.nav.billing")}</SecondaryLink>
              <SecondaryLink to="/profile/subscription" icon={<ShieldCheck className="h-3.5 w-3.5" />}>{t("profile.nav.subscription")}</SecondaryLink>
              <SecondaryLink to="/profile/security" icon={<ShieldCheck className="h-3.5 w-3.5" />}>{t("profile.nav.security")}</SecondaryLink>
            </div>
          </div>
        </section>

      </div>
    </TooltipProvider>
  );
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[100px_1fr] items-center gap-2">
      <dt className="text-[10px] uppercase tracking-wide leading-normal text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>

  );
}

function Stat({ icon, value, label, to }: { icon: React.ReactNode; value: number; label: string; to: string }) {
  return (
    <Link
      to={to}
      className="group flex flex-col items-start gap-0.5 rounded-[6px] border border-border bg-background p-2.5 transition-colors hover:border-primary/40 hover:bg-primary/5"
    >
      <span className="text-muted-foreground group-hover:text-primary">{icon}</span>
      <span className="text-base font-semibold leading-none">{value}</span>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
    </Link>
  );
}

function SecondaryLink({ to, icon, children }: { to: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between rounded-[6px] px-2.5 py-1.5 text-xs text-foreground/85 transition-colors hover:bg-muted hover:text-foreground"
    >
      <span className="flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        {children}
      </span>
      <ExternalLink className="h-3 w-3 text-muted-foreground" />
    </Link>
  );
}

function ReadOnlyMedia({ avatarUrl, coverUrl, fullName }: { avatarUrl: string | null; coverUrl: string | null; fullName: string }) {
  const initial = fullName.trim().charAt(0).toUpperCase() || "·";
  return (
    <div className="relative">
      <div className="h-28 sm:h-36 md:h-44 w-full overflow-hidden rounded-[6px] bg-muted">
        {coverUrl && <img src={coverUrl} alt="" className="h-full w-full object-cover" />}
      </div>
      <div className="absolute left-4 sm:left-5 -bottom-8 sm:-bottom-10">
        <div className="h-16 w-16 sm:h-20 sm:w-20">
          {avatarUrl ? (
            <img src={avatarUrl} alt={fullName} className="h-full w-full rounded-[6px] ring-2 ring-background bg-background object-cover shadow-sm" />
          ) : (
            <div className="flex h-full w-full items-center justify-center rounded-[6px] ring-2 ring-background bg-gradient-to-br from-primary/30 to-primary/10 text-xl sm:text-2xl font-semibold text-primary shadow-sm">
              {initial}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

