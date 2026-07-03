import { useAuth } from "@/hooks/useAuth";
import { useIsFollowing, useToggleFollow, type FollowTargetType } from "@/hooks/useFollows";
import { usePersonalizedSettings } from "@/hooks/usePersonalizedSettings";
import { openLoginPopup } from "@/lib/loginPopupBus";
import { Plus, Check } from "@/lib/lucide-shim";

interface Props {
  targetType: FollowTargetType;
  targetId: string;
  size?: "sm" | "md";
  className?: string;
  labelOn?: string;
  labelOff?: string;
}

export function FollowButton({
  targetType,
  targetId,
  size = "md",
  className = "",
  labelOn = "Obserwujesz",
  labelOff = "Obserwuj",
}: Props) {
  const { user } = useAuth();
  const settings = usePersonalizedSettings();
  const isOn = useIsFollowing(targetType, targetId);
  const toggle = useToggleFollow();
  if (!settings.enabled) return null;

  const handleClick = () => {
    if (!user) {
      openLoginPopup({
        title: settings.restrictedTitle,
        description: settings.restrictedDescription,
      });
      return;
    }
    toggle.mutate({ targetType, targetId, on: !isOn });
  };

  const pad = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm";
  const Icon = isOn ? Check : Plus;
  return (
    <button
      onClick={handleClick}
      className={`inline-flex items-center gap-1.5 rounded-full border transition ${pad} ${
        isOn
          ? "border-brand bg-brand text-brand-foreground"
          : "border-border bg-background hover:bg-muted text-foreground"
      } ${className}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {isOn ? labelOn : labelOff}
    </button>
  );
}
