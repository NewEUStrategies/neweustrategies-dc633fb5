import { useTranslation } from "react-i18next";
import { Users } from "@/lib/lucide-shim";
import { useEditPresence } from "@/hooks/useEditPresence";

interface EditPresenceBannerProps {
  entityType: "post" | "page";
  entityId: string | null | undefined;
}

/**
 * Molecule: soft edit-lock awareness. Shows who else has this entity open in
 * the editor right now (Supabase Realtime presence), so concurrent edits are
 * a conscious decision instead of a silent overwrite.
 */
export function EditPresenceBanner({ entityType, entityId }: EditPresenceBannerProps) {
  const { t } = useTranslation();
  const peers = useEditPresence(entityType, entityId);
  if (!peers.length) return null;

  const names = peers.map((p) => p.name).join(", ");
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 rounded-lg border border-brand/100/40 bg-brand/100/10 px-3 py-2 text-xs text-brand-ink dark:text-brand"
    >
      <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        {t("admin.presence.editingNow", {
          names,
        })}
      </span>
    </div>
  );
}
