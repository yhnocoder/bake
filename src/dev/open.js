import { spawn } from 'node:child_process';

export function openCommand(platform, url) {
  if (platform === 'darwin') return ['open', [url]];
  if (platform === 'win32') return ['cmd', ['/c', 'start', '""', url]];
  return ['xdg-open', [url]];
}

export function openInBrowser(url) {
  const [command, args] = openCommand(process.platform, url);
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.unref();
}
