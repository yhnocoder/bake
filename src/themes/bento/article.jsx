import { REGIONS } from 'bake/regions';
import { Block, SectionHeading, Sidenotes, arrange, subsectionOf } from 'bake/theme';
import { levelSpan } from './spans.js';

export function Article(props) {
  const { content, options, labels } = props;
  const { intro, sections, rest } = arrange(content, { recaps: true });
  const introNotes = intro.flatMap((entry) => entry.notes);
  return (
    <article class="bk-article bt-article" data-region={REGIONS.article}>
      {intro.length === 0 && introNotes.length === 0 ? null : (
        <div class="bt-intro">
          {intro.map(({ block, afterHeading }) => (
            <Block block={block} afterHeading={afterHeading} labels={labels} />
          ))}
          <Notes notes={introNotes} labels={labels} />
        </div>
      )}
      {sections.length === 0 ? null : (
        <div class="bt-grid" data-columns={options.columns} style={gridStyle(options)}>
          {sections.map(({ section, notes, entries }) => (
            <section class="bt-card" data-span={spanOf(section)} data-rows={section.attributes.rows} style={cardStyle(section, options.columns)} aria-labelledby={section.id}>
              <SectionHeading section={section} labels={labels} />
              <Recap html={section.recap} />
              {entries.map(({ block, afterHeading }) => [
                <Block block={block} afterHeading={afterHeading} labels={labels} />,
                <Recap html={subsectionOf(section, block)?.recap} />,
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

function Notes(props) {
  if (props.notes.length === 0) return null;
  return (
    <div class="bt-notes">
      <Sidenotes notes={props.notes} labels={props.labels} />
    </div>
  );
}

function spanOf(section) {
  const { cols, width } = section.attributes;
  if (cols !== undefined) return 'cols';
  if (width !== undefined) return width;
  const widths = new Set(section.blocks.map((block) => block.width));
  if (widths.has('page')) return 'page';
  if (widths.has('wide')) return 'wide';
  return 'auto';
}

function cardStyle(section, columns) {
  const { cols, rows } = section.attributes;
  const span = cols === undefined ? levelSpan(spanOf(section), columns) : Math.min(cols, columns);
  return rows === undefined ? `--bt-span:${span}` : `--bt-span:${span};--bt-rows:${rows}`;
}

function gridStyle(options) {
  return `--bt-columns:${options.columns};--bt-row-height:${options.rowHeight}px`;
}
