import { useRouter } from "@tanstack/react-router";
import {
  forwardRef,
  type AnchorHTMLAttributes,
  type FocusEvent,
  type MouseEvent,
  type TouchEvent,
} from "react";

type AppLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href?: string;
  preload?: "intent" | "none";
};

function isModifiedEvent(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.metaKey || event.altKey || event.ctrlKey || event.shiftKey;
}

export function toClientHref(href: string | undefined): string | null {
  if (!href || href === "#" || href.startsWith("#")) return null;
  if (/^(mailto:|tel:)/i.test(href)) return null;
  if (href.startsWith("//")) return null;
  if (href.startsWith("/")) return href;

  if (/^https?:\/\//i.test(href) && typeof window !== "undefined") {
    try {
      const url = new URL(href);
      if (url.origin === window.location.origin) {
        return `${url.pathname}${url.search}${url.hash}`;
      }
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Anchor that keeps same-origin builder/auth/menu links inside TanStack Router.
 * This prevents browser document reloads, so global chrome (header/footer/menu
 * sections) stays mounted and only the route body changes.
 */
export const AppLink = forwardRef<HTMLAnchorElement, AppLinkProps>(function AppLink(
  {
    href = "#",
    target,
    onClick,
    onMouseEnter,
    onFocus,
    onTouchStart,
    preload = "intent",
    ...props
  },
  ref,
) {
  const router = useRouter({ warn: false });
  const clientHref = toClientHref(href);

  const preloadRoute = () => {
    if (!router || !clientHref || preload === "none") return;
    void router.preloadRoute({ href: clientHref } as never).catch(() => undefined);
  };

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || !router || !clientHref) return;
    const elementTarget = event.currentTarget.getAttribute("target");
    const effectiveTarget = target ?? elementTarget;
    if (
      event.button !== 0 ||
      isModifiedEvent(event) ||
      (effectiveTarget && effectiveTarget !== "_self")
    )
      return;

    event.preventDefault();
    void router.navigate({ href: clientHref } as never);
  };

  const handleMouseEnter = (event: MouseEvent<HTMLAnchorElement>) => {
    onMouseEnter?.(event);
    preloadRoute();
  };

  const handleFocus = (event: FocusEvent<HTMLAnchorElement>) => {
    onFocus?.(event);
    preloadRoute();
  };

  const handleTouchStart = (event: TouchEvent<HTMLAnchorElement>) => {
    onTouchStart?.(event);
    preloadRoute();
  };

  return (
    <a
      {...props}
      ref={ref}
      href={href}
      target={target}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onFocus={handleFocus}
      onTouchStart={handleTouchStart}
    />
  );
});

AppLink.displayName = "AppLink";
