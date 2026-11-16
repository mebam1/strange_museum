import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=path.dirname(fileURLToPath(import.meta.url));
const source=path.join(root,'dist');
const read=name=>readFile(path.join(source,name),'utf8');
const [html,css,catalog,engine,app]=await Promise.all(['index.html','styles.css','catalog.js','engine.js','app.js'].map(read));
const cleanCatalog=catalog.replace(/^export /gm,'');
const cleanEngine=engine.replace(/^import .*\r?\n/gm,'').replace(/^export \{.*\} from .*\r?\n/gm,'').replace(/^export /gm,'');
const exports=['ARTIFACTS','getArtifactDefinition','CONFIG','SHAPES','action','createGame','getArtifactFootprint','getBoardCells','getVisitorTarget','getWeekMultiplier','legalArtifactPlacement','legalPiecePlacement','previewSubmission','restoreGame','rotatedCells'];
const cleanApp=app.replace(/^import\s*\{([\s\S]*?)\}\s*from\s*'\.\/engine\.js';/, 'const {$1}=MuseumEngine;');
const bundle=`const MuseumEngine=(()=>{\n${cleanCatalog}\n${cleanEngine}\nreturn {${exports.join(',')}};\n})();\n${cleanApp}`;
const checked=spawnSync(process.execPath,['--check','--input-type=module'],{input:bundle,encoding:'utf8',windowsHide:true});
if(checked.status!==0)throw new Error(checked.stderr||'Standalone syntax check failed.');
if(/\b(?:import|export)\s+(?:\{|\*|const|function)/.test(bundle))throw new Error('Unbundled module syntax remains.');
const output=html.replace('<link rel="stylesheet" href="./styles.css">',()=>`<style>\n${css}\n</style>`)
  .replace('<script type="module" src="./app.js"></script>',()=>`<script type="module">\n${bundle.replace(/<\/script/gi,'<\\/script')}\n</script>`);
await writeFile(path.join(source,'play.html'),output,'utf8');
console.log('Built dist/play.html — no external assets or server required.');
