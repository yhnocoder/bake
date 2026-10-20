import mime from 'mime';

export function contentType(path) {
  const type = mime.getType(path) ?? 'application/octet-stream';
  return type.startsWith('text/') ? `${type}; charset=utf-8` : type;
}
