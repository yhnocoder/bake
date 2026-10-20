import { Header } from '../essay/header.jsx';
import { labelsFor } from '../essay/labels.js';
import { PageMeta } from '../essay/meta.jsx';
import { labelStyle, sourceJson } from '../essay/page.jsx';
import { PreviewTemplates } from '../essay/previews.jsx';
import { prepaintScript, settingAttributes } from '../essay/settings.js';
import { Article } from './article.jsx';

const SETTINGS = ['data-theme', 'data-font'];

export default function Page(props) {
  const { site, article, assets } = props;
  const labels = labelsFor(site.language);
  return (
    <html lang={site.language} {...pageSettings(article)}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${article.title} · ${site.title}`}</title>
        {article.summary === undefined ? null : <meta name="description" content={article.summary} />}
        <PageMeta site={site} type="article" title={article.title} description={article.summary} link={article.link} image={article.shareImage} root={assets.root} />
        <script innerHTML={prepaintScript} />
        {assets.styles.map((href) => (
          <link rel="stylesheet" href={href} />
        ))}
        {assets.mathStyles === undefined ? null : <style innerHTML={assets.mathStyles} />}
        {assets.scripts.map((src) => (
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
        <script type="application/json" class="bk-source" data-region="source" innerHTML={sourceJson(article.content.source)} />
      </body>
    </html>
  );
}

function pageSettings(article) {
  return Object.fromEntries(Object.entries(settingAttributes('article', article)).filter(([name]) => SETTINGS.includes(name)));
}
