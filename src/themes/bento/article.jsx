import { REGIONS } from 'bake/regions';
import { Block, SectionHeading, Sidenotes, arrange, subsectionOf } from 'bake/theme';
import { levelSpan } from './spans.js';

const TILTS = ['-1.5deg', '1deg', '-0.75deg', '1.5deg'];
const EMOJI_ONLY = /^<p[^>]*>[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}‍️\s]+<\/p>$/u;

export function Article(props) {
  const { content, options, labels } = props;
  const { intro, sections, rest } = arrange(content, { recaps: true });
  const introText = intro.filter(({ block }) => !isThemeBlock(block));
  const introNotes = introText.flatMap((entry) => entry.notes);
  const cards = [...themeBlocks(intro), ...sections.flatMap((placed) => [{ placed }, ...themeBlocks(placed.entries)])];
  let stickers = 0;
  return (
    <article class="bk-article bt-article" data-region={REGIONS.article}>
      {introText.length === 0 && introNotes.length === 0 ? null : (
        <div class="bt-intro">
          {introText.map(({ block, afterHeading }) => (
            <Block block={block} afterHeading={afterHeading} labels={labels} />
          ))}
          <Notes notes={introNotes} labels={labels} />
        </div>
      )}
      {cards.length === 0 ? null : (
        <div class="bt-grid" data-columns={options.columns} style={gridStyle(options)}>
          {cards.map(({ placed, entry }) => {
            if (placed !== undefined) return <SectionCard {...placed} columns={options.columns} labels={labels} />;
            const tilt = entry.block.name === 'sticker' ? TILTS[stickers++ % TILTS.length] : undefined;
            return <BlockCard entry={entry} columns={options.columns} tilt={tilt} labels={labels} />;
          })}
        </div>
      )}
      <Notes notes={rest} labels={labels} />
    </article>
  );
}

function SectionCard(props) {
  const { section, notes, columns, labels } = props;
  const entries = props.entries.filter(({ block }) => !isThemeBlock(block));
  return (
    <section class="bt-card" data-span={spanOf(section)} data-rows={section.attributes.rows} style={cardStyle(section.attributes, levelSpan(spanOf(section), columns), columns)} aria-labelledby={section.id}>
      <SectionHeading section={section} labels={labels} />
      <Recap html={section.recap} />
      {entries.map(({ block, afterHeading }) => [
        <Block block={block} afterHeading={afterHeading} labels={labels} />,
        <Recap html={subsectionOf(section, block)?.recap} />,
      ])}
      <Notes notes={[...notes, ...entries.flatMap((entry) => entry.notes)]} labels={labels} />
    </section>
  );
}

function BlockCard(props) {
  const { entry, columns, tilt, labels } = props;
  const { block } = entry;
  const span = cardStyle(block.attributes, block.name === 'sticker' ? 1 : levelSpan('body', columns), columns);
  const emoji = block.name === 'sticker' && EMOJI_ONLY.test(block.html);
  return (
    <div
      class={`bt-card bt-${block.name}`}
      role="note"
      data-theme-block={block.name}
      data-rows={block.attributes.rows}
      data-color={block.attributes.color}
      data-emoji={emoji ? '' : undefined}
      data-line={block.line}
      data-end-line={block.endLine}
      style={tilt === undefined ? span : `${span};--bt-tilt:${tilt}`}
    >
      <div class="bt-block-body" innerHTML={block.html} />
      <Notes notes={entry.notes} labels={labels} />
    </div>
  );
}

function themeBlocks(entries) {
  return entries.filter(({ block }) => isThemeBlock(block)).map((entry) => ({ entry }));
}

function isThemeBlock(block) {
  return block.type === 'themeBlock';
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

function cardStyle({ cols, rows }, span, columns) {
  const style = `--bt-span:${cols === undefined ? span : Math.min(cols, columns)}`;
  return rows === undefined ? style : `${style};--bt-rows:${rows}`;
}

function gridStyle(options) {
  return `--bt-columns:${options.columns};--bt-row-height:${options.rowHeight}px`;
}
