import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Core from './core.js';
import Policy from './policy.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// Use nearest-rank quartiles so every reported percentile is an observed result.
function distribution(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = fraction => sorted[Math.ceil(fraction * sorted.length) - 1];
  return {
    count: sorted.length, min: sorted[0], p25: percentile(0.25), median: percentile(0.5),
    p75: percentile(0.75), max: sorted.at(-1),
    mean: sorted.reduce((total, value) => total + value, 0) / sorted.length
  };
}

export function simulate(count, firstSeed) {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('런 수는 1 이상의 정수여야 합니다.');
  if (!Number.isSafeInteger(firstSeed) || firstSeed < 0 || firstSeed > 0xffffffff) {
    throw new Error('첫 시드는 0~4294967295 범위의 정수여야 합니다.');
  }
  const runs = [];
  for (let i = 0; i < count; i++) {
    const seed = (firstSeed + i) >>> 0;
    const game = Policy.run(seed);
    runs.push({ seed, outcome: game.phase, finalWeek: game.week, finalDice: game.dice.length,
      visits: game.history.map(({ week, visitor, score, diceCount }) => ({ week, visitor, score, diceCount })) });
  }
  const weeks = [];
  const weekCount = Core.CONFIG.weeks;
  const visitorCount = Core.CONFIG.visitorsPerWeek;
  for (let week = 1; week <= weekCount; week++) {
    const reached = runs.filter(run => run.finalWeek >= week);
    const visits = reached.flatMap(run => run.visits.filter(visit => visit.week === week));
    const visitors = Array.from({ length: visitorCount }, (_, i) => {
      const audience = visits.filter(visit => visit.visitor === i + 1);
      return { visitor: i + 1, impression: distribution(audience.map(v => v.score)) };
    });
    weeks.push({ week, reached: reached.length, reachRate: reached.length / count,
      diceAfterEvaluation: distribution(visits.filter(v => v.visitor === visitorCount).map(v => v.diceCount)), visitors });
  }
  return { rulesVersion: Core.CONFIG.rulesVersion, firstSeed, runCount: count,
    wins: runs.filter(run => run.outcome === 'won').length, weeks, runs };
}

function parse(args) {
  const options = { count: 1, seed: 1 };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--runs' || flag === '--seeds') options.count = Number(args[++i]);
    else if (flag === '--seed' || flag === '--start') options.seed = Number(args[++i]);
    else if (flag === '--out' && args[i + 1]) options.out = args[++i];
    else if (i === 0 && /^\d+$/.test(flag)) options.count = Number(flag);
    else throw new Error('알 수 없는 인자 또는 누락된 값: ' + flag);
  }
  return options;
}

function range(stats) {
  return stats ? stats.min + '/' + stats.median + '/' + stats.max : '—';
}

function main(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log('node prototype/simulate.mjs --runs 10 --seed 1 [--out 새파일.json]');
    return;
  }
  const options = parse(args);
  const report = simulate(options.count, options.seed);
  const filename = options.out ? path.resolve(options.out)
    : path.join(here, 'results', 'v5-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid + '.json');
  mkdirSync(path.dirname(filename), { recursive: true });
  writeFileSync(filename, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log('자동 플레이 ' + report.runCount + '런 · 클리어 ' + report.wins + '런');
  console.log('주차 | 도달률 | 평가 후 주사위 | 일반 1 감동 | 일반 2 감동 | 평가 감동');
  console.log('분포는 최솟값/중앙값/최댓값입니다.');
  for (const week of report.weeks) {
    console.log([week.week, (100 * week.reachRate).toFixed(1) + '%', range(week.diceAfterEvaluation),
      ...week.visitors.map(v => range(v.impression))].join(' | '));
  }
  console.log('결과 파일 ' + filename);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
