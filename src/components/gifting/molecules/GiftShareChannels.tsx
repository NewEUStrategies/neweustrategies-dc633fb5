// Molekuła: siatka kanałów udostępniania gotowego linku.
// Siedem kanałów w jednym rzędzie na desktopie; na wąskich ekranach popover ma
// szerokość viewportu minus margines, więc siatka 7-kolumnowa nadal mieści się
// bez przewijania poziomego (ikony 15px w polach 36px).
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { Facebook, Linkedin, Mail, Share2 } from "@/lib/lucide-shim";
import { XIcon } from "@/components/atoms/XIcon";
import { GiftChannelLink } from "@/components/gifting/atoms/GiftChannelLink";
import type { GiftChannelId, GiftShareTarget } from "@/lib/gifting/model";
import "@/lib/i18n-gifting";

type ChannelIcon = ComponentType<{ className?: string }>;

/** Fallbacki, gdy BrandIcon nie ma ikony marki w rejestrze. */
const CHANNEL_FALLBACK_ICONS: Record<GiftChannelId, ChannelIcon> = {
  mail: Mail,
  facebook: Facebook,
  linkedin: Linkedin,
  whatsapp: Share2,
  telegram: Share2,
  x: XIcon,
  reddit: Share2,
};

interface GiftShareChannelsProps {
  targets: readonly GiftShareTarget[];
}

export function GiftShareChannels({ targets }: GiftShareChannelsProps) {
  const { t } = useTranslation();
  if (targets.length === 0) return null;

  return (
    <>
      <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mt-3 mb-1.5">
        {t("gifting.shareVia")}
      </p>
      <div className="grid grid-cols-7 gap-1">
        {targets.map((target) => (
          <GiftChannelLink
            key={target.id}
            id={target.id}
            href={target.href}
            label={t(`gifting.channels.${target.id}`)}
            fallbackIcon={CHANNEL_FALLBACK_ICONS[target.id]}
          />
        ))}
      </div>
    </>
  );
}
