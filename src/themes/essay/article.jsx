import { Dynamic } from 'solid-js/web';

const SIDENOTE_REFERENCE = /data-sidenote="(\d+)"/g;
const PLACED_BLOCKS = new Set(['math', 'code', 'table', 'list-table', 'example', 'figure', 'component', 'embed']);

export function Article(props) {
  const { content, labels } = props;
  const { intro, sections, rest } = arrange(content);
  return (
    <article class="bk-article">
      <Flow entries={intro} labels={labels} />
      {sections.map(({ section, notes, entries }) => (
        <section class="bk-section" data-width={section.width}>
          <h2 id={section.id}>
            <span class="bk-chapter-number">{section.number}</span>
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

function arrange(content) {
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
  const entries = (blocks, startsSection) =>
    blocks.map((block, index) => ({
      block,
      afterHeading: index === 0 ? startsSection : blocks[index - 1].type === 'heading',
      notes: take(block.html),
    }));
  const intro = entries(content.intro, false);
  const sections = content.sections.map((section) => ({ section, notes: take(section.title), entries: entries(section.blocks, true) }));
  const rest = content.sidenotes.filter((note) => !placed.has(note.number));
  return { intro, sections, rest };
}

function Flow(props) {
  return props.entries.map(({ block, afterHeading, notes }) => [<Block block={block} afterHeading={afterHeading} labels={props.labels} />, <Sidenotes notes={notes} labels={props.labels} />]);
}

function Block(props) {
  const { block, afterHeading, labels } = props;
  if (block.type === 'heading') {
    return (
      <Dynamic component={`h${Math.min(block.depth, 6)}`} id={block.id}>
        <HeadingLink id={block.id} labels={labels} />
        <span class="bk-heading-text" innerHTML={block.title} />
      </Dynamic>
    );
  }
  if (block.type === 'references') {
    return (
      <div class="bk-block bk-references" data-type="references">
        {afterHeading ? null : <p class="bk-references-label">{labels.references}</p>}
        <div class="bk-references-list" innerHTML={block.html} />
      </div>
    );
  }
  const width = block.width ?? (PLACED_BLOCKS.has(block.type) ? 'auto' : undefined);
  const style = block.naturalWidth === undefined ? undefined : `--natural-width:${block.naturalWidth}`;
  return <div class="bk-block" data-type={block.type} data-width={width} style={style} innerHTML={block.html} />;
}

function HeadingLink(props) {
  return (
    <a class="bk-heading-link" href={`#${encodeURIComponent(props.id)}`} aria-label={props.labels.copyLink}>
      #
    </a>
  );
}

function Sidenotes(props) {
  return props.notes.map((note) => (
    <aside class="bk-sidenote" id={note.id} data-sidenote={note.number}>
      <span class="bk-sidenote-number">{note.number}</span>
      <div class="bk-sidenote-body" innerHTML={note.html} />
    </aside>
  ));
}
