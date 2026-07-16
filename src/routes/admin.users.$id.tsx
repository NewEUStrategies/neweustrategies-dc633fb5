import { XIcon } from "@/components/atoms/XIcon";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { htmlToPlainText } from "@/lib/sanitize";
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
import {
  BADGE_ORDER,
  badgeLabel,
  grantBadge,
  revokeBadge,
  useUserBadges,
} from "@/lib/profile/badges";
import { ProfileBadges } from "@/components/profile/ProfileBadges";
import { AuthorProfileEditor } from "@/components/profile/AuthorProfileEditor";

export const Route = createFileRoute("/admin/users/$id")({
  component: UserDetail,
});

type Role = "super_admin" | "admin" | "editor" | "author" | "user";
const ASSIGNABLE_ROLES: readonly Role[] = ["admin", "editor", "author", "user"];

function UserDetail() {
  const { id } = Route.useParams();
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user, isSuperAdmin, tenantId } = useAuth();
  const locale = i18n.language === "pl" ? "pl-PL" : "en-US";
  const isPL = i18n.language === "pl";
  const L = (pl: string, en: string) => (isPL ? pl : en);

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

  // Weryfikacja zawodowa - kolumna nowsza niż wygenerowane typy (20260713160000).
  const verificationQ = useQuery({
    queryKey: ["admin-user-verification", id],
    queryFn: async (): Promise<{ verified_at: string | null }> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("verified_at" as never)
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? { verified_at: null }) as { verified_at: string | null };
    },
  });
  const [verifyBusy, setVerifyBusy] = useState(false);
  const setVerified = async (next: boolean) => {
    setVerifyBusy(true);
    const { error } = await supabase.rpc(
      "admin_set_profile_verification" as never,
      {
        p_user_id: id,
        p_verified: next,
      } as never,
    );
    setVerifyBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("admin.saved", { defaultValue: L("Zapisano", "Saved") }));
    qc.invalidateQueries({ queryKey: ["admin-user-verification", id] });
  };

  const changeRole = async (role: Role) => {
    const { error } = await supabase.rpc("change_user_role", {
      _target_user_id: id,
      _new_role: role,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("admin.saved", { defaultValue: L("Zapisano", "Saved") }));
    qc.invalidateQueries({ queryKey: ["admin-user", id] });
    qc.invalidateQueries({ queryKey: ["admin", "all-users"] });
  };

  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground">
        {t("admin.loading", { defaultValue: L("Ładowanie...", "Loading...") })}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-2xl">
        <BackLink label={L("Wróć do listy", "Back to list")} />
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground mt-4">
          {L("Nie znaleziono użytkownika.", "User not found.")}
        </div>
      </div>
    );
  }

  const fullName =
    [data.first_name, data.last_name].filter(Boolean).join(" ") || data.display_name || "-";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <BackLink label={L("Wróć do listy", "Back to list")} />
        <div className="flex items-center gap-2">
          {isSuperAdmin && data.id !== user?.id && (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await impersonateUser(data.id, data.display_name ?? data.email ?? data.id);
                  toast.success(L("Tryb podglądu aktywny", "Impersonation active"));
                  window.location.assign("/profile");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Error");
                }
              }}
            >
              <UserCog className="w-4 h-4 mr-2" />
              {L("Zaloguj jako", "Sign in as")}
            </Button>
          )}
          {data.slug && (
            <a
              href={`/author/${data.slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              {L("Profil publiczny", "Public profile")}
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
            label={L("Zmień zdjęcie", "Change photo")}
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
            {data.id === user?.id ? (
              <Badge>{data.roles[0] ?? "-"}</Badge>
            ) : (
              <Select value={data.roles[0] ?? ""} onValueChange={(v) => changeRole(v as Role)}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder={L("Zmień rolę", "Change role")} />
                </SelectTrigger>
                <SelectContent>
                  {isSuperAdmin && <SelectItem value="super_admin">Super admin</SelectItem>}
                  {ASSIGNABLE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(`admin.users.roles.${r}`, {
                        defaultValue: r.charAt(0).toUpperCase() + r.slice(1),
                      })}
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
          <Card title={L("Informacje", "Details")}>
            <InfoRow
              icon={<Briefcase className="w-4 h-4" />}
              label={L("Stanowisko", "Job title")}
              value={data.job_title}
            />
            <InfoRow
              icon={<Briefcase className="w-4 h-4" />}
              label={L("Firma", "Company")}
              value={data.current_company}
            />
            <InfoRow
              icon={<Briefcase className="w-4 h-4" />}
              label={L("Specjalizacja", "Specialization")}
              value={data.specialization}
            />
            <InfoRow
              icon={<MapPin className="w-4 h-4" />}
              label={L("Lokalizacja", "Location")}
              value={data.location}
            />
            <InfoRow icon={<Mail className="w-4 h-4" />} label="Email" value={data.email} isEmail />
            <InfoRow
              icon={<Mail className="w-4 h-4" />}
              label={L("Email kontaktowy", "Contact email")}
              value={data.contact_email}
              isEmail
            />
            <InfoRow
              icon={<Phone className="w-4 h-4" />}
              label={L("Telefon", "Phone")}
              value={data.phone}
            />
          </Card>

          {(data.bio || data.bio_pl || data.bio_en) && (
            <Card title={L("Biogram", "Bio")}>
              {data.bio && <Field label={L("Krótki opis", "Summary")} value={data.bio} multiline />}
              {data.bio_pl && <Field label="Bio (PL)" value={data.bio_pl} multiline />}
              {data.bio_en && <Field label="Bio (EN)" value={data.bio_en} multiline />}
            </Card>
          )}

          <Card title={L("Media społecznościowe", "Social media")}>
            <SocialRow
              icon={<Globe className="w-4 h-4" />}
              label="Website"
              value={data.website_url}
            />
            <SocialRow icon={<XIcon className="w-4 h-4" />} label="X" value={data.twitter_url} />
            <SocialRow
              icon={<Linkedin className="w-4 h-4" />}
              label="LinkedIn"
              value={data.linkedin_url}
            />
            <SocialRow
              icon={<Facebook className="w-4 h-4" />}
              label="Facebook"
              value={data.facebook_url}
            />
            <SocialRow
              icon={<Instagram className="w-4 h-4" />}
              label="Instagram"
              value={data.instagram_url}
            />
            <SocialRow
              icon={<Music2 className="w-4 h-4" />}
              label="Spotify"
              value={data.spotify_url}
            />
          </Card>
        </section>

        {/* Right: meta */}
        <aside className="space-y-6">
          <Card title={L("Metadane", "Metadata")}>
            <Field label="ID" value={data.id} mono />
            <Field label="Slug" value={data.slug} />
            <Field
              label={t("admin.users.created", { defaultValue: L("Utworzono", "Created") })}
              value={new Date(data.created_at).toLocaleString(locale)}
            />
            {data.updated_at && (
              <Field
                label={L("Aktualizacja", "Updated")}
                value={new Date(data.updated_at).toLocaleString(locale)}
              />
            )}
            {data.gender && <Field label={L("Płeć", "Gender")} value={String(data.gender)} />}
          </Card>

          <Card title={L("Odznaki", "Badges")}>
            <BadgesEditor userId={data.id} tenantId={tenantId ?? null} />
          </Card>

          <Card title={L("Zgody prywatności", "Privacy consent")}>
            <UserConsentPanel userId={data.id} isPL={isPL} />
          </Card>

          <Card title={L("Akcje", "Actions")}>
            <div className="flex flex-col gap-2">
              <Link to="/admin/users" className="text-sm text-primary hover:underline">
                {L("Wszyscy użytkownicy", "All users")}
              </Link>
              <Button variant="outline" size="sm" onClick={() => navigate({ to: "/admin/users" })}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                {L("Wróć", "Back")}
              </Button>
            </div>
          </Card>
        </aside>
      </div>

      {/* Edytor pełnego profilu eksperta - 1:1 te same pola co /profile/author.
          RLS pozwala adminowi na zapis do author_profiles + profiles w tenancie. */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4 m-0">
          {L("Profil eksperta (edycja)", "Expert profile (edit)")}
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
      toast.error("Brak kontekstu tenanta");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Plik za duży (max 5 MB)");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Wymagany plik graficzny");
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
      toast.success("Zapisano");
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
function BadgesEditor({ userId, tenantId }: { userId: string; tenantId: string | null }) {
  const { i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const qc = useQueryClient();
  const badgesQ = useUserBadges(userId);
  const current = badgesQ.data ?? [];

  const toggle = async (badge: (typeof BADGE_ORDER)[number], has: boolean) => {
    try {
      if (has) {
        await revokeBadge(userId, badge);
      } else {
        if (!tenantId) throw new Error("tenant");
        await grantBadge(userId, badge, tenantId);
      }
      await qc.invalidateQueries({ queryKey: ["profile-badges"] });
    } catch {
      toast.error(lang === "pl" ? "Nie udało się zmienić odznaki" : "Could not update the badge");
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
              {has ? "− " : "+ "}
              {badgeLabel(badge, lang)}
            </Button>
          );
        })}
      </div>
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

function UserConsentPanel({ userId, isPL }: { userId: string; isPL: boolean }) {
  const L = (pl: string, en: string) => (isPL ? pl : en);
  const locale = isPL ? "pl-PL" : "en-US";
  const CATS: {
    key: "necessary" | "functional" | "analytics" | "marketing";
    pl: string;
    en: string;
  }[] = [
    { key: "necessary", pl: "Niezbędne", en: "Necessary" },
    { key: "functional", pl: "Funkcjonalne", en: "Functional" },
    { key: "analytics", pl: "Analityczne", en: "Analytics" },
    { key: "marketing", pl: "Marketingowe", en: "Marketing" },
  ];

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-user-consent", userId],
    queryFn: async (): Promise<UserConsentResult> => {
      const { data, error } = await supabase.rpc(
        "admin_get_user_consent" as never,
        {
          _user_id: userId,
        } as never,
      );
      if (error) throw error;
      return (data ?? null) as UserConsentResult;
    },
  });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">{L("Ładowanie...", "Loading...")}</div>;
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
      <div className="text-sm text-muted-foreground">
        {L("Użytkownik nie zapisał jeszcze zgód.", "User has not saved consent yet.")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {CATS.map((c) => {
          const on = !!cats[c.key];
          return (
            <li
              key={c.key}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <span>{isPL ? c.pl : c.en}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                  on ? "bg-emerald-500/15 text-emerald-700" : "bg-muted text-muted-foreground"
                }`}
              >
                {on ? L("Zgoda", "Granted") : L("Brak", "Denied")}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {data?.updated_at && (
          <span>
            {L("Aktualizacja:", "Updated:")} {new Date(data.updated_at).toLocaleString(locale)}
          </span>
        )}
        {data?.version && (
          <span>
            {L("Wersja:", "Version:")} {data.version}
          </span>
        )}
      </div>
    </div>
  );
}
