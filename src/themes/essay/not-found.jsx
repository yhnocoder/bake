import { labelsFor } from './labels.js';
import { prepaintScript, settingAttributes } from './settings.js';

export default function NotFound(props) {
  const { site, articles, assets } = props;
  const labels = labelsFor(site.language);
  return (
    <html lang={site.language} {...settingAttributes('not-found')}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>{`${labels.notFound} · ${site.title}`}</title>
        <script innerHTML={prepaintScript} />
        {assets.styles.map((href) => (
          <link rel="stylesheet" href={href} />
        ))}
        {assets.scripts.map((src) => (
          <script type="module" src={src} />
        ))}
      </head>
      <body class="bk-page">
        <main class="bk-not-found" data-root={assets.root}>
          <a class="bk-site" href={assets.root}>
            {site.title}
          </a>
          <h1 class="bk-not-found-title">{labels.notFound}</h1>
          <p class="bk-not-found-path" hidden>
            <code />
          </p>
          <section class="bk-not-found-matches" hidden>
            <h2>{labels.didYouMean}</h2>
            <ul>
              {articles.map((article) => (
                <li data-url={article.url} hidden>
                  <a href={`${assets.root}${article.url}`}>{article.title}</a>
                  <code>{`/${article.url}`}</code>
                </li>
              ))}
            </ul>
          </section>
          <a class="bk-not-found-home" href={assets.root}>
            {labels.backHome}
          </a>
        </main>
      </body>
    </html>
  );
}
