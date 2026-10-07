function cssSize(value) {
  return /^\d+(?:\.\d+)?$/.test(value) ? `${value}px` : value;
}

export function imageAppearance(attributes = {}) {
  const style = [];
  if (attributes.width) style.push(`width: ${cssSize(attributes.width)}`);
  if (attributes.height) style.push(`height: ${cssSize(attributes.height)}`);
  if (attributes.height && !attributes.width) style.push('width: auto');
  const className = ['image'];
  if (attributes.float && attributes.float !== 'none') className.push(`float-${attributes.float}`);
  return { className, style: style.join('; ') };
}
