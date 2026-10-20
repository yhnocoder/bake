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
  const take = (numbers) =>
    numbers.flatMap((number) => {
      if (placed.has(number)) return [];
      placed.add(number);
      const note = notes.get(number);
      return [note, ...take(note.sidenotes)];
    });
  const recapNotes = (heading) => (recaps && heading !== undefined ? heading.recapSidenotes : []);
  const entries = (blocks, section) =>
    blocks.map((block, index) => ({
      block,
      afterHeading: index === 0 ? section !== undefined : blocks[index - 1].type === 'heading',
      notes: take([...block.sidenotes, ...recapNotes(subsectionOf(section, block))]),
    }));
  const intro = entries(content.intro);
  const sections = content.sections.map((section) => ({ section, notes: take([...section.titleSidenotes, ...recapNotes(section)]), entries: entries(section.blocks, section) }));
  const rest = content.sidenotes.filter((note) => !placed.has(note.number));
  return { intro, sections, rest };
}

export function subsectionOf(section, block) {
  if (block.type !== 'heading') return undefined;
  return section?.subsections.find((subsection) => subsection.id === block.id);
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
    <a class="bk-heading-link" href={`#${encodeURIComponent(props.id)}`} aria-label={props.labels.copyLink} data-ui>
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
