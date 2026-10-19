export function Toc(props) {
  const { toc, labels } = props;
  if (toc.length === 0) return null;
  return (
    <nav class="bk-toc" aria-label={labels.toc}>
      <div class="bk-toc-column">
        <p class="bk-toc-label">
          <span class="bk-toc-label-static">{labels.toc}</span>
          <span class="bk-toc-label-notes">{labels.notes}</span>
        </p>
        <div class="bk-toc-list">
          <ol class="bk-toc-chapters">
            {toc.map((chapter) => (
              <li class="bk-toc-chapter" data-target={chapter.id} data-state="ahead">
                <a class="bk-toc-chapter-title" href={`#${encodeURIComponent(chapter.id)}`}>
                  <span class="bk-toc-number">{chapter.number}</span>
                  <span class="bk-toc-text">{chapter.title}</span>
                </a>
                {chapter.recap === undefined && chapter.children.length === 0 ? null : (
                  <div class="bk-toc-fold">
                    <div>
                      {chapter.recap === undefined ? null : <Recap html={chapter.recap} chapter />}
                      {chapter.children.length === 0 ? null : (
                        <ol class="bk-toc-sections">
                          {chapter.children.map((section) => (
                            <li class="bk-toc-section" data-target={section.id} data-state="ahead">
                              <a class="bk-toc-section-title" href={`#${encodeURIComponent(section.id)}`}>
                                {section.title}
                              </a>
                              {section.recap === undefined ? null : <Recap html={section.recap} />}
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </nav>
  );
}

function Recap(props) {
  return (
    <div class={props.chapter ? 'bk-toc-recap bk-toc-chapter-recap' : 'bk-toc-recap'}>
      <div>
        <div class="bk-toc-recap-text" innerHTML={props.html} />
      </div>
    </div>
  );
}
