import { readdir, readFile, access } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
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
     for(const m of text.matchAll(/from\s+['"]([^'"]+)['"]/g))if(m[1].includes('examples/')||m[1].includes('mods/')||m[1].includes('apps/'))errors.push(`${p}: source imports host ${m[1]}`);
     if(norm.includes('/core/src/')&&/from ['"](?:@game-ai\/(?:storage|model|mud-core)|pg)['"]/.test(text))errors.push(`${p}: core imports concrete provider`);
   }
 }
 if(p.replaceAll('\\','/').includes('/apps/web/src/')&&/\.[cm]?tsx?$/.test(p)){
   for(const m of text.matchAll(/from\s+['"]([^'"]+)['"]/g))if(m[1].includes('/mods/')||m[1].includes('/packages/storage/')||m[1]==='@game-ai/storage')errors.push(`${p}: browser imports server rules ${m[1]}`);
 }
}
for(const name of ['AGENTS.md','ARCHITECT.md','.agents/note/README.md','Dockerfile','compose.yaml']){try{await access(resolve(root,name));}catch{errors.push(`Missing ${name}`);}}
const notes=files.filter(p=>p.replaceAll('\\','/').includes('/.agents/note/')&&!['README.md','TEMPLATE.md'].includes(p.split(/[\\/]/).at(-1)));
for(const p of notes){const t=await readFile(p,'utf8');for(const field of ['Status:','## 需求','## 范围','## 验收','## 当前进展','## 待完善'])if(!t.includes(field))errors.push(`${p}: missing ${field}`);}
if(errors.length){console.error(errors.join('\n'));process.exit(1);}console.log(`Repository checks passed: ${files.length} files, ${notes.length} requirement notes.`);
