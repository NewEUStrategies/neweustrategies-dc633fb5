import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * SubscribeButton - reusable premium bubbly subscribe button.
 *
 * Wykorzystuje semantyczne tokeny (--brand / --brand-foreground), więc
 * automatycznie dopasowuje się do dark / light mode oraz layoutu marki.
 * Etykieta i aria-label są przekazywane z zewnątrz (i18n odpowiedzialność
 * właściciela formularza).
 */
export type SubscribeButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  loadingLabel?: string;
};

export const SubscribeButton = React.forwardRef<HTMLButtonElement, SubscribeButtonProps>(
  ({ className, children, loading, loadingLabel, disabled, type = "submit", ...rest }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn("btn-bubbly", className)}
        {...rest}
      >
        <span className="btn-bubbly__label">{loading ? (loadingLabel ?? "…") : children}</span>
      </button>
    );
  },
);
SubscribeButton.displayName = "SubscribeButton";

export default SubscribeButton;
