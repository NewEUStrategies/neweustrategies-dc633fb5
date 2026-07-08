// Follow / unfollow toggle for an author, category or tag. Provides the missing
// creation path for follows (the hooks existed but were only ever called with
// on:false, so a reader could never start following anything from an archive
// header). Guests are nudged to sign in; the button hides when the
// personalization system is disabled.
import { useFollows, useToggleFollow, type FollowTargetType } from "@/hooks/useFollows";
import { useAuth } from "@/hooks/useAuth";
import { usePersonalizedSettings } from "@/hooks/usePersonalizedSettings";
import { openLoginPopup } from "@/lib/loginPopupBus";
import { toast } from "sonner";
import { Check, Plus } from "@/lib/lucide-shim";

export function FollowButton({
  targetType,
  targetId,
  lang,
}: {
  targetType: FollowTargetType;
  targetId: string;
  lang: "pl" | "en";
}) {
  const { user } = useAuth();
  const settings = usePersonalizedSettings();
  const { data: follows } = useFollows();
  const toggle = useToggleFollow();

  if (!settings.enabled) return null;

  const t = (pl: string, en: string) => (lang === "en" ? en : pl);
  const following = (follows ?? []).some(
    (f) => f.target_type === targetType && f.target_id === targetId,
  );

  const onClick = () => {
    if (!user) {
      openLoginPopup({
        title: settings.restrictedTitle,
        description: settings.restrictedDescription,
      });
      return;
    }
    toggle.mutate(
      { targetType, targetId, on: !following },
      { onError: () => toast.error(t("Nie udało się", "Something went wrong")) },
    );
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={following}
      disabled={toggle.isPending}
      className={[
        "inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition",
        following
          ? "bg-brand/10 text-brand border border-brand/40"
          : "bg-brand text-brand-foreground hover:opacity-90",
      ].join(" ")}
    >
      {following ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
      {following ? t("Obserwujesz", "Following") : t("Obserwuj", "Follow")}
    </button>
  );
}
