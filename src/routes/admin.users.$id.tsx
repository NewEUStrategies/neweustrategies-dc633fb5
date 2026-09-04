import { XIcon } from "@/components/atoms/XIcon";
import { useLang } from "@/lib/i18n/useLang";
import { BrandIcon } from "@/components/atoms/BrandIcon";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ensureI18n as ensureAdminUsersI18n } from "@/lib/i18n-admin-users";
import { ROLE_LABEL_KEYS } from "@/lib/authz/roleLabels";
import type { AppRole } from "@/lib/authz/roles";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { htmlToPlainText } from "@/lib/sanitizePure";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { ImageCropDialog, CROP_PRESETS } from "@/components/media/ImageCropDialog";
import {
  ArrowLeft,
  UserCog,
  ExternalLink,
  Mail,
  Phone,
  Briefcase,
  MapPin,
  Globe,
  // Twitter removed - use XIcon
  Linkedin,
  Facebook,
  Instagram,
  Music2,
  Camera,
  Loader2,
  BadgeCheck,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { impersonateUser } from "@/lib/admin/impersonation";
import { BADGE_ORDER, badgeLabel, useUserBadges } from "@/lib/profile/badges";
import { grantBadge, revokeUserBadge } from "@/lib/admin/badges";
import { ProfileBadges } from "@/components/profile/ProfileBadges";
import { AuthorProfileEditor } from "@/components/profile/AuthorProfileEditor";
import { adminToast } from "@/lib/adminToasts";
import { uiLocale } from "@/lib/i18n/format";

export const Route = createFileRoute("/admin/users/$id")({
  component: UserDetail,
});

type Role = AppRole;
const ASSIGNABLE_ROLES: readonly Role[] = ["admin", "editor", "author", "user"];

function UserDetail() {
  // Rejestracja słownika w chunku KOMPONENTU trasy (nie w entry) - patrz
  // komentarz przy ensureI18n w lib/i18n-admin-users.ts.
  ensureAdminUsersI18n();
  const { id } = Route.useParams();
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user, isAdmin, isSuperAdmin, tenantId } = useAuth();
  const locale = uiLocale(i18n.language);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-user", id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_user", { _user_id: id });
      if (error) throw error;
      const row = (data ?? [])[0];
      if (!row) return null;
      return { ...row, roles: (row.roles ?? []) as Role[] };
    },
  });

  const changeRole = async (role: Role) => {
    const { error } = await supabase.rpc("change_user_role", {
      _target_user_id: id,
      _new_role: role,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("admin.saved"));
    qc.invalidateQueries({ queryKey: ["admin-user", id] });
    qc.invalidateQueries({ queryKey: ["admin", "all-users"] });
  };

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">{t("admin.loading")}</div>;
  }

  if (error || !data) {
    return (
      <div className="max-w-2xl">
        <BackLink label={t("adminUsers.backList")} />
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground mt-4">
          {t("adminUsers.userFound")}
        </div>
      </div>
    );
  }

  const fullName =
    [data.first_name, data.last_name].filter(Boolean).join(" ") || data.display_name || "-";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <BackLink label={t("adminUsers.backList")} />
        <div className="flex items-center gap-2">
          {isSuperAdmin && data.id !== user?.id && (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await impersonateUser(data.id, data.display_name ?? data.email ?? data.id);
                  toast.success(t("adminUsers.impersonationActive"));
                  window.location.assign("/profile");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Error");
                }
              }}
            >
              <UserCog className="w-4 h-4 mr-2" />
              {t("adminUsers.sign")}
            </Button>
          )}
          {data.slug && (
            <a
              href={`/author/${data.slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              {t("adminUsers.publicProfile")}
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>

      {/* Hero */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {data.cover_url ? (
          <img src={data.cover_url} alt="" className="w-full h-48 md:h-56 object-cover" />
        ) : (
          <div className="w-full h-24 bg-gradient-to-r from-muted/40 to-muted/20" />
        )}
        <div className="p-5 md:p-6 flex flex-col md:flex-row md:items-end gap-4 md:gap-6 -mt-12 md:-mt-16">
          <AvatarEditor
            userId={data.id}
            tenantId={tenantId}
            avatarUrl={data.avatar_url}
            canEdit={isSuperAdmin}
            onUpdated={() => qc.invalidateQueries({ queryKey: ["admin-user", id] })}
            label={t("adminUsers.changePhoto")}
          />

          <div className="flex-1 min-w-0">
            <h1 className="font-display text-2xl md:text-3xl font-bold truncate">{fullName}</h1>
            {data.display_name && data.display_name !== fullName && (
              <p className="text-sm text-muted-foreground m-0">@{data.display_name}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {data.roles.length === 0 ? (
                <Badge variant="secondary">user</Badge>
              ) : (
                data.roles.map((r) => (
                  <Badge key={r} variant="secondary">
                    {r}
                  </Badge>
                ))
              )}
            </div>
          </div>
          <div className="md:self-center">
            {/*
              Droplista zmiany roli należy do ADMINA, nie do całego personelu.
              `/admin` przepuszcza każdego `isStaff` (admin, editor, author), więc
              redaktor otwierający `/admin/users/<id>` widział pełną listę ról -
              a każde jej użycie kończyło się `not_authorized` z RPC
              `change_user_role` (autorytet po stronie bazy jest szczelny: wymaga
              `admin` albo `super_admin`, zabrania zmiany własnej roli, pilnuje
              najemcy i pisze wpis audytowy). Panel oferował więc akcję, która
              nigdy nie mogła się udać - i wyglądał, jakby redaktor nadawał role.
              Uprawnienie do NADANIA `super_admin` zostaje ostrzejsze (`isSuperAdmin`),
              zgodnie z tym samym RPC.
            */}
            {data.id === user?.id || !(isAdmin || isSuperAdmin) ? (
              <Badge>{data.roles[0] ?? "-"}</Badge>
            ) : (
              <Select value={data.roles[0] ?? ""} onValueChange={(v) => changeRole(v as Role)}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder={t("adminUsers.changeRole")} />
                </SelectTrigger>
                <SelectContent>
                  {isSuperAdmin && (
                    <SelectItem value="super_admin">
                      {t("admin.users.roles.super_admin")}
                    </SelectItem>
                  )}
                  {ASSIGNABLE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(ROLE_LABEL_KEYS[r])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: about */}
        <section className="lg:col-span-2 space-y-6">
          <Card title={t("adminUsers.details")}>
            <InfoRow
              icon={<Briefcase className="w-4 h-4" />}
              label={t("adminUsers.jobTitle")}
              value={data.job_title}
            />
            <InfoRow
              icon={<Briefcase className="w-4 h-4" />}
              label={t("adminUsers.company")}
              value={data.current_company}
            />
            <InfoRow
              icon={<Briefcase className="w-4 h-4" />}
              label={t("adminUsers.specialization")}
              value={data.specialization}
            />
            <InfoRow
              icon={<MapPin className="w-4 h-4" />}
              label={t("adminUsers.location")}
              value={data.location}
            />
            <InfoRow icon={<Mail className="w-4 h-4" />} label="Email" value={data.email} isEmail />
            <InfoRow
              icon={<Mail className="w-4 h-4" />}
              label={t("adminUsers.contactEmail")}
              value={data.contact_email}
              isEmail
            />
            <InfoRow
              icon={<Phone className="w-4 h-4" />}
              label={t("adminUsers.phone")}
              value={data.phone}
            />
          </Card>

          {(data.bio || data.bio_pl || data.bio_en) && (
            <Card title={t("adminUsers.bio")}>
              {data.bio && <Field label={t("adminUsers.summary")} value={data.bio} multiline />}
              {data.bio_pl && <Field label="Bio (PL)" value={data.bio_pl} multiline />}
              {data.bio_en && <Field label="Bio (EN)" value={data.bio_en} multiline />}
            </Card>
          )}

          <Card title={t("adminUsers.socialMedia")}>
            <SocialRow
              icon={<BrandIcon name="website" fallback={Globe} className="w-4 h-4" />}
              label="Website"
              value={data.website_url}
            />
            <SocialRow
              icon={<BrandIcon name="x" fallback={XIcon} className="w-4 h-4" />}
              label="X"
              value={data.twitter_url}
            />
            <SocialRow
              icon={<BrandIcon name="linkedin" fallback={Linkedin} className="w-4 h-4" />}
              label="LinkedIn"
              value={data.linkedin_url}
            />
            <SocialRow
              icon={<BrandIcon name="facebook" fallback={Facebook} className="w-4 h-4" />}
              label="Facebook"
              value={data.facebook_url}
            />
            <SocialRow
              icon={<BrandIcon name="instagram" fallback={Instagram} className="w-4 h-4" />}
              label="Instagram"
              value={data.instagram_url}
            />
            <SocialRow
              icon={<BrandIcon name="spotify" fallback={Music2} className="w-4 h-4" />}
              label="Spotify"
              value={data.spotify_url}
            />
          </Card>
        </section>

        {/* Right: meta */}
        <aside className="space-y-6">
          <Card title={t("adminUsers.metadata")}>
            <Field label="ID" value={data.id} mono />
            <Field label="Slug" value={data.slug} />
            <Field
              label={t("admin.users.created")}
              value={new Date(data.created_at).toLocaleString(locale)}
            />
            {data.updated_at && (
              <Field
                label={t("adminUsers.updated")}
                value={new Date(data.updated_at).toLocaleString(locale)}
              />
            )}
            {data.gender && <Field label={t("adminUsers.gender")} value={String(data.gender)} />}
          </Card>

          <Card title={t("adminUsers.professionalVerification")}>
            <VerificationAdminToggle userId={data.id} canEdit={isAdmin} />
          </Card>

          <Card title={t("adminUsers.badges")}>
            <BadgesEditor userId={data.id} />
          </Card>

          <Card title={t("adminUsers.privacyConsent")}>
            <UserConsentPanel userId={data.id} />
          </Card>

          <Card title={t("adminUsers.expertRequests")}>
            <ExpertRequestsAdminToggle userId={data.id} />
          </Card>

          <Card title={t("adminUsers.actions")}>
            <div className="flex flex-col gap-2">
              <Link to="/admin/users" className="text-sm text-primary hover:underline">
                {t("adminUsers.allUsers")}
              </Link>
              <Button variant="outline" size="sm" onClick={() => navigate({ to: "/admin/users" })}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                {t("adminUsers.back")}
              </Button>
            </div>
          </Card>
        </aside>
      </div>

      {/* Edytor pełnego profilu eksperta - 1:1 te same pola co /profile/author.
          RLS pozwala adminowi na zapis do author_profiles + profiles w tenancie. */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4 m-0">
          {t("adminUsers.expertProfileEdit")}
        </h2>
        <AuthorProfileEditor userId={data.id} tenantId={tenantId ?? null} mode="admin" />
      </div>
    </div>
  );
}

function BackLink({ label }: { label: string }) {
  return (
    <Link
      to="/admin/users"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="w-4 h-4" />
      {label}
    </Link>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4 m-0">
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
  isEmail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  isEmail?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 text-sm">
      <span className="text-muted-foreground mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        {isEmail ? (
          <a href={`mailto:${value}`} className="text-primary hover:underline break-all">
            {value}
          </a>
        ) : (
          <div className="break-words">{value}</div>
        )}
      </div>
    </div>
  );
}

function SocialRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
}) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-muted-foreground">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <a
          href={value}
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline break-all inline-flex items-center gap-1"
        >
          {value}
          <ExternalLink className="w-3 h-3 shrink-0" />
        </a>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  multiline,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  multiline?: boolean;
}) {
  if (!value) return null;
  const clean = multiline ? htmlToPlainText(value) : value;
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground mb-1">{label}</div>
      <div
        className={`text-sm ${mono ? "font-mono text-xs" : ""} ${multiline ? "whitespace-pre-line" : ""} break-words`}
      >
        {clean}
      </div>
    </div>
  );
}

function AvatarEditor({
  userId,
  tenantId,
  avatarUrl,
  canEdit,
  onUpdated,
  label,
}: {
  userId: string;
  tenantId: string | null;
  avatarUrl: string | null;
  canEdit: boolean;
  onUpdated: () => void;
  label: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [cropOpen, setCropOpen] = useState(false);

  const handlePick = (file: File) => {
    if (!tenantId) {
      toast.error(adminToast.missingTenant());
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error(adminToast.fileTooBig());
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error(adminToast.imageRequired());
      return;
    }
    setPendingFile(file);
    setCropOpen(true);
  };

  const handleUpload = async (blob: Blob) => {
    if (!tenantId) return;
    setBusy(true);
    try {
      const path = tenantId + "/users/" + userId + "/avatar-" + Date.now() + ".jpg";
      const { data: signed, error: signErr } = await supabase.storage
        .from("media")
        .createSignedUploadUrl(path);
      if (signErr || !signed) throw signErr ?? new Error("sign failed");
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", signed.signedUrl);
        xhr.setRequestHeader("Content-Type", "image/jpeg");
        xhr.setRequestHeader("x-upsert", "true");
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error("HTTP " + xhr.status));
        xhr.onerror = () => reject(new Error("network"));
        xhr.send(blob);
      });
      const { data: pub } = supabase.storage.from("media").getPublicUrl(path);
      const { error: updErr } = await supabase.rpc("admin_update_user_avatar", {
        _user_id: userId,
        _avatar_url: pub.publicUrl,
      });
      if (updErr) throw updErr;
      toast.success(adminToast.saved());
      onUpdated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      setPendingFile(null);
    }
  };

  return (
    <div className="relative group">
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          className="w-24 h-24 md:w-28 md:h-28 rounded-md object-cover border-4 border-card shadow-sm"
        />
      ) : (
        <div className="w-24 h-24 md:w-28 md:h-28 rounded-md bg-muted border-4 border-card" />
      )}
      {canEdit && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handlePick(f);
              e.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="absolute inset-0 rounded-md flex items-center justify-center bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-100"
            aria-label={label}
            title={label}
          >
            {busy ? <Loader2 className="w-6 h-6 animate-spin" /> : <Camera className="w-6 h-6" />}
          </button>
          <ImageCropDialog
            open={cropOpen}
            file={pendingFile}
            kind="avatar"
            preset={CROP_PRESETS.avatar}
            onOpenChange={(o) => {
              setCropOpen(o);
              if (!o) setPendingFile(null);
            }}
            onConfirm={(blob) => void handleUpload(blob)}
          />
        </>
      )}
    </div>
  );
}

// Nadawanie/odbieranie odznak profilowych (verified/expert/contributor/staff).
// Nadanie triggeruje w DB powiadomienie do użytkownika.
function BadgesEditor({ userId }: { userId: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const qc = useQueryClient();
  const badgesQ = useUserBadges(userId);
  const current = badgesQ.data ?? [];

  const toggle = async (badge: (typeof BADGE_ORDER)[number], has: boolean) => {
    try {
      if (has) {
        await revokeUserBadge(userId, badge);
      } else {
        await grantBadge(userId, badge);
      }
      await qc.invalidateQueries({ queryKey: ["profile-badges"] });
    } catch {
      toast.error(t("adminUsers.couldUpdateBadge"));
    }
  };

  return (
    <div className="space-y-2">
      <ProfileBadges badges={current} size="md" />
      <div className="flex flex-wrap gap-2">
        {BADGE_ORDER.map((badge) => {
          const has = current.includes(badge);
          return (
            <Button
              key={badge}
              type="button"
              size="sm"
              variant={has ? "default" : "outline"}
              disabled={badgesQ.isLoading}
              onClick={() => void toggle(badge, has)}
            >
              {has ? "- " : "+ "}
              {badgeLabel(badge, lang)}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

// Weryfikacja zawodowa (profiles.verified_at / verified_by) - sygnał, który
// napędza flagę `verified` w katalogu osób (search_people) i filtr
// p_verified_only. Odczyt wprost z profiles (kolumnowy grant SELECT na
// verified_at + polityka "Profiles authenticated read" dla stafu w tenancie),
// zapis WYŁĄCZNIE przez SECURITY DEFINER admin_set_profile_verification:
// profiles UPDATE jest own-row, a pola weryfikacji dodatkowo pilnuje trigger
// profiles_guard_verification (admin | super_admin, 42501 - migracja
// 20260806130000). `canEdit` to klientowe odbicie TEGO SAMEGO zbioru rol:
// /admin jest otwarty dla is_staff (także editor/author), więc bez tego
// przełącznik odpowiadałby edytorowi surowym 42501.
function VerificationAdminToggle({ userId, canEdit }: { userId: string; canEdit: boolean }) {
  const { t } = useTranslation();
  const locale = uiLocale(useLang());
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  // Kolumna nowsza niż wygenerowane typy (20260713160000) - stąd rzutowania.
  const q = useQuery({
    queryKey: ["admin-user-verification", userId],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("verified_at" as never)
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      return (data as { verified_at?: string | null } | null)?.verified_at ?? null;
    },
  });
  const verifiedAt = q.data ?? null;

  const setVerified = async (next: boolean) => {
    setBusy(true);
    const { error } = await supabase.rpc("admin_set_profile_verification", {
      p_user_id: userId,
      p_verified: next,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("adminUsers.saved"));
    qc.invalidateQueries({ queryKey: ["admin-user-verification", userId] });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium inline-flex items-center gap-1.5">
            <BadgeCheck
              className={`w-4 h-4 shrink-0 ${verifiedAt ? "text-primary" : "text-muted-foreground"}`}
            />
            {t("adminUsers.profileVerified")}
          </p>
          <p className="text-xs text-muted-foreground">
            {verifiedAt
              ? t("adminUsers.verifiedAt", {
                  at: new Date(verifiedAt).toLocaleString(locale),
                })
              : t("adminUsers.verificationDrivesBadge")}
          </p>
        </div>
        <Switch
          checked={verifiedAt !== null}
          disabled={!canEdit || q.isLoading || busy}
          onCheckedChange={(v) => void setVerified(v)}
          aria-label={t("adminUsers.professionalVerification")}
        />
      </div>
      <p className="text-xs text-muted-foreground m-0">
        {canEdit
          ? t("adminUsers.manualGrantIndependentEMail")
          : t("adminUsers.changingRequiresAdminSuperAdmin")}
      </p>
    </div>
  );
}

// Przełącznik admina: czy pokazywać przycisk "Zapytanie do eksperta" na profilu
// tego użytkownika. Odczyt wprost z profiles (admin=staff, RLS pozwala), zapis
// przez SECURITY DEFINER admin_set_expert_requests_enabled (profiles UPDATE jest
// own-row only). Uzupełnia globalny przełącznik w /admin/community.
function ExpertRequestsAdminToggle({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["admin-user-expert-requests", userId],
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("expert_requests_enabled" as never)
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      return (
        (data as { expert_requests_enabled?: boolean } | null)?.expert_requests_enabled ?? true
      );
    },
  });
  const on = q.data ?? true;

  const setEnabled = async (next: boolean) => {
    setBusy(true);
    const { error } = await supabase.rpc("admin_set_expert_requests_enabled", {
      p_user_id: userId,
      p_enabled: next,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("adminUsers.saved"));
    qc.invalidateQueries({ queryKey: ["admin-user-expert-requests", userId] });
  };

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{t("adminUsers.showRequestButton")}</p>
        <p className="text-xs text-muted-foreground">{t("adminUsers.askExpertButtonOnProfile")}</p>
      </div>
      <Switch
        checked={on}
        disabled={q.isLoading || busy}
        onCheckedChange={(v) => void setEnabled(v)}
        aria-label={t("adminUsers.expertRequests")}
      />
    </div>
  );
}

// Panel podglądu zgód użytkownika. Dane pobieramy przez RPC
// admin_get_user_consent (security definer) - RLS na profiles nie musi być
// otwarte dla adminów. Wynik: jsonb { categories, updated_at, version }.
type UserConsentResult = {
  categories?: Partial<Record<"necessary" | "functional" | "analytics" | "marketing", boolean>>;
  updated_at?: string | null;
  version?: string | null;
} | null;

// Kategorie zgód w kolejności, w jakiej pokazuje je banner cookies
// (`necessary` zawsze pierwsza). Klucze etykiet trzymamy jawnie zamiast sklejać
// je z `key`: statyczny klucz widzi bramka dryfu `check:i18n-parity`, sklejony
// nie - a brak tłumaczenia wyszedłby dopiero na produkcji.
const CONSENT_CATEGORIES = [
  { key: "necessary", labelKey: "adminUsers.consentNecessary" },
  { key: "functional", labelKey: "adminUsers.consentFunctional" },
  { key: "analytics", labelKey: "adminUsers.consentAnalytics" },
  { key: "marketing", labelKey: "adminUsers.consentMarketing" },
] as const;

function UserConsentPanel({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const locale = uiLocale(useLang());
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-user-consent", userId],
    queryFn: async (): Promise<UserConsentResult> => {
      const { data, error } = await supabase.rpc("admin_get_user_consent", {
        _user_id: userId,
      });
      if (error) throw error;
      return (data ?? null) as UserConsentResult;
    },
  });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">{t("adminUsers.loading")}</div>;
  }
  if (error) {
    return (
      <div className="text-sm text-destructive">
        {error instanceof Error ? error.message : "Error"}
      </div>
    );
  }
  const cats = data?.categories ?? {};
  const hasAny = data && (data.updated_at || Object.keys(cats).length > 0);
  if (!hasAny) {
    return (
      <div className="text-sm text-muted-foreground">{t("adminUsers.userHasSavedConsentYet")}</div>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {CONSENT_CATEGORIES.map((c) => {
          const on = !!cats[c.key];
          return (
            <li
              key={c.key}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <span>{t(c.labelKey)}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                  on ? "bg-emerald-500/15 text-emerald-700" : "bg-muted text-muted-foreground"
                }`}
              >
                {on ? t("adminUsers.granted") : t("adminUsers.denied")}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {data?.updated_at && (
          <span>
            {t("adminUsers.updated2")} {new Date(data.updated_at).toLocaleString(locale)}
          </span>
        )}
        {data?.version && (
          <span>
            {t("adminUsers.version")} {data.version}
          </span>
        )}
      </div>
    </div>
  );
}
