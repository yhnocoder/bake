import './styles/fonts.css';
import './styles/tokens.css';
import './styles/page.css';
import './styles/blocks.css';
import './styles/notes.css';
import './styles/toc.css';
import './styles/settings.css';
import './styles/home.css';
import './styles/not-found.css';
import './styles/print.css';
import { startFolds } from './scripts/folds.js';
import { startHeadingLinks } from './scripts/heading-links.jsx';
import { startHome } from './scripts/home.js';
import { startNotFound } from './scripts/not-found.js';
import { startNotes } from './scripts/notes.js';
import { startPreviewCard } from './scripts/preview-card.jsx';
import { startSettings } from './scripts/settings.jsx';
import { startToc } from './scripts/toc.js';
import { startWidths } from './scripts/widths.js';

const article = document.querySelector('.bk-article');
const home = document.querySelector('.bk-home');
const notFound = document.querySelector('.bk-not-found');
startSettings();
if (home !== null) startHome(home);
if (notFound !== null) startNotFound(notFound);
if (article !== null) {
  startWidths(article);
  startFolds(article);
  startNotes(article);
  startHeadingLinks(article);
  startPreviewCard(article);
  startToc(article);
}
