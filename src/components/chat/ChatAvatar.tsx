// Atom: avatar with presence dot for chat surfaces.
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { PresenceDot } from "./PresenceDot";

export interface ChatAvatarProps {
  name: string;
  avatarUrl?: string | null;
  online?: boolean;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}

const SIZES: Record<NonNullable<ChatAvatarProps["size"]>, string> = {
  xs: "h-5 w-5 text-[9px]",
  sm: "h-8 w-8 text-[11px]",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-base",
};

export function ChatAvatar({
  name,
  avatarUrl,
  online = false,
  size = "md",
  className,
}: ChatAvatarProps) {
  const initial = (name || "?").trim().slice(0, 1).toUpperCase();
  return (
    <span className={cn("relative inline-block shrink-0", className)}>
      {/* Product spec: user profile pictures use a 6px corner radius. */}
      <Avatar className={cn(SIZES[size], "rounded-[6px]")}>
        {avatarUrl ? <AvatarImage src={avatarUrl} alt="" className="rounded-[6px]" /> : null}
        <AvatarFallback className="rounded-[6px] font-medium">{initial}</AvatarFallback>
      </Avatar>
      <PresenceDot online={online} className="absolute -bottom-0.5 -right-0.5" />
    </span>
  );
}
