import { useRef, useState } from "react";
import { Camera, Image as ImageIcon, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

type UploadKind = "avatar" | "cover";
type Status = "idle" | "uploading" | "success" | "failed";

interface Props {
  avatarUrl: string | null;
  coverUrl: string | null;
  fullName: string;
  onUpload: (file: File, kind: UploadKind) => Promise<void>;
  status: Record<UploadKind, Status>;
  progress: Record<UploadKind, number>;
  t: (k: string) => string;
}

const ACCEPT = "image/jpeg,image/png,image/webp,image/avif";

export function InlineMedia({
  avatarUrl,
  coverUrl,
  fullName,
  onUpload,
  status,
  progress,
  t,
}: Props) {
  const avatarInput = useRef<HTMLInputElement | null>(null);
  const coverInput = useRef<HTMLInputElement | null>(null);
  const [hoverCover, setHoverCover] = useState(false);
  const [hoverAvatar, setHoverAvatar] = useState(false);

  const initial = fullName.trim().charAt(0).toUpperCase() || "·";
  const upCover = status.cover === "uploading";
  const upAvatar = status.avatar === "uploading";

  return (
    <div className="relative">
      {/* Cover */}
      <div
        className="relative h-28 sm:h-36 md:h-44 w-full overflow-hidden rounded-[6px] bg-muted"
        onMouseEnter={() => setHoverCover(true)}
        onMouseLeave={() => setHoverCover(false)}
      >
        {coverUrl ? (
          <img src={coverUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[11px] text-muted-foreground">
            <ImageIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {t("profile.account.coverPlaceholder")}
          </div>
        )}
        {/* Hover overlay */}
        <button
          type="button"
          onClick={() => coverInput.current?.click()}
          disabled={upCover}
          aria-label={t("profile.account.uploadCover")}
          className={cn(
            "absolute right-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-[6px] border border-white/30 bg-black/45 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-md transition-opacity hover:bg-black/60 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-white/60",
            hoverCover || upCover ? "opacity-100" : "opacity-0",
          )}
        >
          {upCover ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
          {upCover ? t("profile.account.uploading") : t("profile.account.uploadCover")}
        </button>
        {upCover && (
          <div className="absolute inset-x-2.5 bottom-2.5">
            <Progress value={progress.cover} className="h-1" />
          </div>
        )}
      </div>

      {/* Avatar - overlapping */}
      <div
        className="absolute left-4 sm:left-5 -bottom-8 sm:-bottom-10"
        onMouseEnter={() => setHoverAvatar(true)}
        onMouseLeave={() => setHoverAvatar(false)}
      >
        <div className="relative h-16 w-16 sm:h-20 sm:w-20">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={fullName}
              className="h-full w-full rounded-[6px] ring-2 ring-background bg-background object-cover shadow-sm"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center rounded-[6px] ring-2 ring-background bg-gradient-to-br from-primary/30 to-primary/10 text-xl sm:text-2xl font-semibold text-primary shadow-sm">
              {initial}
            </div>
          )}
          <button
            type="button"
            onClick={() => avatarInput.current?.click()}
            disabled={upAvatar}
            aria-label={t("profile.account.uploadAvatar")}
            className={cn(
              "absolute inset-0 inline-flex items-center justify-center rounded-[6px] bg-black/55 text-white backdrop-blur-[2px] transition-opacity focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-white/60",
              hoverAvatar || upAvatar ? "opacity-100" : "opacity-0",
            )}
          >
            {upAvatar ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Camera className="h-4 w-4" />
            )}
          </button>
          {upAvatar && (
            <div className="absolute -bottom-2 left-0 right-0">
              <Progress value={progress.avatar} className="h-1" />
            </div>
          )}
        </div>
      </div>

      {/* Hidden inputs */}
      <input
        ref={coverInput}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onUpload(f, "cover");
          e.target.value = "";
        }}
      />
      <input
        ref={avatarInput}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onUpload(f, "avatar");
          e.target.value = "";
        }}
      />
    </div>
  );
}
