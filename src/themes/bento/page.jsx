import { Header } from '../essay/header.jsx';
import { labelsFor } from '../essay/labels.js';
import { labelStyle } from '../essay/page.jsx';
import { PreviewTemplates } from '../essay/previews.jsx';
import { prepaintScript } from '../essay/settings.js';
import { Article } from './article.jsx';

export default function Page(props) {
  const { site, article, assets } = props;
  const labels = labelsFor(site.language);
  return (
    <html lang={site.language}>
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
      <body class="bk-page bt-page" style={labelStyle(labels)}>
        {article.content.glyphs === undefined ? null : <div class="bk-glyphs" data-region="glyphs" innerHTML={article.content.glyphs} />}
        <div class="bt-shell">
          <Header site={site} article={article} home={assets.root} labels={labels} />
          <Article content={article.content} columns={site.bento.columns} labels={labels} />
        </div>
        <PreviewTemplates previews={article.content.previews} labels={labels} />
      </body>
    </html>
  );
}
