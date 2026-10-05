// Podwójny kąt „fast forward" - wypełniona ikona rysowana currentColor, więc
// dziedziczy kolor tekstu obok w motywie jasnym i ciemnym bez dodatkowych klas.
interface FastForwardIconProps {
  className?: string;
}

export function FastForwardIcon({ className }: FastForwardIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M2.5 3.2 12.4 12 2.5 20.8V16l5.6-4-5.6-4V3.2Z" />
      <path d="M11.6 3.2 21.5 12l-9.9 8.8V16l5.6-4-5.6-4V3.2Z" />
    </svg>
  );
}
