// Klucze React Query dla grafu powiązań (cross_references / get_linked_items).
export const linkedItemsKeys = {
  all: ["linked-items"] as const,
  item: (itemType: string, itemId: string) => ["linked-items", itemType, itemId] as const,
};
