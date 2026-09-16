export interface GameAction {
  action: string; label: string; [key: string]: string | undefined;
}
export interface SceneObject {
  id: string; name: string; kind: 'npc'|'item'|'fixture'; description: string;
  layout: {x:number;y:number}; actions: GameAction[];
}
export interface WorldView {
  scene: {roomId:string;name:string;templateId:string;description:string;objects:SceneObject[]};
  map: {regionId:string;name:string;currentRoomId:string;radius:number;
    nodes:{roomId:string;name:string;kind:string;layout:{x:number;y:number};discovery:'visited'|'frontier';isCurrent:boolean}[];
    edges:{exitId:string;from:string;to:string;direction:string;bidirectional:boolean;access:'unknown'|'locked'|'open';reason?:string}[]};
  inventory:{itemId:string;name:string;quantity:number}[];
  quests:{questId:string;name:string;status:string;description:string}[];
  attributes:{label:string;value:string|number}[];
  characterName:string;
  training:GameAction[];
  title:string;
  forms?:{action:string;label:string;fields:{id:string;label:string;value:string;options?:string[];maxLength?:number}[]}[];
}
