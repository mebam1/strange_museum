import { readFile, writeFile } from 'node:fs/promises';

const htmlFile = new URL('./dist/index.html', import.meta.url);
const original = await readFile(htmlFile, 'utf8');
const tags = [...original.matchAll(/<link rel="stylesheet" href="([^"]+)">|<script src="([^"]+)"><\/script>/g)];
let html = original;
for (const tag of tags) {
  const source = await readFile(new URL(tag[1] || tag[2], htmlFile), 'utf8');
  const inline = tag[1] ? '<style>\n' + source + '\n</style>' :
    '<script>\n' + source.replace(/<\/script/gi, '<\\/script') + '\n</script>';
  html = html.replace(tag[0], () => inline);
}
await writeFile(new URL('./play.html', htmlFile), html);
console.log('dist/play.html 생성 완료');
