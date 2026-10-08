import { useTranslation } from "react-i18next";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Toast nad DOLNYM PASKIEM członka. Pasek przestrzeni roboczej publikuje
// `--mbb-reserve` (wysokość paska + odstęp, `styles.css`, `html[data-mbb="on"]`)
// i każda powierzchnia przypięta do dołu ma z niego korzystać. Bez tego toast
// (24 px od dołu na desktopie, 16 px na telefonie) zasłaniał zakładki paska
// i kompozytor skrzynki czatu. U gościa zmiennej nie ma, więc zostają
// domyślne odstępy sonnera.
const OFFSET = { bottom: "calc(var(--mbb-reserve, 0px) + 24px)" };
const MOBILE_OFFSET = { bottom: "calc(var(--mbb-reserve, 0px) + 16px)" };

const Toaster = ({ ...props }: ToasterProps) => {
  // Nazwa regionu ogłoszeń w języku interfejsu (sonner dokleja skrót „alt+T").
  // `react-i18next` i słownik rdzenia są już w domknięciu bootu, więc leniwy
  // chunk sonnera nie ciągnie niczego nowego.
  const { t } = useTranslation();
  // PL/EN are LTR. Automatic detection calls getComputedStyle(html) during
  // render, flushing pending page-wide styles even with no notifications.
  return (
    <Sonner
      dir="ltr"
      className="toaster group"
      offset={OFFSET}
      mobileOffset={MOBILE_OFFSET}
      containerAriaLabel={t("notifications.title")}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
