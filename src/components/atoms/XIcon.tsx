import type { SVGProps } from "react";

/**
 * Logo X (dawniej Twitter). Lucide nie zawiera ikony X, więc renderujemy własny
 * kształt, kompatybilny z tokenem `currentColor` - dzięki temu ikona dziedziczy
 * kolor z otoczenia i można ją podmieniać w miejscach, w których wcześniej
 * używano `<Twitter />` z lucide-react.
 */
export function XIcon({
  className,
  size = 24,
  ...rest
}: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden
      className={className}
      {...rest}
    >
      <path d="M18.244 2H21.5l-7.51 8.583L23 22h-6.938l-5.44-6.62L4.28 22H1.02l8.036-9.187L1 2h7.084l4.926 6.02L18.244 2Zm-2.43 18h1.858L7.29 4H5.316l10.498 16Z" />
    </svg>
  );
}

export default XIcon;
