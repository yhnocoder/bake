export function Toc(props) {
  const { toc, labels } = props;
  if (toc.length === 0) return null;
  return (
    <nav class="bk-toc" aria-label={labels.toc}>
      <div class="bk-toc-sticky">
        <p class="bk-toc-label">{labels.notes}</p>
        <div class="bk-toc-scroll">
          <ol class="bk-toc-list">
            {toc.map((chapter) => (
              <li class="bk-toc-chapter" data-state="ahead">
                <TocEntry entry={chapter} number={chapter.number} />
                {chapter.children.length === 0 ? null : (
                  <div class="bk-toc-sections">
                    <ol class="bk-toc-sections-list">
                      {chapter.children.map((section) => (
                        <li class="bk-toc-section">
                          <TocEntry entry={section} />
                        </li>
                      ))}
                    </ol>
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

function TocEntry(props) {
  const { entry, number } = props;
  return (
    <div class="bk-toc-entry" data-target={entry.id} data-state="ahead">
      <a class="bk-toc-link" href={`#${encodeURIComponent(entry.id)}`}>
        {number === undefined ? null : <span class="bk-toc-number">{number}</span>}
        {entry.title}
      </a>
      <span class="bk-toc-progress" />
      {entry.recap === undefined ? null : (
        <div class="bk-toc-recap">
          <div class="bk-toc-recap-text" innerHTML={entry.recap} />
        </div>
      )}
    </div>
  );
}
