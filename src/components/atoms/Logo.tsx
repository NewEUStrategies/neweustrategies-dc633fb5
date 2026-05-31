import { Link } from "@tanstack/react-router";
import logoSrc from "@/assets/logo.png";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  withWordmark?: boolean;
}

const SIZE: Record<NonNullable<LogoProps["size"]>, string> = {
  sm: "w-8 h-8",
  md: "w-12 h-12 md:w-14 md:h-14",
  lg: "w-16 h-16",
};

export function Logo({ size = "md", withWordmark = true }: LogoProps) {
  return (
    <Link to="/" className="flex items-center gap-3" aria-label="New European Strategies - strona główna">
      <img src={logoSrc} alt="" className={SIZE[size]} width={56} height={56} />
      {withWordmark && (
        <span className="leading-[1.05] font-display font-bold text-xl md:text-2xl">
          <span className="block">New</span>
          <span className="block text-brand">European</span>
          <span className="block">Strategies</span>
        </span>
      )}
    </Link>
  );
}
