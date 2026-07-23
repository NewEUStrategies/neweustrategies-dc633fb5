// Icon-only button that navigates to a user's public profile.
// Used across people/network/contributors lists next to Connect / DM actions.
import { Link } from "@tanstack/react-router";
import { UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface ProfileLinkButtonProps {
  slug: string;
  displayName: string;
  compact?: boolean;
  className?: string;
}

export function ProfileLinkButton({
  slug,
  displayName,
  compact,
  className,
}: ProfileLinkButtonProps) {
  const { t } = useTranslation();
  const label = t("network.viewProfile", { defaultValue: "Zobacz profil" });
  const aria = `${label}: ${displayName}`;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            asChild
            type="button"
            variant="outline"
            size="icon"
            className={cn(
              "rounded-[6px] shrink-0 transition-colors hover:bg-brand/10 hover:text-brand hover:border-brand/40",
              compact ? "h-8 w-8" : "h-9 w-9",
              className,
            )}
          >
            <Link
              to="/author/$slug"
              params={{ slug }}
              aria-label={aria}
              onClick={(e) => e.stopPropagation()}
            >
              <UserRound className="h-4 w-4" aria-hidden />
              <span className="sr-only">{aria}</span>
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
