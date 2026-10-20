import '../essay/styles/tokens.css';
import '../essay/styles/page.css';
import '../essay/styles/blocks.css';
import '../essay/styles/settings.css';
import '../essay/styles/home.css';
import '../essay/styles/not-found.css';
import '../essay/styles/print.css';
import './styles/bento.css';
import { startMarkdownCopy } from '../essay/scripts/copy.js';
import { startFolds } from '../essay/scripts/folds.js';
import { startHeadingLinks } from '../essay/scripts/heading-links.jsx';
import { startHome } from '../essay/scripts/home.js';
import { startNotFound } from '../essay/scripts/not-found.js';
import { startPreviewCard } from '../essay/scripts/preview-card.jsx';
import { startSettings } from '../essay/scripts/settings.jsx';
import { startToast } from '../essay/scripts/toast.jsx';
import { startWidths } from '../essay/scripts/widths.js';
import { startNotes } from './scripts/notes.js';
import { startSpans } from './scripts/spans.js';

const article = document.querySelector('.bk-article');
const home = document.querySelector('.bk-home');
const notFound = document.querySelector('.bk-not-found');
startSettings();
if (home !== null) startHome(home);
if (notFound !== null) startNotFound(notFound);
if (article !== null) {
  startToast();
  startWidths(article);
  startSpans(article);
  startFolds(article);
  startNotes(article);
  startHeadingLinks(article);
  startMarkdownCopy(article);
  startPreviewCard(article);
}
