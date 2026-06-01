import { Bookmark, BookmarkCheck } from "@/lib/lucide-shim";
import { useAuth } from "@/hooks/useAuth";
import { useIsBookmarked, useToggleBookmark, type BookmarkEntityType } from "@/hooks/useBookmarks";
import { usePersonalizedSettings } from "@/hooks/usePersonalizedSettings";
import { openLoginPopup } from "@/lib/loginPopupBus";
import { toast } from "sonner";

interface Props {
  entityType: BookmarkEntityType;
  entityId: string;
  size?: "sm" | "md";
  className?: string;
}

export function BookmarkButton({ entityType, entityId, size = "md", className = "" }: Props) {
  const { user } = useAuth();
  const settings = usePersonalizedSettings();
  const isOn = useIsBookmarked(entityType, entityId);
  const toggle = useToggleBookmark();

  if (!settings.enabled) return null;

  const Icon = isOn ? BookmarkCheck : Bookmark;
  const iconClass = size === "sm" ? "w-4 h-4" : "w-5 h-5";

  const handleClick = () => {
    if (!user) {
      if (!settings.allowGuests) {
        openLoginPopup({ title: settings.restrictedTitle, description: settings.restrictedDescription });
        return;
      }
    }
    const next = !isOn;
    toggle.mutate(
      { entityType, entityId, on: next },
      {
        onSuccess: () => {
          if (settings.popupNotification && next) {
            toast.success("Dodano do listy", {
              description: "Znajdziesz to w swojej liście do przeczytania.",
              action: { label: "Otwórz", onClick: () => { window.location.href = settings.readingListPath; } },
            });
          }
        },
      },
    );
  };

  return (
    <button
      onClick={handleClick}
      aria-pressed={isOn}
      aria-label={isOn ? "Usuń z listy" : "Zapisz do listy"}
      title={isOn ? "Zapisane" : "Zapisz do przeczytania"}
      className={`inline-flex items-center gap-1.5 text-muted-foreground hover:text-brand transition ${isOn ? "text-brand" : ""} ${className}`}
    >
      <Icon className={iconClass} />
    </button>
  );
}
