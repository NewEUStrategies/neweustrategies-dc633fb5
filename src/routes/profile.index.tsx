import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";
import {
  Eye, Pencil, Mail, MapPin, Briefcase, ShieldCheck, Receipt, Bookmark, Users,
  Award, Activity, Tag, Globe, ExternalLink, Camera, Image as ImageIcon, Loader2, Linkedin,
  Twitter, Phone, User as UserIcon, Cake, Heart,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { BrandIcon } from "@/components/atoms/BrandIcon";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useProfileEditor } from "@/lib/profile/useProfileEditor";
import { InlineText } from "@/components/profile/inline/InlineText";
import { InlineTextarea } from "@/components/profile/inline/InlineTextarea";
import {
  ExperienceSection, EducationSection, SkillsSection, AwardsSection, CvSection,
  PersonalityCard, HobbiesCard,
} from "@/components/profile/sections/ProfileExtraSections";
import { cn } from "@/lib/utils";
import { useSiteSetting } from "@/lib/useSiteSetting";
import { useTheme } from "@/components/ThemeProvider";
import "@/lib/i18n-profile-extras2";

export const Route = createFileRoute("/profile/")({
  component: ProfileInline,
});

type Gender = "male" | "female" | "neutral";
type TabKey = "about" | "experience" | "badges" | "activity" | "settings";

function ProfileInline() {
  const { t } = useTranslation();
  const { user, roles, session } = useAuth();
  const { data, loading, saveField, upload, progress, status } = useProfileEditor();
  const [previewAsGuest, setPreviewAsGuest] = useState(false);
  const [tab, setTab] = useState<TabKey>("about");

  const fullName =
    [data.first_name, data.last_name].filter(Boolean).join(" ") ||
    data.display_name ||
    user?.email?.split("@")[0] ||
    t("profile.account.unnamed");

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

  const tabs: { key: TabKey; label: string }[] = [
    { key: "about", label: t("profile.tabs.about") },
    { key: "experience", label: t("profile.tabs.experience") },
    { key: "badges", label: t("profile.tabs.badges") },
    { key: "activity", label: t("profile.tabs.activity") },
    { key: "settings", label: t("profile.tabs.settings") },
  ];

  return (
    <TooltipProvider>
      <div className="mx-auto w-full max-w-6xl space-y-4">
        {/* HERO */}
        <CenteredHero
          editable={editable}
          avatarUrl={data.avatar_url}
          coverUrl={data.cover_url}
          fullName={fullName}
          onUpload={upload}
          status={status}
          progress={progress}
          previewAsGuest={previewAsGuest}
          onTogglePreview={() => setPreviewAsGuest((v) => !v)}
          linkedinUrl={data.linkedin_url ?? null}
          twitterUrl={data.twitter_url ?? null}
        />

        <section className="rounded-[6px] border border-border bg-card px-6 pt-14 sm:pt-16 pb-5">
          {/* Top: name + role/admin actions */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] sm:items-end gap-3">
            <div className="min-w-0 text-center sm:text-left">
              {editable ? (
                <InlineText
                  value={data.display_name || fullName}
                  onSave={(v) => saveField("display_name", v || null)}
                  ariaLabel={t("profile.account.displayName")}
                  placeholder={t("profile.account.displayName")}
                  emptyLabel={t("profile.account.unnamed")}
                  variant="title"
                  maxLength={120}
                  className="inline-block"
                />
              ) : (
                <h1 className="text-2xl sm:text-[28px] font-semibold tracking-tight leading-tight">{fullName}</h1>
              )}

              {/* Job title + Company badge */}
              <div className="mt-2 flex flex-row items-center gap-3 flex-wrap">
                <div className="text-sm text-muted-foreground leading-normal">
                  {editable ? (
                    <InlineText
                      value={data.job_title}
                      onSave={(v) => saveField("job_title", v || null)}
                      ariaLabel={t("profile.account.jobTitle")}
                      placeholder={t("profile.account.jobTitle")}
                      emptyLabel={t("profile.inline.addJobTitle")}
                      variant="subtitle"
                      maxLength={120}
                      className="inline-block"
                    />
                  ) : (
                    <span>{data.job_title || "-"}</span>
                  )}
                </div>

                {data.current_company ? (
                  <span className="inline-flex items-center gap-2 rounded-[6px] border border-border bg-background px-3 py-1.5 shadow-sm">
                    <CompanyLogoIcon className="h-7 w-7" />
                    <span className="text-xs font-medium text-foreground">{data.current_company}</span>
                  </span>
                ) : editable ? (
                  <button
                    type="button"
                    onClick={() => {
                      const v = window.prompt(t("profile.account.currentCompany"));
                      if (v != null) void saveField("current_company", v.trim() || null);
                    }}
                    className="inline-flex items-center gap-2 rounded-[6px] border border-dashed border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground italic hover:bg-accent hover:text-accent-foreground"
                  >
                    <CompanyLogoIcon className="h-7 w-7 opacity-60" />
                    {t("profile.inline.addCompany")}
                  </button>
                ) : null}
              </div>
            </div>

            {/* Roles + admin shortcut — top-right on desktop */}
            {/* Ukrywamy role i skrót do panelu admina w widoku publicznym (Podgląd jak gość) - to dane wewnętrzne. */}
            {!previewAsGuest && roles.length > 0 && (
              <div className="flex flex-wrap items-center justify-center sm:justify-end gap-1.5 shrink-0">
                {roles.map((r) => (
                  <span
                    key={r}
                    className="inline-flex items-center gap-1 h-auto rounded-[6px] border border-border bg-background px-2.5 py-1 text-[10px] font-medium leading-[1.2] text-foreground whitespace-nowrap"
                  >
                    <ShieldCheck className="h-3 w-3 text-primary" />
                    {t(`profile.role.${r}`)}
                  </span>
                ))}
                {isStaff && (
                  <Button asChild size="sm" variant="outline" className="h-auto rounded-[6px] px-2.5 py-1 text-[10px] leading-[1.2] gap-1">
                    <Link to="/admin" className="!text-foreground inline-flex items-center">
                      <ShieldCheck className="h-3 w-3" />
                      {t("profile.inline.adminPanel")}
                    </Link>
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="my-4 h-px bg-border/70" />

          {/* Meta row: chips left, email right */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">

              {data.specialization ? (
                <Chip icon={<Award className="h-3.5 w-3.5" />} tone="accent" size="lg">{data.specialization}</Chip>
              ) : editable ? (
                <Chip icon={<Award className="h-3.5 w-3.5" />} tone="muted" size="lg" onClick={() => {
                  const v = window.prompt(t("profile.account.specialization"));
                  if (v != null) void saveField("specialization", v.trim() || null);
                }}>{t("profile.inline.addSpecialization")}</Chip>
              ) : null}

              {data.location ? (
                <Chip icon={<MapPin className="h-3.5 w-3.5" />} tone="accent" size="lg">{data.location}</Chip>
              ) : editable ? (
                <Chip icon={<MapPin className="h-3.5 w-3.5" />} tone="muted" size="lg" onClick={() => {
                  const v = window.prompt(t("profile.account.locationPh"));
                  if (v != null) void saveField("location", v.trim() || null);
                }}>{t("profile.inline.addLocation")}</Chip>
              ) : null}
            </div>

            {user?.email && (
              <div className="flex items-center justify-center sm:justify-end gap-1.5 text-xs text-muted-foreground min-w-0">
                <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <a href={`mailto:${user.email}`} className="truncate hover:text-foreground">{user.email}</a>
              </div>
            )}
          </div>
        </section>


        {/* TABS NAV */}
        <nav className="sticky top-0 z-10 rounded-[6px] border border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <div className="flex items-center gap-0.5 overflow-x-auto px-2">
            {tabs.map((it) => {
              const active = tab === it.key;
              return (
                <button
                  key={it.key}
                  type="button"
                  onClick={() => setTab(it.key)}
                  className={cn(
                    "relative shrink-0 px-3 py-2.5 text-xs font-medium transition-colors",
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {it.label}
                  {active && (
                    <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" aria-hidden />
                  )}
                </button>
              );
            })}
          </div>
        </nav>

        {/* MAIN GRID */}
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          {/* LEFT: tab content */}
          <div className="space-y-4 min-w-0">
            {tab === "about" && (
              <>
                <Card
                  icon={<Activity className="h-3.5 w-3.5" />}
                  title={t("profile.account.bio")}
                >
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
                </Card>

                <Card icon={<Mail className="h-3.5 w-3.5" />} title={t("profile.inline.contactSection")}>
                  <ul className="divide-y divide-border/60">
                    {/* Email - read-only from auth */}
                    <ContactRow
                      icon={<BrandIcon name="mail" fallback={Mail} className="h-4 w-4" alt="" />}
                      ariaLabel={t("profile.account.email")}
                    >
                      <a href={`mailto:${user?.email ?? ""}`} className="truncate text-sm text-foreground/90 hover:text-primary">
                        {user?.email}
                      </a>
                    </ContactRow>

                    {/* Phone */}
                    <ContactRow
                      icon={<BrandIcon name="phone" fallback={Phone} className="h-4 w-4" alt="" />}
                      ariaLabel={t("profile.account.phone")}
                    >
                      {editable ? (
                        <InlineText
                          value={data.phone}
                          onSave={(v) => saveField("phone", v || null)}
                          ariaLabel={t("profile.account.phone")}
                          placeholder={t("profile.account.phonePh")}
                          emptyLabel={t("profile.inline.addPhone")}
                          maxLength={32}
                          className="w-full"
                        />
                      ) : data.phone ? (
                        <a href={`tel:${data.phone}`} className="truncate text-sm text-foreground/90 hover:text-primary">{data.phone}</a>
                      ) : (
                        <span className="text-sm italic text-muted-foreground/70">-</span>
                      )}
                    </ContactRow>

                    {/* Location */}
                    <ContactRow
                      icon={<BrandIcon name="location" fallback={MapPin} className="h-4 w-4" alt="" />}
                      ariaLabel={t("profile.account.location")}
                    >
                      {editable ? (
                        <InlineText
                          value={data.location}
                          onSave={(v) => saveField("location", v || null)}
                          ariaLabel={t("profile.account.location")}
                          placeholder={t("profile.account.locationPh")}
                          emptyLabel={t("profile.inline.addLocation")}
                          maxLength={160}
                          className="w-full"
                        />
                      ) : (
                        <span className="truncate text-sm text-foreground/90">{data.location || "-"}</span>
                      )}
                    </ContactRow>

                    {/* LinkedIn */}
                    <ContactRow
                      icon={<BrandIcon name="linkedin" fallback={Linkedin} className="h-4 w-4" alt="LinkedIn" />}
                      ariaLabel="LinkedIn"
                    >
                      {editable ? (
                        <InlineText
                          value={data.linkedin_url}
                          onSave={(v) => saveField("linkedin_url", v || null)}
                          ariaLabel="LinkedIn"
                          placeholder="https://linkedin.com/in/..."
                          emptyLabel={t("profile.inline.addLinkedin")}
                          maxLength={240}
                          className="w-full"
                        />
                      ) : data.linkedin_url ? (
                        <a href={data.linkedin_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1 truncate text-sm text-foreground/90 hover:text-primary">
                          {prettyUrl(data.linkedin_url)}
                          <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                        </a>
                      ) : (
                        <span className="text-sm italic text-muted-foreground/70">-</span>
                      )}
                    </ContactRow>

                    {/* X / Twitter */}
                    <ContactRow
                      icon={<BrandIcon name="x" fallback={Twitter} className="h-4 w-4" alt="X" />}
                      ariaLabel="X"
                    >
                      {editable ? (
                        <InlineText
                          value={data.twitter_url}
                          onSave={(v) => saveField("twitter_url", v || null)}
                          ariaLabel="X"
                          placeholder="https://x.com/..."
                          emptyLabel={t("profile.inline.addTwitter")}
                          maxLength={240}
                          className="w-full"
                        />
                      ) : data.twitter_url ? (
                        <a href={data.twitter_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1 truncate text-sm text-foreground/90 hover:text-primary">
                          {prettyUrl(data.twitter_url)}
                          <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                        </a>
                      ) : (
                        <span className="text-sm italic text-muted-foreground/70">-</span>
                      )}
                    </ContactRow>
                  </ul>
                </Card>


                {user?.id && data.tenant_id ? (
                  <CvSection userId={user.id} tenantId={data.tenant_id} editable={editable} />
                ) : null}
              </>
            )}

            {tab === "experience" && user?.id && data.tenant_id && (
              <>
                <ExperienceSection userId={user.id} tenantId={data.tenant_id} editable={editable} />
                <EducationSection userId={user.id} tenantId={data.tenant_id} editable={editable} />
                <SkillsSection userId={user.id} tenantId={data.tenant_id} editable={editable} />
              </>
            )}

            {tab === "badges" && user?.id && data.tenant_id && (
              <>
                <AwardsSection userId={user.id} tenantId={data.tenant_id} editable={editable} kind="award" />
                <AwardsSection userId={user.id} tenantId={data.tenant_id} editable={editable} kind="recognition" />
                <AwardsSection userId={user.id} tenantId={data.tenant_id} editable={editable} kind="mention" />
              </>
            )}

            {tab === "activity" && (
              <>
                <Card icon={<Activity className="h-3.5 w-3.5" />} title={t("profile.inline.activitySection")}>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Stat icon={<Bookmark className="h-3.5 w-3.5" />} value={counts.data?.bookmarks ?? 0} label={t("profile.nav.bookmarks")} to="/profile/bookmarks" />
                    <Stat icon={<Users className="h-3.5 w-3.5" />} value={counts.data?.authors ?? 0} label={t("profile.follows.tabAuthors")} to="/profile/follows" />
                    <Stat icon={<Globe className="h-3.5 w-3.5" />} value={counts.data?.categories ?? 0} label={t("profile.follows.tabCategories")} to="/profile/follows" />
                    <Stat icon={<Tag className="h-3.5 w-3.5" />} value={counts.data?.tags ?? 0} label={t("profile.follows.tabTags")} to="/profile/follows" />
                  </div>
                </Card>
                <Card icon={<Globe className="h-3.5 w-3.5" />} title={t("profile.inline.shortcuts")}>
                  <div className="grid gap-1">
                    <SecondaryLink to="/profile/interests" icon={<Heart className="h-3.5 w-3.5" />}>{t("profile.nav.interests")}</SecondaryLink>
                    <SecondaryLink to="/profile/social" icon={<ExternalLink className="h-3.5 w-3.5" />}>{t("profile.nav.social")}</SecondaryLink>
                    <SecondaryLink to="/profile/billing" icon={<Receipt className="h-3.5 w-3.5" />}>{t("profile.nav.billing")}</SecondaryLink>
                    <SecondaryLink to="/profile/subscription" icon={<ShieldCheck className="h-3.5 w-3.5" />}>{t("profile.nav.subscription")}</SecondaryLink>
                    <SecondaryLink to="/profile/security" icon={<ShieldCheck className="h-3.5 w-3.5" />}>{t("profile.nav.security")}</SecondaryLink>
                  </div>
                </Card>
              </>
            )}

            {tab === "settings" && (
              <Card icon={<ShieldCheck className="h-3.5 w-3.5" />} title={t("profile.tabs.settings")}>
                <dl className="grid gap-2 text-sm">
                  <Row label={t("profile.account.gender")}>
                    {editable ? (
                      <Select
                        value={data.gender ?? "auto"}
                        onValueChange={(v) => saveField("gender", v === "auto" ? null : (v as Gender))}
                      >
                        <SelectTrigger className="h-7 w-full max-w-[240px] text-xs">
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
                  <Row label={t("profile.account.location")}>
                    {editable ? (
                      <InlineText value={data.location} onSave={(v) => saveField("location", v || null)} ariaLabel={t("profile.account.location")} placeholder={t("profile.account.locationPh")} emptyLabel={t("profile.inline.notSet")} maxLength={160} />
                    ) : <span>{data.location || "-"}</span>}
                  </Row>
                </dl>
              </Card>
            )}
          </div>

          {/* RIGHT: sticky sidebar */}
          <aside className="space-y-3 lg:sticky lg:top-14 lg:self-start">
            <Card icon={<UserIcon className="h-3.5 w-3.5" />} title={t("profile.sidebar.personalData")}>
              <dl className="grid gap-1.5 text-xs">
                <MiniRow icon={<Cake className="h-3 w-3" />} label={t("profile.sidebar.birthDate")} value="-" />
                <MiniRow icon={<UserIcon className="h-3 w-3" />} label={t("profile.account.gender")} value={data.gender ? t(`profile.account.gender${cap(data.gender)}`) : "-"} />
                <MiniRow icon={<MapPin className="h-3 w-3" />} label={t("profile.account.location")} value={data.location || "-"} />
                <MiniRow icon={<Phone className="h-3 w-3" />} label={t("profile.account.phone")} value={data.phone || "-"} />
              </dl>
            </Card>
            {user?.id ? <PersonalityCard userId={user.id} editable={editable} /> : null}
            <Card icon={<Heart className="h-3.5 w-3.5" />} title={t("profile.nav.interests")} action={
              <Link to="/profile/interests" className="text-[11px] text-primary hover:underline">
                {t("profile.actions.manage")}
              </Link>
            }>
              <p className="text-xs text-muted-foreground">{t("profile.inline.interestsHint")}</p>
            </Card>
            {user?.id && data.tenant_id ? (
              <HobbiesCard userId={user.id} tenantId={data.tenant_id} editable={editable} />
            ) : null}
          </aside>
        </div>
      </div>
    </TooltipProvider>
  );
}

/* ----------------------------- Hero ---------------------------------- */

type UploadKind = "avatar" | "cover";
type Status = "idle" | "uploading" | "success" | "failed";

function CenteredHero({
  editable, avatarUrl, coverUrl, fullName, onUpload, status, progress,
  previewAsGuest, onTogglePreview, linkedinUrl, twitterUrl,
}: {
  editable: boolean;
  avatarUrl: string | null;
  coverUrl: string | null;
  fullName: string;
  onUpload: (file: File, kind: UploadKind) => Promise<void>;
  status: Record<UploadKind, Status>;
  progress: Record<UploadKind, number>;
  previewAsGuest: boolean;
  onTogglePreview: () => void;
  linkedinUrl: string | null;
  twitterUrl: string | null;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("pl") ? "pl" : "en";

  const avatarInput = useRef<HTMLInputElement | null>(null);
  const coverInput = useRef<HTMLInputElement | null>(null);
  const [hoverCover, setHoverCover] = useState(false);
  const [hoverAvatar, setHoverAvatar] = useState(false);
  const initial = fullName.trim().charAt(0).toUpperCase() || "·";
  const upCover = status.cover === "uploading";
  const upAvatar = status.avatar === "uploading";

  return (
    <section className="relative">
      {/* Cover */}
      <div
        className="relative h-40 sm:h-52 md:h-60 w-full overflow-hidden rounded-[6px] bg-gradient-to-br from-muted via-muted/60 to-primary/10"
        onMouseEnter={() => setHoverCover(true)}
        onMouseLeave={() => setHoverCover(false)}
      >
        {coverUrl ? (
          <img src={coverUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            <ImageIcon className="mr-1.5 h-4 w-4" aria-hidden />
            {t("profile.account.coverPlaceholder")}
          </div>
        )}

        {/* Action bar top-right */}
        <div className="absolute right-2.5 top-2.5 z-10 flex items-center gap-1.5">
          {editable && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => coverInput.current?.click()}
              disabled={upCover}
              className={cn(
                "backdrop-blur-md bg-background/70 hover:bg-background/90 transition-opacity",
                hoverCover || upCover ? "opacity-100" : "opacity-80",
              )}
            >
              {upCover ? <Loader2 className="animate-spin" /> : <Camera />}
              {upCover ? t("profile.account.uploading") : t("profile.account.uploadCover")}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant={previewAsGuest ? "default" : "secondary"}
            onClick={onTogglePreview}
          >
            {previewAsGuest ? <Pencil /> : <Eye />}
            {previewAsGuest ? t("profile.inline.editMode") : t("profile.inline.viewAsGuest")}
          </Button>
        </div>

        {upCover && (
          <div className="absolute inset-x-2.5 bottom-2.5 z-10">
            <Progress value={progress.cover} className="h-1" />
          </div>
        )}
      </div>

      {/* Avatar - centered, overlapping */}
      <div
        className="absolute left-1/2 -translate-x-1/2 -bottom-14 sm:-bottom-16 z-20"
        onMouseEnter={() => setHoverAvatar(true)}
        onMouseLeave={() => setHoverAvatar(false)}
      >
        {/* Gradient halo ring */}
        <div className="relative h-28 w-28 sm:h-32 sm:w-32 rounded-[10px] bg-gradient-to-br from-primary/60 via-primary/20 to-transparent p-[3px] shadow-[0_10px_30px_-10px_hsl(var(--primary)/0.45)]">
          <div className="relative h-full w-full rounded-[7px] ring-[3px] ring-background bg-background overflow-hidden">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={fullName}
                className="h-full w-full rounded-[7px] object-cover"
              />
            ) : (
              <button
                type="button"
                onClick={() => editable && avatarInput.current?.click()}
                disabled={!editable || upAvatar}
                className="group flex h-full w-full flex-col items-center justify-center gap-1 rounded-[7px] bg-gradient-to-br from-muted to-muted/40 text-muted-foreground transition-colors hover:from-primary/15 hover:to-primary/5 hover:text-primary"
              >
                <span className="grid h-9 w-9 place-items-center rounded-full bg-background/80 ring-1 ring-border shadow-sm group-hover:ring-primary/40">
                  {upAvatar ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                </span>
                {editable && (
                  <span className="text-[10px] font-medium tracking-wide uppercase">
                    {lang === "pl" ? "Dodaj zdjęcie" : "Add photo"}
                  </span>
                )}
              </button>
            )}

            {editable && avatarUrl && (
              <button
                type="button"
                onClick={() => avatarInput.current?.click()}
                disabled={upAvatar}
                className={cn(
                  "absolute inset-0 inline-flex flex-col items-center justify-center gap-1 rounded-[7px] bg-black/55 text-white backdrop-blur-[2px] transition-opacity",
                  hoverAvatar || upAvatar ? "opacity-100" : "opacity-0",
                )}
              >
                {upAvatar ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
                <span className="text-[10px] font-medium tracking-wide uppercase">
                  {lang === "pl" ? "Zmień" : "Change"}
                </span>
              </button>
            )}
          </div>

          {/* Social mini-icons bottom-right */}
          {(linkedinUrl || twitterUrl) && (
            <div className="absolute -bottom-1.5 -right-1.5 flex items-center gap-1 z-10">
              {linkedinUrl && (
                <a
                  href={linkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="LinkedIn"
                  className="grid h-6 w-6 place-items-center rounded-full bg-background text-foreground/80 ring-2 ring-background shadow-sm hover:text-primary"
                >
                  <Linkedin className="h-3.5 w-3.5" />
                </a>
              )}
              {twitterUrl && (
                <a
                  href={twitterUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="X"
                  className="grid h-6 w-6 place-items-center rounded-full bg-background text-foreground/80 ring-2 ring-background shadow-sm hover:text-primary"
                >
                  <Twitter className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          )}

          {upAvatar && (
            <div className="absolute -bottom-2 left-1 right-1 z-10">
              <Progress value={progress.avatar} className="h-1" />
            </div>
          )}
        </div>
      </div>


      {/* Hidden file inputs */}
      <input
        ref={coverInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void onUpload(f, "cover"); e.target.value = ""; }}
      />
      <input
        ref={avatarInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void onUpload(f, "avatar"); e.target.value = ""; }}
      />
    </section>
  );
}

/* --------------------------- UI atoms -------------------------------- */

function Card({ icon, title, action, children }: { icon?: ReactNode; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-[6px] border border-border bg-card p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/70">
          {icon ? <span className="text-primary">{icon}</span> : null}
          {title}
        </h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function CompanyLogoIcon({ className = "h-3 w-3" }: { className?: string }) {
  // Logo firmy zaciągane z Admin Panel -> Wygląd -> Theme Options (klucz "theme_options.logo").
  // Wybiera wariant zgodny z aktualnym motywem (light/dark); fallback: ikona Briefcase.
  const cfg = useSiteSetting<{ logo?: { main?: string; main_dark?: string } }>("theme_options", { logo: {} });
  const { theme } = useTheme();
  const l = cfg.logo ?? {};
  const src = theme === "dark" ? (l.main_dark || l.main) : (l.main || l.main_dark);
  if (!src) return <Briefcase className={cn("object-contain", className)} />;
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      className={cn("object-contain", className)}
      loading="lazy"
      decoding="async"
      draggable={false}
    />
  );
}

function Chip({ icon, children, tone = "muted", size = "sm", onClick }: { icon?: ReactNode; children: ReactNode; tone?: "primary" | "muted" | "solid" | "accent"; size?: "sm" | "lg"; onClick?: () => void }) {
  const sizeCls = size === "lg"
    ? "h-8 px-3 py-1.5 text-xs gap-1.5"
    : "h-auto px-2.5 py-1 text-[10px] gap-1";
  const toneCls =
    tone === "solid"
      ? "border border-primary/30 bg-primary/10 text-foreground [&_svg]:text-primary shadow-sm"
      : tone === "accent"
      ? "border border-border bg-muted/60 text-foreground [&_svg]:text-primary"
      : tone === "primary"
      ? "border border-border bg-background text-foreground [&_svg]:text-primary"
      : "border border-border bg-background text-foreground/80 [&_svg]:text-muted-foreground";
  const cls = cn(
    "inline-flex items-center rounded-[6px] font-medium leading-[1.2] whitespace-nowrap transition-colors",
    sizeCls,
    toneCls,
    onClick && "cursor-pointer border-dashed italic hover:bg-accent hover:text-accent-foreground",
  );
  if (onClick) return <button type="button" onClick={onClick} className={cls}>{icon}{children}</button>;
  return <span className={cls}>{icon}{children}</span>;
}


function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-2">
      <dt className="text-[10px] uppercase tracking-wide leading-normal text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

function MiniRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-[6px] px-1.5 py-1 hover:bg-muted/50">
      <span className="flex items-center gap-1.5 text-muted-foreground">{icon}{label}</span>
      <span className="truncate text-foreground/90">{value}</span>
    </div>
  );
}

function Stat({ icon, value, label, to }: { icon: ReactNode; value: number; label: string; to: string }) {
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

function SecondaryLink({ to, icon, children }: { to: string; icon: ReactNode; children: ReactNode }) {
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

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function ContactRow({ icon, ariaLabel, children }: { icon: ReactNode; ariaLabel: string; children: ReactNode }) {
  return (
    <li className="flex min-w-0 items-center gap-3 py-2 first:pt-0 last:pb-0" aria-label={ariaLabel}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-muted/70 text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}

function prettyUrl(url: string): string {
  try {
    const u = new URL(url);
    return (u.host + u.pathname).replace(/\/$/, "").replace(/^www\./, "");
  } catch {
    return url;
  }
}

