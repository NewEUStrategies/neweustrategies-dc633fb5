// Awatar prelegenta - spec produktu: zdjecia profilowe maja promien 6px
// (patrz ChatAvatar). Fallback = inicjaly (max 2 znaki) na tle muted.
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import { cn } from "@/lib/utils";
import { PX_BY_SIZE } from "./speakerAvatarSizes";

const SIZES = {
  sm: "h-8 w-8 text-[11px]",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-base",
  xl: "h-20 w-20 text-lg",
  card: "aspect-[4/3] h-auto w-full text-3xl",
} as const;

/**
 * Proporcja kadru. Kafel siatki prelegentów jest poziomym portretem 4:3 -
 * zamówienie kwadratu z magazynu kazałoby przeglądarce ściągnąć 1/3 pikseli
 * więcej i obciąć je `object-cover`.
 */
const RATIO: Partial<Record<keyof typeof SIZES, number>> = { card: 4 / 3 };

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
  // `cn`, nie sklejanie napisów: wywołujący nadpisuje promień (`rounded-none`
  // na kaflu siatki), a dwie klasy `rounded-*` naraz rozstrzygałaby kolejność
  // reguł w arkuszu, nie intencja.
  const boxClass = cn(SIZES[size], "shrink-0 rounded-[6px]", className);
  const ratio = RATIO[size] ?? 1;
  const cropWidth = PX_BY_SIZE[size] * 2;
  if (photoUrl) {
    return (
      <span className={cn(boxClass, "block overflow-hidden bg-muted")}>
        <OptimizedImage
          src={photoUrl}
          alt=""
          aspectRatio={ratio}
          crop={{ width: cropWidth, height: Math.round(cropWidth / ratio), resize: "cover" }}
          // Promień dziedziczony z ramki - inaczej zdjęcie w kaflu bez promienia
          // miałoby zaokrąglone rogi na tle `bg-muted`.
          className="h-full w-full rounded-[inherit] object-cover"
        />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        boxClass,
        "flex items-center justify-center bg-muted font-medium text-muted-foreground",
      )}
    >
      {speakerInitials(name) || "?"}
    </span>
  );
}
