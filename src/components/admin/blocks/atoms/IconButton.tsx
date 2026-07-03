// Atomic icon button used across the block editor (toolbar, drag handles, etc.).
// Typed strictly, no `any`, semantic tokens only.

import { forwardRef, type ButtonHTMLAttributes } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  danger?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  { active = false, danger = false, className = "", ...rest },
  ref,
) {
  const base = "p-1 rounded border border-transparent transition-colors text-xs";
  const tone = danger
    ? "hover:bg-destructive hover:text-destructive-foreground"
    : active
      ? "bg-accent text-accent-foreground border-border"
      : "hover:bg-accent";
  return <button ref={ref} type="button" className={`${base} ${tone} ${className}`} {...rest} />;
});
