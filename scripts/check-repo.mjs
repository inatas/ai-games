import { readdir, readFile, access } from 'node:fs/promises';
import { resolve, dirname, extname, basename } from 'node:path';
const root=process.cwd();
const ignored=new Set(['node_modules','.git','.local','dist']);
const files=[];
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){if(ignored.has(e.name))continue;const p=resolve(dir,e.name);if(e.isDirectory())await walk(p);else files.push(p);}}
await walk(root);
const errors=[];
for(const p of files){
 const text=await readFile(p,'utf8');
 if(extname(p)==='.md'){
   if((text.match(/^```/gm)?.length??0)%2)errors.push(`${p}: unmatched code fence`);
   for(const m of text.matchAll(/\]\(([^)]+)\)/g)){
     const link=m[1].split('#')[0];if(!link||/^[a-z]+:/i.test(link))continue;
     try{await access(resolve(dirname(p),decodeURIComponent(link)));}catch{errors.push(`${p}: missing link ${link}`);}
   }
 }
 if(p.includes(`${process.platform==='win32'?'\\':'/'}packages${process.platform==='win32'?'\\':'/'}`)&&/\.[cm]?tsx?$/.test(p)){
   const norm=p.replaceAll('\\','/');
   if(norm.includes('/src/')){
     // The two game frameworks are peers; shared base packages cannot depend on either.
     const dependencies = [...text.matchAll(/(?:from\s+|import\s*\()['"]([^'"]+)['"]/g)].map(m => m[1]);
     const importsTurnBased = dependencies.some(dep => dep === '@game-ai/turn-based' || dep.startsWith('@game-ai/turn-based/') || /(?:^|\/)turn-based\//.test(dep));
     if (/\/packages\/(?:core|model|identity|storage|platform|game-systems)\/src\//.test(norm) && importsTurnBased) errors.push(`${p}: lower layer or MUD imports turn-based framework`);
     if (norm.includes('/turn-based/src/')) {
       for (const dep of dependencies) {
         if (!(dep.startsWith('./') || dep.startsWith('node:') || dep === '@game-ai/core' || dep === 'ajv')) errors.push(`${p}: turn-based imports outside its base contracts: ${dep}`);
       }
     }
     for(const m of text.matchAll(/from\s+['"]([^'"]+)['"]/g))if(m[1].includes('examples/')||m[1].includes('mods/')||m[1].includes('apps/'))errors.push(`${p}: source imports host ${m[1]}`);
     if(/from ['"]@game-ai\/mud-core['"]/.test(text))errors.push(`${p}: removed compatibility package imported`);
     if(norm.includes('/storage/src/')&&/from ['"]@game-ai\/(?:platform|game-systems)['"]/.test(text))errors.push(`${p}: storage imports upper layer`);
     if(norm.includes('/core/src/')&&/from ['"](?:@game-ai\/(?:storage|model|mud-core|platform|game-systems)|pg)['"]/.test(text))errors.push(`${p}: core imports concrete provider`);
     if(norm.includes('/platform/src/')){
       if(/(?:from\s+|import\s*\()['"](?:@game-ai\/(?:game-systems|mud-core|storage)|[^'"]*(?:game-systems|mods)\/)/.test(text))errors.push(`${p}: platform imports upper layer`);
       if(/\b(?:room_id|mud_npcs|mud_tasks|mud_participants|mud_rewards|game_inventory)\b/.test(text))errors.push(`${p}: platform owns game-system state`);
     }
     if(norm.includes('/game-systems/src/')&&/from ['"]@game-ai\/(?:mud-core|storage)['"]/.test(text))errors.push(`${p}: systems import composition layer`);
   }
 }
 const norm=p.replaceAll('\\','/');
 if(/\.[cm]?tsx?$/.test(p)){
   if(norm.includes('/apps/server/src/')&&!['app.ts','main.ts'].includes(basename(p)))errors.push(`${p}: app server contains MOD implementation`);
   if(norm.includes('/apps/web/src/')&&basename(p)!=='main.tsx')errors.push(`${p}: app web contains MOD implementation`);
   if(norm.includes('/apps/shared/'))errors.push(`${p}: game-specific shared code belongs to its MOD`);
   const dependencies=[...text.matchAll(/(?:from\s+|import\s*\(|import\s+)['"]([^'"]+)['"]/g)].map(m=>m[1]);
   if(/\/mods\/qingxi\/(?:src|server|web)\//.test(norm)&&dependencies.some(dep=>dep.includes('werewolf/')))errors.push(`${p}: Qingxi imports Werewolf`);
   if(/\/mods\/werewolf\/(?:src|server|web|shared)\//.test(norm)&&dependencies.some(dep=>dep.includes('qingxi/')))errors.push(`${p}: Werewolf imports Qingxi`);
   if(norm.includes('/apps/web/src/')||/\/mods\/(?:qingxi|werewolf)\/web\//.test(norm)){
     for(const dep of dependencies)if(dep.includes('/packages/storage/')||dep==='@game-ai/storage'||dep.includes('/mods/werewolf/src/')||dep.includes('/mods/werewolf/server/')||dep.includes('/mods/qingxi/src/')||dep.includes('/mods/qingxi/server/'))errors.push(`${p}: browser imports server rules ${dep}`);
   }
 }
}
for(const name of ['AGENTS.md','ARCHITECT.md','.agents/note/README.md','Dockerfile','compose.yaml']){try{await access(resolve(root,name));}catch{errors.push(`Missing ${name}`);}}
const notes=files.filter(p=>p.replaceAll('\\','/').includes('/.agents/note/')&&/^\d{3}-.*\.md$/.test(basename(p)));
for(const p of notes){
  const t=await readFile(p,'utf8');
  for(const field of ['## 需求','## 范围','## 验收','## 当前进展','## 待完善'])if(!t.includes(field))errors.push(`${p}: missing ${field}`);
  if((t.match(/^Status: (?:proposed|implemented|rejected|archived)(?=[；（\r\n])/gm)?.length??0)!==1)errors.push(`${p}: expected one canonical Status`);
  const index=await readFile(resolve(dirname(p),'README.md'),'utf8');
  const reference=`](${basename(p)})`;
  if(index.split(reference).length!==2)errors.push(`${p}: expected one README index entry`);
}
if(errors.length){console.error(errors.join('\n'));process.exit(1);}console.log(`Repository checks passed: ${files.length} files, ${notes.length} requirement notes.`);
