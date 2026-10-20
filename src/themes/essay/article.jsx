import { Block, SectionHeading, Sidenotes, arrange } from 'bake/theme';

export function Article(props) {
  const { content, labels } = props;
  const { intro, sections, rest } = arrange(content);
  return (
    <article class="bk-article" data-region="article">
      <Flow entries={intro} labels={labels} />
      {sections.map(({ section, notes, entries }) => (
        <section class="bk-section">
          <SectionHeading section={section} labels={labels} />
          <Sidenotes notes={notes} labels={labels} />
          <Flow entries={entries} labels={labels} />
        </section>
      ))}
      <Sidenotes notes={rest} labels={labels} />
    </article>
  );
}

function Flow(props) {
  return props.entries.map(({ block, afterHeading, notes }) => [<Block block={block} afterHeading={afterHeading} labels={props.labels} />, <Sidenotes notes={notes} labels={props.labels} />]);
}
