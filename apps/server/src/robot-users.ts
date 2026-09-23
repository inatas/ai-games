import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv } from 'ajv';
import type { RobotUser, RobotPublicUser } from '@game-ai/core';

export const robotRoot = fileURLToPath(new URL('../../../robot-users/', import.meta.url));
const text = { type: 'string', minLength: 1, maxLength: 200 };
const schema = { type:'object', additionalProperties:false, required:['userId','kind','nickname','gender','avatar','portrait','persona','control'], properties: {
  userId:{type:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'}, kind:{const:'robot'}, nickname:text, gender:{enum:['male','female','unspecified']},
  avatar:{type:'object',additionalProperties:false,required:['src','size','position'],properties:{src:text,size:{type:'string',pattern:'^[0-9.]+% [0-9.]+%$'},position:{type:'string',pattern:'^[0-9.]+% [0-9.]+%$'}}},
  portrait:{type:'object',additionalProperties:false,required:['src','variant'],properties:{src:text,variant:{enum:['brown','pink','blue']}}},
  persona:{type:'object',additionalProperties:false,required:['mode','description'],properties:{mode:{const:'fixed'},description:text}},
  control:{oneOf:[{type:'object',additionalProperties:false,required:['kind','strategy','speech','modelProfile'],properties:{kind:{const:'script'},strategy:{enum:['fixed','random']},speech:{type:'string',minLength:1,maxLength:300,pattern:'\\S'},modelProfile:{type:'null'}}}, {type:'object',additionalProperties:false,required:['kind','modelProfile'],properties:{kind:{const:'model'},modelProfile:text}}]},
}};
const validate = new Ajv({strict:true}).compile(schema);
export function validateRobotUsers(input: unknown[], profileIds = ['environment-default']): RobotUser[] {
  if (!input.every(user => validate(user))) throw new Error('INVALID_ROBOT_USER');
  const users = input as unknown as RobotUser[];
  if (new Set(users.map(user => user.userId)).size !== users.length) throw new Error('DUPLICATE_ROBOT_USER');
  if (users.some(user => user.control.kind === 'model' && !profileIds.includes(user.control.modelProfile))) throw new Error('UNKNOWN_MODEL_PROFILE');
  return structuredClone(users);
}
export interface ModelProfile {
  id: string;
  adapter: 'chat-completions';
  environment: { baseUrl: string; model: string; apiKey: string; protocol: string };
  defaultProtocol: 'json-schema';
}
const validateProfile = new Ajv({ strict: true }).compile({
  type: 'object', additionalProperties: false,
  required: ['id', 'adapter', 'environment', 'defaultProtocol'],
  properties: {
    id: { type: 'string', pattern: '^[a-z0-9-]+$' },
    adapter: { const: 'chat-completions' }, defaultProtocol: { const: 'json-schema' },
    environment: {
      type: 'object', additionalProperties: false, required: ['baseUrl', 'model', 'apiKey', 'protocol'],
      properties: Object.fromEntries(['baseUrl', 'model', 'apiKey', 'protocol'].map(key => [key, { type: 'string', pattern: '^[A-Z][A-Z0-9_]*$' }])),
    },
  },
});
// Configuration loading validates references without reading secrets or creating an adapter.
export function loadModelProfiles(root = robotRoot): ModelProfile[] {
  const profiles = readdirSync(resolve(root, 'model-profiles')).filter(name => name.endsWith('.json')).sort()
    .map(name => JSON.parse(readFileSync(resolve(root, 'model-profiles', name), 'utf8')) as unknown);
  if (!profiles.every(profile => validateProfile(profile))) throw new Error('INVALID_MODEL_PROFILE');
  const result = profiles as ModelProfile[];
  if (new Set(result.map(profile => profile.id)).size !== result.length) throw new Error('DUPLICATE_MODEL_PROFILE');
  return result;
}
export function loadRobotUsers(root = robotRoot): RobotUser[] {
  const profileIds = loadModelProfiles(root).map(profile => profile.id);
  const users = validateRobotUsers(readdirSync(resolve(root,'users')).filter(name => name.endsWith('.json')).sort().map(name => JSON.parse(readFileSync(resolve(root,'users',name),'utf8'))), profileIds);
  const assets = realpathSync(resolve(root,'assets'));
  for (const user of users) for (const asset of [user.avatar.src,user.portrait.src]) {
    if (!/^\/robot-assets\/(avatars|portraits)\/[a-z0-9-]+\.png$/.test(asset)) throw new Error('INVALID_ROBOT_ASSET');
    const target = realpathSync(resolve(assets,asset.slice('/robot-assets/'.length)));
    const sub = relative(assets,target);
    if (sub.startsWith('..') || isAbsolute(sub)) throw new Error('INVALID_ROBOT_ASSET');
  }
  return users;
}
export function publicRobot(user: RobotUser): RobotPublicUser {
  const {userId,nickname,gender,avatar,portrait} = user;
  return structuredClone({userId,nickname,gender,avatar,portrait});
}
