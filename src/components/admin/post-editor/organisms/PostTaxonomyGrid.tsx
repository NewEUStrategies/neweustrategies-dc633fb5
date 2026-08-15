// Organizm: siatka taksonomii - kategorie, tagi, projekty, regiony. Wszystkie
// opcje pochodzą z tenant-scoped zapytań (usePostEditorData), więc jeden
// obszar roboczy nie widzi taksonomii innego.
import { useTranslation } from "react-i18next";
import { CategoriesCard, TagsCard, BilingualPickerCard } from "../molecules";
import type { InlineTaxonomyApi, PostEditorData, PostEditorFormApi } from "../hooks";

export function PostTaxonomyGrid({
  formApi,
  data,
  taxonomy,
  grid,
}: {
  formApi: PostEditorFormApi;
  data: PostEditorData;
  taxonomy: InlineTaxonomyApi;
  /** true = układ 2-kolumnowy (zakładka "Kategorie i tagi"). */
  grid?: boolean;
}) {
  const { t } = useTranslation();
  const cards = (
    <>
      <CategoriesCard
        allCats={data.allCats}
        selectedCats={formApi.selectedCats}
        onSelectedCatsChange={formApi.setSelectedCats}
        newCatPl={taxonomy.newCatPl}
        onNewCatPlChange={taxonomy.setNewCatPl}
        newCatEn={taxonomy.newCatEn}
        onNewCatEnChange={taxonomy.setNewCatEn}
        taxonomyBusy={taxonomy.taxonomyBusy}
        onAddCategory={() => void taxonomy.addCategory()}
      />
      <TagsCard
        allTags={data.allTags}
        selectedTags={formApi.selectedTags}
        onSelectedTagsChange={formApi.setSelectedTags}
        newTagName={taxonomy.newTagName}
        onNewTagNameChange={taxonomy.setNewTagName}
        taxonomyBusy={taxonomy.taxonomyBusy}
        onAddTag={() => void taxonomy.addTag()}
      />
      <BilingualPickerCard
        label={t("admin.nav.programs")}
        options={data.allPrograms ?? undefined}
        selectedIds={formApi.selectedPrograms}
        onSelectedChange={formApi.setSelectedPrograms}
        emptyHint={t("admin.posts.noPrograms")}
      />
      <BilingualPickerCard
        label={t("admin.nav.regions")}
        options={data.allRegions ?? undefined}
        selectedIds={formApi.selectedRegions}
        onSelectedChange={formApi.setSelectedRegions}
        emptyHint={t("admin.posts.noRegions")}
      />
    </>
  );
  if (grid) return <div className="grid md:grid-cols-2 gap-4">{cards}</div>;
  return cards;
}
