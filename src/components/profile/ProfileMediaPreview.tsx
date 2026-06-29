import { Upload } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface Props {
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  jobTitle: string | null;
  currentCompany: string | null;
  location: string | null;
  bio: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  uploading: "avatar" | "cover" | null;
  progress: { avatar: number; cover: number };
  status: { avatar: "idle" | "uploading" | "success" | "failed"; cover: "idle" | "uploading" | "success" | "failed" };
  onAvatarUrlChange: (url: string) => void;
  onCoverUrlChange: (url: string) => void;
  onAvatarUploadClick: () => void;
  onCoverUploadClick: () => void;
  t: (k: string, v?: Record<string, unknown>) => string;
}

function StatusBadge({
  status,
  percent,
  t,
}: {
  status: "idle" | "uploading" | "success" | "failed";
  percent: number;
  t: (k: string, v?: Record<string, unknown>) => string;
}) {
  if (status === "idle") return null;
  if (status === "uploading") {
    return (
      <div className="grid gap-1">
        <Progress value={percent} className="h-1.5" />
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {t("profile.account.uploadProgress", { percent })}
        </p>
      </div>
    );
  }
  const cls =
    status === "success"
      ? "text-green-600 dark:text-green-400"
      : "text-destructive";
  return (
    <p className={`text-xs ${cls}`} role="status" aria-live="polite">
      {t(status === "success" ? "profile.account.uploadSuccess" : "profile.account.uploadFailed")}
    </p>
  );
}

export function ProfileMediaPreview({
  firstName,
  lastName,
  displayName,
  jobTitle,
  currentCompany,
  location,
  bio,
  avatarUrl,
  coverUrl,
  uploading,
  progress,
  status,
  onAvatarUrlChange,
  onCoverUrlChange,
  onAvatarUploadClick,
  onCoverUploadClick,
  t,
}: Props) {
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || displayName || "";
  const headline = [jobTitle, currentCompany].filter(Boolean).join(" · ") || null;

  return (
    <div className="grid gap-4">
      {/* Visual public-profile card preview */}
      <div className="relative overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {/* Cover banner */}
        <div className="relative h-32 sm:h-40 w-full overflow-hidden bg-muted">
          {coverUrl ? (
            <img src={coverUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
              {t("profile.account.coverPlaceholder")}
            </div>
          )}
        </div>

        {/* Avatar + info overlay */}
        <div className="relative px-4 pb-5 sm:px-6">
          <div className="flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-4">
            {/* Avatar */}
            <div className="shrink-0 -mt-10 sm:-mt-12">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={fullName}
                  className="h-20 w-20 sm:h-24 sm:w-24 rounded-full object-cover border-[3px] border-background shadow-md bg-background"
                />
              ) : (
                <div className="h-20 w-20 sm:h-24 sm:w-24 rounded-full bg-muted border-[3px] border-background shadow-md flex items-center justify-center text-xs text-muted-foreground">
                  {t("profile.account.avatarPlaceholder")}
                </div>
              )}
            </div>

            {/* Text block */}
            <div className="flex-1 min-w-0 space-y-0.5 pb-0.5">
              <h3 className="text-base sm:text-lg font-semibold tracking-tight truncate">
                {displayName || fullName || t("profile.account.unnamed")}
              </h3>
              {headline && (
                <p className="text-xs sm:text-sm text-muted-foreground truncate">
                  {headline}
                </p>
              )}
              {location && (
                <p className="text-xs text-muted-foreground truncate">
                  {location}
                </p>
              )}
              {bio && (
                <p className="text-xs sm:text-sm text-foreground/80 line-clamp-2 mt-1">
                  {bio}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Avatar controls */}
        <div className="grid gap-2">
          <span className="text-sm font-medium">{t("profile.account.avatar")}</span>
          <div className="flex items-center gap-2">
            <Input
              value={avatarUrl ?? ""}
              onChange={(e) => onAvatarUrlChange(e.target.value)}
              placeholder="https://..."
              className="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onAvatarUploadClick}
              disabled={uploading === "avatar"}
            >
              <Upload className="h-4 w-4 mr-1.5" />
              {uploading === "avatar" ? t("profile.account.uploading") : t("profile.account.uploadAvatar")}
            </Button>
          </div>
          <StatusBadge status={status.avatar} percent={progress.avatar} t={t} />
          <p className="text-xs text-muted-foreground">{t("profile.account.avatarHint")}</p>
        </div>

        {/* Cover controls */}
        <div className="grid gap-2">
          <span className="text-sm font-medium">{t("profile.account.cover")}</span>
          <div className="flex items-center gap-2">
            <Input
              value={coverUrl ?? ""}
              onChange={(e) => onCoverUrlChange(e.target.value)}
              placeholder="https://..."
              className="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCoverUploadClick}
              disabled={uploading === "cover"}
            >
              <Upload className="h-4 w-4 mr-1.5" />
              {uploading === "cover" ? t("profile.account.uploading") : t("profile.account.uploadCover")}
            </Button>
          </div>
          <StatusBadge status={status.cover} percent={progress.cover} t={t} />
          <p className="text-xs text-muted-foreground">{t("profile.account.coverHint")}</p>
        </div>
      </div>
    </div>
  );
}
