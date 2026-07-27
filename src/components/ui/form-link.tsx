// Unified in-form hyperlink used by newsletters and contact forms.
// Matches the JoinUsForm reference styling: underline + brand hover in both
// light and dark modes. Also exposes a global `.form-link` utility class for
// consent HTML rendered via `dangerouslySetInnerHTML` (see styles.css).
import * as React from "react";
import { cn } from "@/lib/utils";

export type FormLinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement>;

export const FormLink = React.forwardRef<HTMLAnchorElement, FormLinkProps>(
  ({ className, target, rel, href, ...rest }, ref) => {
    const external = typeof href === "string" && /^https?:\/\//i.test(href);
    return (
      <a
        ref={ref}
        href={href}
        target={target ?? (external ? "_blank" : undefined)}
        rel={rel ?? (external ? "noopener noreferrer" : undefined)}
        className={cn("form-link", className)}
        {...rest}
      />
    );
  },
);
FormLink.displayName = "FormLink";

export default FormLink;
