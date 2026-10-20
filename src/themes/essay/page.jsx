import { ArticleDocument, Header, labelsFor } from 'bake/theme';
import { Article } from './article.jsx';
import { Toc } from './toc.jsx';

const SETTINGS = ['toc', 'theme', 'font', 'buttons'];

export default function Page(props) {
  const { site, article, assets } = props;
  const labels = labelsFor(site.language);
  return (
    <ArticleDocument site={site} article={article} assets={assets} labels={labels} settings={SETTINGS} attributes={{ 'data-default-toc': article.toc }} bodyClass="bk-page">
      <div class="bk-shell">
        <Header site={site} article={article} home={assets.root} labels={labels} />
        <main class="bk-main">
          <Toc toc={article.content.toc} labels={labels} />
          <Article content={article.content} labels={labels} />
        </main>
      </div>
    </ArticleDocument>
  );
}
