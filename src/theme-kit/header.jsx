import { REGIONS } from 'bake/regions';

export function Header(props) {
  const { site, article, home, labels } = props;
  return (
    <header class="bk-header">
      <a class="bk-site" href={home}>
        {site.title}
      </a>
      <h1 class="bk-title">{article.title}</h1>
      {article.summary === undefined ? null : <p class="bk-summary">{article.summary}</p>}
      <div class="bk-meta">
        <div class="bk-meta-items">
          <time datetime={article.date}>{article.date}</time>
          {article.updated === undefined ? null : (
            <span class="bk-updated">
              {labels.updated} <time datetime={article.updated}>{article.updated}</time>
            </span>
          )}
          <span class="bk-words" data-region={REGIONS.words}>{labels.words(article.words)}</span>
          {article.draft ? <span class="bk-draft">{labels.draft}</span> : null}
          {article.tags.length === 0 ? null : (
            <span class="bk-tags">
              {article.tags.map((tag) => (
                <code class="bk-tag">{tag}</code>
              ))}
            </span>
          )}
          <span class="bk-copy">
            <button type="button" class="bk-copy-source">
              {labels.copyMarkdown}
            </button>
          </span>
        </div>
      </div>
    </header>
  );
}
