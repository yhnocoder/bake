import './styles/fonts.css';
import './styles/tokens.css';
import './styles/page.css';
import './styles/blocks.css';
import './styles/notes.css';
import './styles/toc.css';
import './styles/settings.css';
import './styles/home.css';
import './styles/print.css';
import { startCitations } from './scripts/citations.jsx';
import { startFolds } from './scripts/folds.js';
import { startHeadingLinks } from './scripts/heading-links.jsx';
import { startHome } from './scripts/home.js';
import { startNotes } from './scripts/notes.js';
import { startSettings } from './scripts/settings.jsx';
import { startToc } from './scripts/toc.js';
import { startWidths } from './scripts/widths.js';

const article = document.querySelector('.bk-article');
const home = document.querySelector('.bk-home');
startSettings();
if (home !== null) startHome(home);
if (article !== null) {
  startWidths(article);
  startFolds(article);
  startNotes(article);
  startHeadingLinks(article);
  startCitations(article);
  startToc(article);
}
