import 'bake/theme/styles/tokens.css';
import 'bake/theme/styles/page.css';
import 'bake/theme/styles/blocks.css';
import 'bake/theme/styles/settings.css';
import 'bake/theme/styles/home.css';
import 'bake/theme/styles/not-found.css';
import 'bake/theme/styles/print.css';
import './styles/bento.css';
import { resolveWidths, startFolds, startHeadingLinks, startHome, startLayout, startMarkdownCopy, startNotFound, startPreviewCard, startSettings, startToast } from 'bake/theme/client';
import { startNotes } from './scripts/notes.js';
import { placeCards } from './scripts/spans.js';

const article = document.querySelector('.bk-article');
const home = document.querySelector('.bk-home');
const notFound = document.querySelector('.bk-not-found');
startSettings();
if (home !== null) startHome(home);
if (notFound !== null) startNotFound(notFound);
if (article !== null) {
  startToast();
  startLayout(article, [resolveWidths, placeCards]);
  startFolds(article);
  startNotes(article);
  startHeadingLinks(article);
  startMarkdownCopy(article);
  startPreviewCard(article);
}
