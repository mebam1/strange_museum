import { createReadStream, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import readline from 'node:readline';
import { parseArgs } from 'node:util';
import { applyCommand, help } from './commands.mjs';
import { openSession } from './session.mjs';
import { renderState } from './view.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const usage = [
  'node cli.mjs [--seed 정수] [--record 새파일.jsonl]',
  'node cli.mjs --resume 파일.jsonl [--do "명령"]',
  'node cli.mjs --replay 파일.jsonl [--visit 주차.관객번호]',
  'node cli.mjs --seed 정수 --commands 입력.txt [--record 새파일.jsonl]',
  '옵션 없이 시작하면 runs 폴더에 새 진행 기록을 만듭니다.',
  '', help
].join('\n');

function review(session) {
  const { game, entries } = session;
  const commands = entries.filter(e => e.type === 'command');
  const notes = entries.filter(e => e.type === 'note');
  const count = verb => commands.filter(e => verb.test(e.command)).length;
  const result = game.phase === 'won' ? '8주 클리어' : game.phase === 'lost' ? '평가 탈락' : '진행 중';
  const lines = [
    '시드 ' + session.seed + ' · ' + result + ' · 정산한 관객 ' + game.history.length + '명',
    '직접 제출 ' + count(/^submit\s/) + '회 · 직접 리롤 ' + count(/^(roll|reroll)\s/) +
      '회 · 비교 ' + count(/^compare\s/) + '회 · 자동 관람 ' + count(/^auto$/) + '회'
  ];
  for (const r of game.history) {
    lines.push(r.week + '주 ' + r.visitor + '번   감동 ' + r.score + '/' + r.target + '   팁 ' + r.tip +
      '원   주사위 ' + r.diceCount + '개' + (r.damage.length ? '   피해 ' + r.damage.join(' / ') : ''));
  }
  if (notes.length) {
    lines.push('판단 메모');
    for (const n of notes) lines.push('  ' + n.week + '주 ' + n.visitor + '번  ' + n.text);
  }
  return lines.join('\n');
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: {
    seed: { type:'string' }, record:{ type:'string' }, resume:{ type:'string' },
    replay:{ type:'string' }, visit:{ type:'string' }, commands:{ type:'string' }, do:{ type:'string', multiple:true },
    help:{ type:'boolean', short:'h' }
  } });
  if (values.help) { console.log(usage); return; }
  const seed = values.seed === undefined ? undefined : Number(values.seed);
  if (seed !== undefined && (!/^-?\d+$/.test(values.seed) || !Number.isSafeInteger(seed))) throw new Error('시드에는 정수를 입력하세요.');
  if ([values.record,values.resume,values.replay].filter(Boolean).length > 1) throw new Error('--record, --resume, --replay 중 하나를 사용하세요.');
  if (values.do && values.commands) throw new Error('--do와 --commands 중 하나를 사용하세요.');
  if (values.replay && (values.do || values.commands)) throw new Error('--replay는 기록만 검증합니다. 계속 플레이하려면 --resume을 사용하세요.');
  if (values.visit !== undefined && (!values.replay || !/^[1-8]\.[1-3]$/.test(values.visit))) {
    throw new Error('--visit은 --replay와 함께 사용합니다. 예를 들어 3주 평가에는 --visit 3.3을 씁니다.');
  }
  let file = values.record || values.resume || values.replay;
  const newSeed = seed ?? Date.now();
  if (!file) {
    const dir = path.join(root,'runs');
    mkdirSync(dir, { recursive:true });
    file = path.join(dir, 'run-' + new Date().toISOString().replace(/[:.]/g,'-') + '-' + process.pid + '.jsonl');
  }
  const transcript = [];
  function collectVisit(entry, result, after) {
    if (entry.type === 'session') return;
    // Arrival commands belong to the new visitor; later transactions belong
    // to the visitor whose viewing just financed the shop.
    const turn = result && after.phase === 'viewing' && entry.phase !== 'viewing' ? after : entry;
    if (values.visit !== turn.week + '.' + turn.visitor) return;
    transcript.push(entry.type === 'note' ? '메모  ' + entry.text : '> ' + entry.command + '\n' + result.text);
  }
  const s = openSession(file, { seed:values.resume || values.replay ? seed : newSeed,
    resume:!!values.resume, readOnly:!!values.replay, applyCommand, onReplay:values.visit ? collectVisit : undefined });
  let input;
  try {
    console.log('기록 ' + path.resolve(file) + ' · 시드 ' + s.seed);
    if (values.replay) {
      const details = values.visit ? transcript.join('\n\n') || '해당 관객의 명령 기록이 없습니다.' : review(s);
      console.log('재생 검증 완료\n' + details);
      return;
    }
    const execute = raw => {
      const line = raw.trim().replace(/^\uFEFF/, '');
      if (!line || line.startsWith('#')) return true;
      if (line === 'quit' || line === 'exit') return false;
      if (line === 'review') { console.log(review(s)); return true; }
      if (line.startsWith('note ') && line.slice(5).trim()) {
        s.note(line.slice(5).trim());
        console.log('판단 메모를 기록했습니다.');
        return true;
      }
      const result = s.act(line);
      if (!result.ok) throw new Error(line + ' — ' + result.text);
      console.log(result.text);
      return true;
    };
    if (values.do) {
      for (const line of values.do) if (!execute(line)) break;
      return;
    }
    const interactive = !values.commands && Boolean(process.stdin.isTTY);
    if (interactive || !values.commands) console.log(renderState(s.game) + '\nhelp로 명령 · quit로 종료');
    input = values.commands ? createReadStream(values.commands,{encoding:'utf8'}) : process.stdin;
    const rl = readline.createInterface({input, output:process.stdout, terminal:interactive, crlfDelay:Infinity});
    try {
      if (interactive) { rl.setPrompt('박물관> '); rl.prompt(); }
      for await (const line of rl) {
        try {
          if (!execute(line)) break;
        } catch (error) {
          if (!interactive) throw error;
          console.error(error.message);
        }
        if (interactive) rl.prompt();
      }
    } finally { rl.close(); }
  } finally {
    if (input && input !== process.stdin) input.destroy();
    s.close();
  }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
