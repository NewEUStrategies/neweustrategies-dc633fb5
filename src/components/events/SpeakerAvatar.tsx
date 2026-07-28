// Awatar prelegenta - spec produktu: zdjecia profilowe maja promien 6px
// (patrz ChatAvatar). Fallback = inicjaly (max 2 znaki) na tle muted.
import { OptimizedImage } from "@/components/atoms/OptimizedImage";

const SIZES = {
  sm: "h-8 w-8 text-[11px]",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-base",
  xl: "h-20 w-20 text-lg",
} as const;

export type SpeakerAvatarSize = keyof typeof SIZES;

function speakerInitials(name: string): string {
  const parts = name
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

interface SpeakerAvatarProps {
  name: string;
  photoUrl?: string | null;
  size?: SpeakerAvatarSize;
  className?: string;
}

export function SpeakerAvatar({ name, photoUrl, size = "md", className }: SpeakerAvatarProps) {
  const boxClass = `${SIZES[size]} shrink-0 rounded-[6px] ${className ?? ""}`;
  if (photoUrl) {
    return (
      <span className={`${boxClass} block overflow-hidden bg-muted`}>
        <OptimizedImage
          src={photoUrl}
          alt=""
          aspectRatio={1}
          className="h-full w-full rounded-[6px] object-cover"
        />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={`${boxClass} flex items-center justify-center bg-muted font-medium text-muted-foreground`}
    >
      {speakerInitials(name) || "?"}
    </span>
  );
}
