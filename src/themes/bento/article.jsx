import { Block, HeadingLink, Sidenotes, arrange } from '../essay/article.jsx';

const SPAN_OF_WIDTH = { body: '1', wide: '2', page: 'page' };
const NARROW_COLUMNS = 2;

export function Article(props) {
  const { content, columns, labels } = props;
  const { intro, sections, rest } = arrange(content);
  const introNotes = intro.flatMap((entry) => entry.notes);
  return (
    <article class="bk-article bt-article" data-region="article">
      {intro.length === 0 && introNotes.length === 0 ? null : (
        <div class="bt-intro">
          {intro.map(({ block, afterHeading }) => (
            <Block block={block} afterHeading={afterHeading} labels={labels} />
          ))}
          <Notes notes={introNotes} labels={labels} />
        </div>
      )}
      {sections.length === 0 ? null : (
        <div class="bt-grid" data-columns={columns} style={columnStyle(columns)}>
          {sections.map(({ section, notes, entries }) => (
            <section class="bt-card" data-span={spanOf(section)} aria-labelledby={section.id}>
              <h2 id={section.id} data-line={section.line} data-end-line={section.endLine}>
                <span class="bk-chapter-number" data-ui>
                  {section.number}
                </span>
                <HeadingLink id={section.id} labels={labels} />
                <span class="bk-heading-text" innerHTML={section.title} />
              </h2>
              <Recap html={section.recap} />
              {entries.map(({ block, afterHeading }) => [
                <Block block={block} afterHeading={afterHeading} labels={labels} />,
                <Recap html={block.type === 'heading' ? recapOf(section, block.id) : undefined} />,
              ])}
              <Notes notes={[...notes, ...entries.flatMap((entry) => entry.notes)]} labels={labels} />
            </section>
          ))}
        </div>
      )}
      <Notes notes={rest} labels={labels} />
    </article>
  );
}

function Recap(props) {
  if (props.html === undefined) return null;
  return <div class="recap bt-recap" innerHTML={props.html} />;
}

function recapOf(section, id) {
  return section.subsections.find((subsection) => subsection.id === id)?.recap;
}

function Notes(props) {
  if (props.notes.length === 0) return null;
  return (
    <div class="bt-notes">
      <Sidenotes notes={props.notes} labels={props.labels} />
    </div>
  );
}

function spanOf(section) {
  if (section.width !== undefined) return SPAN_OF_WIDTH[section.width];
  const widths = new Set(section.blocks.map((block) => block.width));
  if (widths.has('page')) return 'page';
  if (widths.has('wide')) return '2';
  return 'auto';
}

function columnStyle(columns) {
  const counts = { columns, 'columns-narrow': Math.min(columns, NARROW_COLUMNS) };
  return Object.entries(counts)
    .map(([name, count]) => `--bt-${name}:${count}`)
    .join(';');
}
