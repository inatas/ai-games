import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {ChatCompletionsAdapter} from '@game-ai/model';

test('Provider protocol: structured request, usage, non-200 errors and cancellation',async()=>{
 let mode='ok';let seen:any;
 const server=createServer(async(req,res)=>{
   let raw='';for await(const chunk of req)raw+=chunk;seen=JSON.parse(raw);
   if(mode==='wait')return;
   if(mode==='error'){res.writeHead(503);res.end('do not expose provider error');return;}
   res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:'{"decision":"ACCEPT"}'}}],usage:{prompt_tokens:7,completion_tokens:3}}));
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const adapter=new ChatCompletionsAdapter({baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,apiKey:'test-only',model:'protocol-test'});
 const request={requestId:'test',attempt:1,messages:[{role:'user' as const,content:'sample'}],outputSchema:{type:'object'},maxOutputTokens:100};
 try{
   const result=await adapter.generate(request,new AbortController().signal);assert.deepEqual(result.usage,{inputTokens:7,outputTokens:3});assert.equal(seen.response_format.type,'json_schema');
   mode='error';await assert.rejects(adapter.generate(request,new AbortController().signal),/MODEL_UNAVAILABLE/);
   mode='wait';const controller=new AbortController();const pending=adapter.generate(request,controller.signal);controller.abort();await assert.rejects(pending);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});

test('DS-01/02/03/04: DeepSeek profile uses JSON Output without changing generic protocol',async()=>{
 let seen:any[]=[];let responseMode='ok';
 const server=createServer(async(req,res)=>{
   let raw='';for await(const chunk of req)raw+=chunk;seen.push(JSON.parse(raw));
   res.setHeader('content-type','application/json');
   if(responseMode==='malformed'){res.end('{');return;}
   res.end(JSON.stringify(responseMode==='empty'?{choices:[{message:{content:''}}]}:{model:'deepseek-flash',choices:[{message:{content:'{"decision":"ACCEPT"}'}}]}));
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const baseUrl=`http://127.0.0.1:${(server.address() as any).port}/v1`;
 const request={requestId:'test',attempt:1,messages:[{role:'system' as const,content:'Return json.'}],outputSchema:{type:'object'},maxOutputTokens:123};
 try{
   const deepseek=new ChatCompletionsAdapter({baseUrl,apiKey:'test-only',model:'deepseek-flash',protocol:'deepseek'});
   await deepseek.generate(request,new AbortController().signal);
   assert.deepEqual(seen[0].response_format,{type:'json_object'});assert.equal(seen[0].max_tokens,123);assert.deepEqual(seen[0].thinking,{type:'disabled'});
   assert.equal('max_completion_tokens' in seen[0],false);
   const generic=new ChatCompletionsAdapter({baseUrl,apiKey:'test-only',model:'generic'});
   await generic.generate(request,new AbortController().signal);
   assert.equal(seen[1].response_format.type,'json_schema');assert.equal(seen[1].max_completion_tokens,123);assert.equal('thinking' in seen[1],false);
   responseMode='empty';await assert.rejects(deepseek.generate(request,new AbortController().signal),/MODEL_UNAVAILABLE/);
   responseMode='malformed';await assert.rejects(deepseek.generate(request,new AbortController().signal),/MODEL_UNAVAILABLE/);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});

