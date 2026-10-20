import { fragmentOf } from 'bake/fragments';

const SIDENOTE_REFERENCE = /data-sidenote="(\d+)"/g;
const PLACED_BLOCKS = new Set(['math', 'code', 'table', 'list-table', 'example', 'figure', 'component', 'embed']);
const FLOATED_FIGURE = /^<figure[^>]*\sdata-float=/;

export function Article(props) {
  const { content, labels } = props;
  const { intro, sections, rest } = arrange(content);
  return (
    <article class="bk-article" data-region="article">
      <Flow entries={intro} labels={labels} />
      {sections.map(({ section, notes, entries }) => (
        <section class="bk-section">
          <h2 id={section.id} data-line={section.line} data-end-line={section.endLine}>
            <span class="bk-chapter-number" data-ui>
              {section.number}
            </span>
            <HeadingLink id={section.id} labels={labels} />
            <span class="bk-heading-text" innerHTML={section.title} />
          </h2>
          <Sidenotes notes={notes} labels={labels} />
          <Flow entries={entries} labels={labels} />
        </section>
      ))}
      <Sidenotes notes={rest} labels={labels} />
    </article>
  );
}

export function arrange(content, { recaps = false } = {}) {
  const notes = new Map(content.sidenotes.map((note) => [note.number, note]));
  const placed = new Set();
  const take = (html) => {
    const found = [];
    for (const [, digits] of html.matchAll(SIDENOTE_REFERENCE)) {
      const number = Number(digits);
      if (placed.has(number) || !notes.has(number)) continue;
      placed.add(number);
      found.push(notes.get(number), ...take(notes.get(number).html));
    }
    return found;
  };
  const shownRecap = (html) => (recaps && html !== undefined ? html : '');
  const entries = (blocks, section) =>
    blocks.map((block, index) => ({
      block,
      afterHeading: index === 0 ? section !== undefined : blocks[index - 1].type === 'heading',
      notes: take(block.html + shownRecap(block.type === 'heading' ? subsectionRecap(section, block.id) : undefined)),
    }));
  const intro = entries(content.intro);
  const sections = content.sections.map((section) => ({ section, notes: take(section.title + shownRecap(section.recap)), entries: entries(section.blocks, section) }));
  const rest = content.sidenotes.filter((note) => !placed.has(note.number));
  return { intro, sections, rest };
}

export function subsectionRecap(section, id) {
  return section?.subsections.find((subsection) => subsection.id === id)?.recap;
}

function Flow(props) {
  return props.entries.map(({ block, afterHeading, notes }) => [<Block block={block} afterHeading={afterHeading} labels={props.labels} />, <Sidenotes notes={notes} labels={props.labels} />]);
}

export function Block(props) {
  const { block, afterHeading, labels } = props;
  if (block.type === 'heading') return <Heading block={block} labels={labels} />;
  if (block.type === 'references') {
    return (
      <div class="bk-block bk-references" data-type="references" data-line={block.line} data-end-line={block.endLine}>
        {afterHeading ? null : (
          <p class="bk-references-label" data-ui>
            {labels.references}
          </p>
        )}
        <div class="bk-references-list" innerHTML={block.html} />
      </div>
    );
  }
  const width = blockWidth(block);
  if (block.naturalWidth === undefined) return <div class="bk-block" data-type={block.type} data-width={width} data-line={block.line} data-end-line={block.endLine} innerHTML={block.html} />;
  return <div class="bk-block" data-type={block.type} data-width={width} data-line={block.line} data-end-line={block.endLine} style={`--natural-width:${block.naturalWidth}`} innerHTML={block.html} />;
}

function blockWidth(block) {
  if (block.width !== undefined) return block.width;
  if (!PLACED_BLOCKS.has(block.type)) return undefined;
  if (block.type === 'figure' && (block.naturalWidth === undefined || FLOATED_FIGURE.test(block.html))) return undefined;
  return 'auto';
}

function Heading(props) {
  const { block, labels } = props;
  const content = [<HeadingLink id={block.id} labels={labels} />, <span class="bk-heading-text" innerHTML={block.title} />];
  if (block.depth <= 3) return <h3 id={block.id} data-line={block.line} data-end-line={block.endLine}>{content}</h3>;
  if (block.depth === 4) return <h4 id={block.id} data-line={block.line} data-end-line={block.endLine}>{content}</h4>;
  if (block.depth === 5) return <h5 id={block.id} data-line={block.line} data-end-line={block.endLine}>{content}</h5>;
  return <h6 id={block.id} data-line={block.line} data-end-line={block.endLine}>{content}</h6>;
}

export function HeadingLink(props) {
  return (
    <a class="bk-heading-link" href={fragmentOf(props.id)} aria-label={props.labels.copyLink} data-ui>
      #
    </a>
  );
}

export function Sidenotes(props) {
  return props.notes.map((note) => (
    <aside class="bk-sidenote" id={note.id} data-sidenote={note.number} data-label={note.label} data-line={note.line} data-end-line={note.endLine}>
      <span class="bk-sidenote-number" data-ui>
        {note.number}
      </span>
      <div class="bk-sidenote-body" innerHTML={note.html} />
    </aside>
  ));
}
