import pg from 'pg';
import { PostgresStore } from '@game-ai/storage';
import { Harness } from '@game-ai/core';
import { ScriptedModel } from '@game-ai/model';
import { counterBinding } from './counter.ts';
const store=new PostgresStore(new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${process.env.TEST_SCHEMA}`}));
const h=new Harness(store,new ScriptedModel(()=>'{"decision":"ACCEPT"}'),{clock:{now:()=>0},hook:async point=>{if(point===process.env.CRASH_POINT)process.exit(77);}}).register(counterBinding(store));
await h.submit(JSON.parse(process.env.TEST_REQUEST!));await h.drain();await store.pool.end();


