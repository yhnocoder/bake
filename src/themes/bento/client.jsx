import '../essay/styles/fonts.css';
import '../essay/styles/tokens.css';
import '../essay/styles/page.css';
import '../essay/styles/blocks.css';
import '../essay/styles/settings.css';
import '../essay/styles/home.css';
import '../essay/styles/print.css';
import './styles/bento.css';
import { startFolds } from '../essay/scripts/folds.js';
import { startHeadingLinks } from '../essay/scripts/heading-links.jsx';
import { startHome } from '../essay/scripts/home.js';
import { startPreviewCard } from '../essay/scripts/preview-card.jsx';
import { startSettings } from '../essay/scripts/settings.jsx';
import { startWidths } from '../essay/scripts/widths.js';
import { startNotes } from './scripts/notes.js';
import { startSpans } from './scripts/spans.js';

const article = document.querySelector('.bk-article');
const home = document.querySelector('.bk-home');
startSettings();
if (home !== null) startHome(home);
if (article !== null) {
  startWidths(article);
  startSpans(article);
  startFolds(article);
  startNotes(article);
  startHeadingLinks(article);
  startPreviewCard(article);
}
