import { Article } from './article.jsx';
import { Header } from './header.jsx';
import { labelsFor } from './labels.js';
import { PreviewTemplates } from './previews.jsx';
import { prepaintScript } from './settings.js';
import { Toc } from './toc.jsx';

export default function Page(props) {
  const { site, article, assets } = props;
  const labels = labelsFor(site.language);
  return (
    <html lang={site.language} data-toc={article.toc}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${article.title} · ${site.title}`}</title>
        {article.summary === undefined ? null : <meta name="description" content={article.summary} />}
        <script innerHTML={prepaintScript} />
        {assets.styles.map((href) => (
          <link rel="stylesheet" href={href} />
        ))}
        {assets.mathStyles === undefined ? null : <style innerHTML={assets.mathStyles} />}
        {assets.scripts.map((src) => (
          <script defer src={src} />
        ))}
        {assets.modules.map((src) => (
          <script type="module" src={src} />
        ))}
      </head>
      <body class="bk-page" style={labelStyle(labels)}>
        {article.content.glyphs === undefined ? null : <div class="bk-glyphs" data-region="glyphs" innerHTML={article.content.glyphs} />}
        <div class="bk-shell">
          <Header site={site} article={article} home={assets.root} labels={labels} />
          <Toc toc={article.content.toc} labels={labels} />
          <Article content={article.content} labels={labels} />
        </div>
        <PreviewTemplates previews={article.content.previews} labels={labels} />
      </body>
    </html>
  );
}

function labelStyle(labels) {
  const { before, after } = labels.embedSource;
  const variables = {
    'embed-source-before': before,
    'embed-source-after': after,
    'component-needs-script': labels.componentNeedsScript,
    'component-failed': labels.componentFailed,
  };
  return Object.entries(variables)
    .map(([name, value]) => `--bk-${name}:${JSON.stringify(value)}`)
    .join(';');
}
