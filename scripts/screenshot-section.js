const sectionStart = '<!-- screenshots:start -->';
const sectionEnd = '<!-- screenshots:end -->';

const markedSection = /<!-- screenshots:start -->[\s\S]*<!-- screenshots:end -->/;

export function screenshotSection({ summary, commit, runUrl }) {
  return [
    sectionStart,
    '## Screenshots',
    '',
    `Every page of \`examples/blog/\` at 1440 and 375 pixels wide, light and dark, for commit ${commit.slice(0, 7)} compared with its base branch. [Run](${runUrl})`,
    '',
    summary.trim(),
    sectionEnd,
  ].join('\n');
}

export function replaceSection(body, section) {
  const text = body ?? '';
  if (markedSection.test(text)) return text.replace(markedSection, () => section);
  return text.trim() === '' ? section : `${text.trimEnd()}\n\n${section}`;
}
