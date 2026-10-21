import 'bake/theme/styles/tokens.css';
import 'bake/theme/styles/page.css';
import './styles/layout.css';
import 'bake/theme/styles/blocks.css';
import 'bake/theme/styles/sidenotes.css';
import './styles/notes.css';
import './styles/toc.css';
import 'bake/theme/styles/settings.css';
import 'bake/theme/styles/home.css';
import 'bake/theme/styles/not-found.css';
import 'bake/theme/styles/print.css';
import { livePage } from 'bake/live';
import { resolveWidths, startArticle, startHome, startLayout, startNotFound, startSettings } from 'bake/theme/client';
import { essayLabels } from './essay-labels.js';
import { settings } from './options.js';
import { startButtons } from './scripts/buttons.js';
import { SETTING_DRAWINGS } from './scripts/drawings.js';
import { startNotes, tintParagraph } from './scripts/notes.js';
import { startToc } from './scripts/toc.js';

const home = document.querySelector('.bk-home');
const notFound = document.querySelector('.bk-not-found');
startSettings(settings, { labels: essayLabels(document.documentElement.lang).settings, drawings: SETTING_DRAWINGS });
if (home !== null) startHome(home);
if (notFound !== null) startNotFound(notFound);
livePage(start);

function start(document) {
  const article = document.querySelector('.bk-article');
  if (article === null) return () => {};
  const stops = [startLayout(article, [resolveWidths]), startArticle(article, { onSidenote: (number, on) => tintParagraph(article, number, on) }), startNotes(article), startToc(article), startButtons()];
  return () => stops.forEach((stop) => stop());
}
