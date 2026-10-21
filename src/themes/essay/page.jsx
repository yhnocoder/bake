import { ArticleDocument, Header, labelsFor } from 'bake/theme';
import { Article } from './article.jsx';
import { essayLabels } from './labels.js';
import { settings } from './options.js';
import { Toc } from './toc.jsx';

export default function Page(props) {
  const { site, article, assets, options } = props;
  const labels = labelsFor(site.language);
  return (
    <ArticleDocument site={site} article={article} assets={assets} labels={labels} settings={settings} options={options} bodyClass="bk-page">
      <div class="bk-shell">
        <Header site={site} article={article} home={assets.root} labels={labels} />
        <main class="bk-main">
          <Toc toc={article.content.toc} labels={essayLabels(site.language)} />
          <Article content={article.content} labels={labels} />
        </main>
      </div>
    </ArticleDocument>
  );
}
