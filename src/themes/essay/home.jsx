import { labelsFor } from './labels.js';
import { HOME_COLUMNS, homePrepaintScript, prepaintScript } from './settings.js';

export default function Home(props) {
  const { site, home, articles, assets } = props;
  const labels = labelsFor(site.language);
  const byCategory = categoryGroups(home.categories, articles);
  const byMonth = monthGroups(articles);
  const groups = byCategory.length > 0 ? ['category', 'month'] : ['month'];
  const groupBy = groups.includes(home.groupBy) ? home.groupBy : 'month';
  const tags = [...new Set(articles.flatMap((article) => article.tags))];
  return (
    <html lang={site.language} data-group={groupBy} data-columns={String(home.columns)}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{site.title}</title>
        {site.description === undefined ? null : <meta name="description" content={site.description} />}
        <script innerHTML={prepaintScript + homePrepaintScript(groups)} />
        {assets.styles.map((href) => (
          <link rel="stylesheet" href={href} />
        ))}
        {assets.scripts.map((src) => (
          <script defer src={src} />
        ))}
      </head>
      <body class="bk-page">
        <div class="bk-home">
          <header class="bk-home-header">
            <h1 class="bk-home-title">{site.title}</h1>
            {site.description === undefined ? null : <p class="bk-home-description">{site.description}</p>}
          </header>
          <div class="bk-home-bar">
            {byCategory.length === 0 ? null : (
              <nav class="bk-chips" data-for="category" aria-label={labels.categories}>
                {byCategory.map((group) => (
                  <a class="bk-chip" href={`#${group.id}`} data-target={group.id} style={`--c:${group.category.color}`}>
                    <span class="bk-chip-dot" />
                    {group.category.name}
                    <span class="bk-chip-count">{group.articles.length}</span>
                  </a>
                ))}
              </nav>
            )}
            {tags.length === 0 ? null : (
              <div class="bk-chips" data-for="month" role="group" aria-label={labels.tags}>
                <button type="button" class="bk-chip" data-tag="" aria-pressed="true">
                  {labels.allTags}
                </button>
                {tags.map((tag) => (
                  <button type="button" class="bk-chip" data-tag={tag} aria-pressed="false">
                    {tag}
                  </button>
                ))}
              </div>
            )}
            <div class="bk-home-controls">
              {groups.length === 1 ? null : (
                <Switch name="group" label={labels.group} values={groups} current={groupBy} text={(value) => labels.groups[value]} />
              )}
              <Switch name="columns" label={labels.columns} values={HOME_COLUMNS} current={String(home.columns)} text={(value) => value} />
            </div>
          </div>
          <main class="bk-home-main">
            {byCategory.length === 0 ? null : (
              <div class="bk-grouping" data-grouping="category">
                {byCategory.map((group) => (
                  <Group group={group} title={group.category.name} desc={group.category.desc} color={group.category.color} labels={labels} />
                ))}
              </div>
            )}
            <div class="bk-grouping" data-grouping="month">
              {byMonth.map((group) => (
                <Group group={group} title={group.month} labels={labels} />
              ))}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}

function categoryGroups(categories, articles) {
  return categories
    .map((category) => ({ id: `category-${category.id}`, category, articles: articles.filter((article) => article.category?.id === category.id) }))
    .filter((group) => group.articles.length > 0);
}

function monthGroups(articles) {
  const months = new Map();
  for (const article of articles) {
    const month = article.date.slice(0, 7);
    if (!months.has(month)) months.set(month, []);
    months.get(month).push(article);
  }
  return [...months].sort(([a], [b]) => (a < b ? 1 : -1)).map(([month, entries]) => ({ id: `month-${month}`, month, articles: entries }));
}

function Switch(props) {
  const { name, label, values, current, text } = props;
  return (
    <div class="bk-switch" data-control={name} role="group" aria-label={label}>
      <span class="bk-switch-label">{label}</span>
      <div class="bk-switch-options">
        {values.map((value) => (
          <button type="button" data-value={value} aria-pressed={String(value === current)}>
            {text(value)}
          </button>
        ))}
      </div>
    </div>
  );
}

function Group(props) {
  const { group, title, desc, color, labels } = props;
  return (
    <section class="bk-group" id={group.id} style={`--c:${color ?? 'var(--line-2)'}`}>
      <div class="bk-group-head">
        <h2 class="bk-group-title">{title}</h2>
        {desc === undefined || desc === '' ? null : <p class="bk-group-desc">{desc}</p>}
        <span class="bk-group-count">{labels.posts(group.articles.length)}</span>
      </div>
      <div class="bk-grid">
        {group.articles.map((article) => (
          <Card article={article} labels={labels} />
        ))}
      </div>
    </section>
  );
}

function Card(props) {
  const { article, labels } = props;
  return (
    <a
      class="bk-card"
      href={encodeURI(article.url)}
      style={`--c:${article.category?.color ?? 'var(--accent)'}`}
      data-tags={JSON.stringify(article.tags)}
      data-preview={article.preview === undefined ? undefined : encodeURI(article.preview)}
    >
      <div class="bk-card-frame">
        <div class="bk-card-fallback">
          {article.image === undefined ? (
            <span class="bk-card-cover" aria-hidden="true">
              {article.title}
            </span>
          ) : (
            <img src={encodeURI(article.image)} alt="" loading="lazy" decoding="async" />
          )}
        </div>
        {article.draft ? <span class="bk-card-draft">{labels.draft}</span> : null}
      </div>
      <div class="bk-card-body">
        <h3 class="bk-card-title">{article.title}</h3>
        {article.summary === undefined ? null : <p class="bk-card-summary">{article.summary}</p>}
        <p class="bk-card-meta">
          <time datetime={article.date}>{article.date}</time>
          {article.tags.map((tag) => (
            <span class="bk-card-tag">{tag}</span>
          ))}
        </p>
      </div>
    </a>
  );
}
