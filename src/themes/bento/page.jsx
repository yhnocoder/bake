import { ArticleDocument, Header, SITE_SETTINGS, labelsFor } from 'bake/theme';
import { Article } from './article.jsx';

export default function Page(props) {
  const { site, article, assets, options } = props;
  const labels = labelsFor(site.language);
  return (
    <ArticleDocument site={site} article={article} assets={assets} labels={labels} settings={SITE_SETTINGS} bodyClass="bk-page bt-page">
      <div class="bt-shell">
        <Header site={site} article={article} home={assets.root} labels={labels} />
        <Article content={article.content} options={options} labels={labels} />
      </div>
    </ArticleDocument>
  );
}
