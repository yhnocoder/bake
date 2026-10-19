export function Toc(props) {
  const { toc, labels } = props;
  if (toc.length === 0) return null;
  return (
    <nav class="bk-toc" aria-label={labels.toc}>
      <p class="bk-toc-label">{labels.notes}</p>
      <ol class="bk-toc-list">
        {toc.map((chapter) => (
          <li class="bk-toc-chapter">
            <a class="bk-toc-link" href={`#${encodeURIComponent(chapter.id)}`} data-target={chapter.id}>
              <span class="bk-toc-number">{chapter.number}</span>
              {chapter.title}
            </a>
            {chapter.recap === undefined ? null : <div class="bk-toc-recap" innerHTML={chapter.recap} />}
            {chapter.children.length === 0 ? null : (
              <ol class="bk-toc-sections">
                {chapter.children.map((section) => (
                  <li class="bk-toc-section">
                    <a class="bk-toc-link" href={`#${encodeURIComponent(section.id)}`} data-target={section.id}>
                      {section.title}
                    </a>
                    {section.recap === undefined ? null : <div class="bk-toc-recap" innerHTML={section.recap} />}
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
