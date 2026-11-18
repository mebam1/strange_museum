const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Policy = require('../policy.js');

const dist = path.resolve(__dirname, '../dist');
const read = file => readFileSync(path.resolve(dist, file), 'utf8').replace(/\r\n/g, '\n');
const html = read('play.html');
const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1].trim());

test('단일 HTML이 현재 원본 스크립트와 스타일을 순서대로 모두 포함한다', () => {
  const source = read('index.html');
  const scripts = [...source.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => read(match[1]).trim());
  assert.deepEqual(inlineScripts, scripts);
  const css = read(source.match(/<link rel="stylesheet" href="([^"]+)">/)[1]);
  assert.equal(html.match(/<style>([\s\S]*?)<\/style>/)[1].trim(), css.trim());
  assert.doesNotMatch(html, /<script src=|<link rel="stylesheet"/);
});

test('단일 HTML과 Node에서 같은 시드와 자동 입력으로 같은 결과를 얻는다', () => {
  const browser = vm.createContext({});
  for (const source of inlineScripts.slice(0, 4)) vm.runInContext(source, browser);
  const actual = vm.runInContext('JSON.stringify(MuseumPolicy.run(6))', browser);
  assert.deepEqual(JSON.parse(actual), Policy.run(6));
});
