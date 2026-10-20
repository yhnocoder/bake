import 'bake/theme/styles/fonts.css';
import 'bake/theme/styles/tokens.css';
import 'bake/theme/styles/page.css';
import 'bake/theme/styles/blocks.css';
import './styles/notes.css';
import './styles/toc.css';
import 'bake/theme/styles/settings.css';
import 'bake/theme/styles/home.css';
import 'bake/theme/styles/not-found.css';
import 'bake/theme/styles/print.css';
import { resolveWidths, startFolds, startHeadingLinks, startHome, startLayout, startMarkdownCopy, startNotFound, startPreviewCard, startSettings, startToast } from 'bake/theme/client';
import { startButtons } from './scripts/buttons.js';
import { startNotes } from './scripts/notes.js';
import { startToc } from './scripts/toc.js';

const article = document.querySelector('.bk-article');
const home = document.querySelector('.bk-home');
const notFound = document.querySelector('.bk-not-found');
startSettings();
if (home !== null) startHome(home);
if (notFound !== null) startNotFound(notFound);
if (article !== null) {
  startToast();
  startLayout(article, [resolveWidths]);
  startFolds(article);
  startNotes(article);
  startHeadingLinks();
  startMarkdownCopy(article);
  startPreviewCard(article);
  startToc(article);
  startButtons();
}
