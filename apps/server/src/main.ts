import pg from 'pg';
import { PostgresStore } from '@game-ai/storage';
import { ChatCompletionsAdapter } from '@game-ai/model';
import { demoModel } from '../../../examples/wuxia-mud/src/game.ts';
import { buildApp } from './app.ts';

export async function startServer(connectionString?:string){
  const store=new PostgresStore(new pg.Pool({connectionString}));
  const real=process.env.MODEL_MODE==='real';
  if(real&&(!process.env.MODEL_BASE_URL||!process.env.MODEL_API_KEY||!process.env.MODEL_NAME))throw new Error('Real mode requires MODEL_BASE_URL, MODEL_API_KEY and MODEL_NAME');
  const protocol=process.env.MODEL_PROTOCOL??'json-schema';
  if(!['json-schema','deepseek'].includes(protocol))throw new Error('MODEL_PROTOCOL must be json-schema or deepseek');
  const model=real?new ChatCompletionsAdapter({baseUrl:process.env.MODEL_BASE_URL!,apiKey:process.env.MODEL_API_KEY!,model:process.env.MODEL_NAME!,protocol:protocol as 'json-schema'|'deepseek'}):demoModel();
  const {app}=await buildApp(store,model,real?'real':'mock');
  await app.listen({host:process.env.HOST??'127.0.0.1',port:Number(process.env.PORT??3000)});
  console.log(`Game AI Harness: http://127.0.0.1:${process.env.PORT??3000} (${real?'real provider':'deterministic demo mock'})`);
  return async()=>{await app.close();await store.pool.end();};
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('apps/server/src/main.ts')){
  if(!process.env.DATABASE_URL&&!process.env.PGHOST)throw new Error('Set DATABASE_URL or PGHOST, or use docker compose up --build');
  const stop=await startServer(process.env.DATABASE_URL);
  for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void stop().then(()=>process.exit(0));});
}

