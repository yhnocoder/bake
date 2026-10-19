import 'lxgw-wenkai-webfont/lxgwwenkai-regular.css'
import 'lxgw-wenkai-webfont/lxgwwenkai-bold.css'
import './fonts.css'
import './tokens.css'
import './style.css'
import './toc.css'
import './ui.css'
import './print.css'
import { startBlocks, startDragGuard, startFolds, startJumps } from './blocks.js'
import { startCopy } from './copy.js'
import { startNotes } from './notes.js'
import { startPreviews } from './preview.js'
import { startComponents } from './runtime.js'
import { startSwitcher } from './switcher.js'
import { startToc } from './toc.js'

const article = document.querySelector('.bk-article')
if (article) {
  startBlocks(article)
  startFolds(article)
  startNotes(article)
  startToc()
  startPreviews()
  startJumps()
  startDragGuard()
  startComponents(article)
  startCopy(article)
}
startSwitcher()
