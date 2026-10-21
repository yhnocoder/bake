import { REGIONS } from 'bake/regions';

export function PreviewTemplates(props) {
  const { previews, labels } = props;
  return (
    <div class="bk-previews" data-region={REGIONS.previews}>
      {previews.map((preview) =>
        preview.kind === 'reference' ? (
          <template class="bk-preview-template" data-target={preview.target} data-kind="reference">
            {preview.number === undefined ? null : <span class="bk-preview-number">{`[${preview.number}]`}</span>}
            <div class="bk-preview-text" innerHTML={preview.html} />
          </template>
        ) : (
          <template class="bk-preview-template" data-target={preview.target} data-kind="link">
            {preview.title === undefined ? (
              <p class="bk-preview-title">{preview.article}</p>
            ) : (
              [<p class="bk-preview-source">{preview.number === undefined ? preview.article : `${preview.article} · ${preview.number}`}</p>, <p class="bk-preview-title" innerHTML={preview.title} />]
            )}
            <div class="bk-preview-body" innerHTML={preview.html} />
            <p class="bk-preview-hint">{labels.openOriginal}</p>
          </template>
        ),
      )}
    </div>
  );
}
