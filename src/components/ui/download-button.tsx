import { forwardRef, useCallback, useEffect, useId, useRef, useState } from "react";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import "@/lib/i18n-download-button";

export type DownloadButtonProps = {
  /** File URL to download. When provided the anchor download attribute is used. */
  href?: string;
  /** Suggested filename passed to the anchor's `download` attribute. */
  fileName?: string;
  /** Optional custom handler. Return a Promise to keep the "in progress" state until it resolves. */
  onDownload?: () => void | Promise<void>;
  /** Label overrides (bypass i18n when set). */
  labels?: Partial<{ idle: string; done: string; ariaLabel: string }>;
  className?: string;
  disabled?: boolean;
};

/**
 * Atomic animated download button.
 * - Uses design tokens (primary / brand / card) for full dark/light parity.
 * - i18n via `translation.downloadButton.*` (PL/EN).
 * - Respects `prefers-reduced-motion`.
 * - Auto-resets ~4s after activation to allow re-use.
 */
export const DownloadButton = forwardRef<HTMLLabelElement, DownloadButtonProps>(
  function DownloadButton(
    { href, fileName, onDownload, labels, className, disabled = false },
    ref,
  ) {
    const { t } = useTranslation();
    const inputId = useId();
    const [active, setActive] = useState(false);
    const anchorRef = useRef<HTMLAnchorElement | null>(null);
    const resetTimer = useRef<number | null>(null);

    const idle = labels?.idle ?? t("downloadButton.idle");
    const done = labels?.done ?? t("downloadButton.done");
    const aria = labels?.ariaLabel ?? t("downloadButton.ariaLabel");

    const trigger = useCallback(() => {
      if (disabled || active) return;
      setActive(true);
      try {
        void onDownload?.();
      } catch {
        // Swallow - UX state continues regardless.
      }
      if (href) {
        const a = anchorRef.current;
        if (a) {
          a.click();
        }
      }
      resetTimer.current = window.setTimeout(() => {
        setActive(false);
      }, 4200);
    }, [active, disabled, href, onDownload]);

    useEffect(
      () => () => {
        if (resetTimer.current) window.clearTimeout(resetTimer.current);
      },
      [],
    );

    return (
      <span className={cn("dlb-root", className)}>
        <label
          ref={ref}
          htmlFor={inputId}
          className="dlb-label"
          aria-label={aria}
          data-state={active ? "active" : "idle"}
        >
          <input
            id={inputId}
            type="checkbox"
            className="dlb-input"
            checked={active}
            disabled={disabled}
            onChange={trigger}
            aria-hidden="true"
            tabIndex={-1}
          />
          <span className="dlb-circle" aria-hidden="true">
            <Download className="dlb-icon" strokeWidth={2.2} />
            <span className="dlb-square" />
          </span>
          <span className="dlb-title dlb-title-idle">{idle}</span>
          <span className="dlb-title dlb-title-done">{done}</span>
        </label>
        {href ? (
          <a
            ref={anchorRef}
            href={href}
            download={fileName ?? true}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
          >
            {idle}
          </a>
        ) : null}
      </span>
    );
  },
);
