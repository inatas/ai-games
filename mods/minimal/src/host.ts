import { fileURLToPath } from 'node:url';
import type { PostgresStore } from '@game-ai/storage';
import { migratePlatform } from '@game-ai/platform';
import { createActionEvents, initializeNpcActor, loadContent, moveInputSchema, migrateGameSystems, moveBinding, projectMap, RuleRegistry, NpcScheduler, type ModHost } from '@game-ai/game-systems';

export function minimalHost(store: PostgresStore): ModHost {
  const rules = new RuleRegistry().register('permit', { type: 'object', additionalProperties: false }, facts => facts.allowed === true ? null : 'LOCKED');
  const content = loadContent(fileURLToPath(new URL('../content/', import.meta.url)), rules, { move: moveInputSchema });
  const events = createActionEvents(store);
  const binding = moveBinding(store, { id: 'minimal.move', map: content.map, events,
    denial: async (_tx, _actor, exit) => rules.denial(exit, { allowed: true }),
    audience: async (tx, actor, event) => {
      if (!content.behaviors.length) return [];
      const payload = event.payload as { from: string; to: string };
      const rows = (await tx.query(`SELECT n.npc_id FROM mud_npcs n JOIN game_npc_behaviors b USING(realm_id,npc_id)
        WHERE n.realm_id=$1 AND n.status='present' AND b.enabled AND n.room_id=ANY($2::text[]) AND n.npc_id<>$3`, [actor.realmId, [payload.from, payload.to], actor.ref.kind === 'npc' ? actor.ref.npcId : ''])).rows;
      return rows.map(row => ({ consumerId: 'npc.wake', recipient: { kind: 'npc', id: row.npc_id } }));
    } });
  return {
    id: 'minimal', prefix: 'minimal', worldId: 'minimal', worldVersion: '1', worldviewPath: 'mods/minimal/WORLD.md',
    actions: ['move'], fields: ['exitId'],
    async migrate() {
      await store.transaction(async tx => {
        await migratePlatform(tx); await migrateGameSystems(tx);
        await tx.query("INSERT INTO mud_realms VALUES('minimal','minimal','1',$1,'1',0) ON CONFLICT DO NOTHING", [content.manifest.contentVersion]);
        const realm = (await tx.query("SELECT content_version FROM mud_realms WHERE id='minimal' FOR UPDATE")).rows[0];
        if (realm.content_version !== content.manifest.contentVersion) throw Error('CONTENT_VERSION_CONFLICT');
        for (const npc of content.npcs) {
          if (npc.initialRoomId === undefined) continue;
          await tx.query("INSERT INTO mud_npcs VALUES('minimal',$1,$2,'present',0) ON CONFLICT DO NOTHING", [npc.id, npc.initialRoomId]);
          await initializeNpcActor(tx, 'minimal', npc.id, ['move']);
        }
      });
    },
    async initialize(tx, scopeId) {
      await tx.query("INSERT INTO mud_characters(scope_id,realm_id,name,room_id) VALUES($1,'minimal','Explorer',$2) ON CONFLICT DO NOTHING", [scopeId, content.manifest.startRoomId]);
    },
    bindings: () => [binding],
    async startRuntime(harness) {
      if (!content.behaviors.length) return undefined;
      const scheduler = new NpcScheduler(store, harness, { realmId: 'minimal', contentVersion: content.manifest.contentVersion, bindings: { move: 'minimal.move' }, rules, facts: async () => ({ allowed: true }) });
      await scheduler.initialize(content.behaviors);
      events.registerConsumer(scheduler.consumer());
      return { async tick() { await events.tick(); await scheduler.tick(); } };
    },
    async snapshot(tx, scopeId) {
      const row = (await tx.query('SELECT room_id FROM mud_characters WHERE scope_id=$1', [scopeId])).rows[0];
      const room = content.map.rooms.find(r => r.id === row.room_id)!;
      return {
        title: 'Minimal world', characterName: 'Explorer', attributes: [], inventory: [], quests: [], training: [],
        scene: { roomId: room.id, name: room.name, templateId: room.templateId, description: room.description, objects: [] },
        map: projectMap(content.map, room.id, new Set([room.id]), exit => rules.denial(exit, { allowed: true })),
      };
    },
  };
}
