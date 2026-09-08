import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import "@/lib/i18n-reading-list";

export function ReadingListErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="text-center py-10">
      <p className="mb-3 text-destructive">{message}</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        {t("readingList.retry")}
      </Button>
    </div>
  );
}
