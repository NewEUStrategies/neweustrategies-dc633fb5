import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useFaceAwarePosition } from "@/hooks/useFaceAwarePosition";
import { cn } from "@/lib/utils";

type Props = {
  url?: string | null;
  name: string;
  initials: string;
  className?: string;
  fallbackClassName?: string;
};

/**
 * Avatar z automatycznym kadrowaniem twarzy (FaceDetector API + fallback 50% 30%)
 * oraz 6 px zaokrągleniem zgodnym z globalnym systemem designu.
 */
export function FaceAwareAvatar({ url, name, initials, className, fallbackClassName }: Props) {
  const position = useFaceAwarePosition(url);
  return (
    <Avatar
      className={cn(
        "h-7 w-7 shrink-0 overflow-hidden rounded-[6px] border border-border/60",
        className,
      )}
    >
      {url ? (
        <AvatarImage
          src={url}
          alt={name}
          className="h-full w-full object-cover"
          style={{ objectPosition: position }}
        />
      ) : null}
      <AvatarFallback
        className={cn(
          "rounded-[6px] bg-muted text-[10px] font-medium text-muted-foreground",
          fallbackClassName,
        )}
      >
        {initials.toUpperCase().slice(0, 2)}
      </AvatarFallback>
    </Avatar>
  );
}
