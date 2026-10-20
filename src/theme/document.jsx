import { FontLinks } from './font-links.jsx';
import { PageMeta } from './meta.jsx';
import { PreviewTemplates } from './previews.jsx';
import { lightWenkaiSteps, prepaintScript, settingAttributes } from './settings.js';

export function ArticleDocument(props) {
  const { site, article, assets, labels } = props;
  return (
    <html lang={site.language} {...settingAttributes(props.settings, article)} {...props.attributes}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${article.title} · ${site.title}`}</title>
        {article.summary === undefined ? null : <meta name="description" content={article.summary} />}
        <PageMeta site={site} type="article" title={article.title} description={article.summary} link={article.link} image={article.shareImage} root={assets.root} />
        <script innerHTML={prepaintScript(lightWenkaiSteps(assets.lazyStyles['wenkai-light']))} />
        {assets.styles.map((href) => (
          <link rel="stylesheet" href={href} />
        ))}
        <FontLinks hrefs={assets.fonts} />
        {assets.mathStyles === undefined ? null : <style innerHTML={assets.mathStyles} />}
        {assets.scripts.map((src) => (
          <script type="module" src={src} />
        ))}
      </head>
      <body class={props.bodyClass} style={labelStyle(labels)}>
        {article.content.glyphs === undefined ? null : <div class="bk-glyphs" data-region="glyphs" innerHTML={article.content.glyphs} />}
        {props.children}
        <PreviewTemplates previews={article.content.previews} labels={labels} />
        <script type="application/json" class="bk-source" data-region="source" innerHTML={sourceJson(article.content.source)} />
      </body>
    </html>
  );
}

function sourceJson(source) {
  return JSON.stringify(source).replaceAll('<', '\\u003c');
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
