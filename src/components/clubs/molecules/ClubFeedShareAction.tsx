// Molekuła: akcja „Udostępnij" pod kartą strumienia.
//
// Na telefonie (wskaźnik dotykowy + Web Share API) otwiera systemowy arkusz
// udostępniania - tam członek klubu ma swoje komunikatory. Wszędzie indziej
// kopiuje adres do schowka i potwierdza to na dwa sposoby: komunikatem i
// piktogramem, który na chwilę zamienia się w znacznik. Adres jest zawsze
// adresem W SERWISIE, a klub prywatny i tak wpuści tylko członków - link nie
// otwiera niczego, czego jego odbiorca nie mógłby zobaczyć.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Share2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  CLUB_FEED_ACTION_ICON,
  clubFeedActionClass,
} from "@/components/clubs/molecules/ClubFeedCard";

const CONFIRM_MS = 1800;

function prefersNativeShare(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(pointer: coarse)").matches;
}

export function ClubFeedShareAction({ path, title }: { path: string; title: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const share = async (): Promise<void> => {
    const url = new URL(path, window.location.origin).toString();
    if (prefersNativeShare()) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        // Zamknięcie arkusza przez użytkownika to nie błąd.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), CONFIRM_MS);
      toast.success(t("club.hub.feed.linkCopied"));
    } catch {
      toast.error(t("club.hub.feed.linkCopyFailed"));
    }
  };

  const Icon = copied ? Check : Share2;

  return (
    <button
      type="button"
      onClick={() => void share()}
      className={clubFeedActionClass({ className: copied ? "text-primary" : undefined })}
      data-testid="club-feed-share"
    >
      <span
        key={copied ? "done" : "idle"}
        className={cn("inline-flex", copied && "club-reaction-tap")}
      >
        <Icon className={CLUB_FEED_ACTION_ICON} aria-hidden="true" />
      </span>
      <span className="max-w-full truncate">{t("club.hub.feed.share")}</span>
    </button>
  );
}
