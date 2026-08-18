// Atom: potwierdzenie akcji nieodwracalnej w czacie (cofnięcie wysłania,
// wyczyszczenie historii, blokada osoby).
//
// Trzy takie dialogi stały w `ChatWindow` jako trzy kopie tego samego
// dwudziestowierszowego `AlertDialog` - identyczne co do znaku poza tytułem,
// opisem i etykietą akcji. Kopiowanie dialogu potwierdzenia jest szczególnie
// kosztowne: to ostatnia bariera przed operacją, której nie da się cofnąć,
// więc każda kopia to osobne miejsce, w którym można zgubić `onOpenChange`
// (dialog nie zamknie się na Escape) albo `AlertDialogCancel` (nie ma jak
// wyjść bez potwierdzenia).
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface ChatConfirmDialogProps {
  open: boolean;
  /** Wołane z `false`, gdy użytkownik zamyka dialog (Escape, klik w tło, anuluj). */
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** Etykieta przycisku potwierdzającego - zawsze czasownik akcji, nie „OK". */
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
}

export function ChatConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
}: ChatConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
