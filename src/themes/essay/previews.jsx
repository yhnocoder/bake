export function PreviewTemplates(props) {
  const { previews, labels } = props;
  return previews.map((preview) => (
    <template class="bk-preview-template" data-target={preview.target}>
      {preview.title === undefined ? (
        <p class="bk-preview-title">{preview.article}</p>
      ) : (
        [<p class="bk-preview-source">{preview.number === undefined ? preview.article : `${preview.article} · ${preview.number}`}</p>, <p class="bk-preview-title" innerHTML={preview.title} />]
      )}
      <div class="bk-preview-body" innerHTML={preview.html} />
      <p class="bk-preview-hint">{labels.openOriginal}</p>
    </template>
  ));
}
