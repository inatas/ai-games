/** Deprecated MUD composition. New code imports platform or game-systems. */
export * from '@game-ai/game-systems';
export { lockRealm, heartbeat } from '@game-ai/platform';
import * as base from '@game-ai/platform';
import { mudSocialPolicy } from '@game-ai/game-systems';
export const socialProjection = (...args: Parameters<typeof base.socialProjection>) => base.socialProjection(args[0],args[1],args[2] ?? mudSocialPolicy);
export const sendMessage = (...args: Parameters<typeof base.sendMessage>) => base.sendMessage(args[0],args[1],args[2],args[3] ?? mudSocialPolicy);
export const mutateParty = (...args: Parameters<typeof base.mutateParty>) => base.mutateParty(args[0],args[1],args[2],args[3] ?? mudSocialPolicy);
export const leaveParty = (...args: Parameters<typeof base.leaveParty>) => base.leaveParty(args[0],args[1],args[2] ?? mudSocialPolicy);
export const retireCharacter = (...args: Parameters<typeof base.retireCharacter>) => base.retireCharacter(args[0],args[1],args[2] ?? mudSocialPolicy);
