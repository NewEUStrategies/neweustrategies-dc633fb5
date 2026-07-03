// Atom: square icon-only button used in toolbars and item controls.
export function IconBtn({
  onClick,
  children,
  disabled,
  title,
  danger,
}: {
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
  disabled?: boolean;
  title?: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-0.5 rounded ${danger ? "hover:text-destructive" : "hover:text-brand"} disabled:opacity-30`}
    >
      {children}
    </button>
  );
}
