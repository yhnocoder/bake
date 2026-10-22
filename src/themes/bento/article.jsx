import { REGIONS } from 'bake/regions';
import { Block, SectionHeading, Sidenotes, arrange, subsectionOf } from 'bake/theme';
import { levelSpan } from './spans.js';
import { STICKERS } from './stickers.js';

export function Article(props) {
  const { content, options, labels } = props;
  const { intro, sections, rest } = arrange(content, { recaps: true });
  const introText = intro.filter(({ block }) => !isThemeBlock(block));
  const introNotes = introText.flatMap((entry) => entry.notes);
  const cards = [...themeBlocks(intro), ...sections.flatMap((placed) => [{ placed }, ...themeBlocks(placed.entries)])];
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
            return <BlockCard entry={entry} columns={options.columns} labels={labels} />;
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
  const { entry, columns, labels } = props;
  const { block } = entry;
  const span = cardStyle(block.attributes, block.name === 'sticker' ? 1 : levelSpan('body', columns), columns);
  const icon = block.name === 'sticker' ? block.attributes.icon : undefined;
  return (
    <div
      class={`bt-card bt-${block.name}`}
      role="note"
      data-theme-block={block.name}
      data-rows={block.attributes.rows}
      data-color={block.attributes.color}
      data-icon={icon}
      data-line={block.line}
      data-end-line={block.endLine}
      style={span}
    >
      {icon === undefined ? null : <svg class="bt-sticker-icon" viewBox="0 0 24 24" aria-hidden="true" innerHTML={STICKERS[icon]} />}
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
