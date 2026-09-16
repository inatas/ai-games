/** Qingxi owns skill names and learning rules. The MUD packages stay topic neutral. */
export const schools = {
  qingsong: {
    name: '青松门', master: '青松道人', roomId: 'dojo',
    basic: 'breathing', basicName: '吐纳法', advanced: 'qingsong_sword', advancedName: '青松剑式',
  },
  baicao: {
    name: '百草门', master: '药师', roomId: 'herbalist',
    basic: 'herbal_breath', basicName: '采息术', advanced: 'acupoint_hand', advancedName: '点穴手',
  },
} as const;

type SchoolId = keyof typeof schools;
const skillSchool: Record<string, SchoolId> = {
  breathing: 'qingsong', qingsong_sword: 'qingsong',
  herbal_breath: 'baicao', acupoint_hand: 'baicao',
};

export function trainingDenial(
  character: { school_id: string | null; potential: number },
  skills: { skill_id: string; level: number }[],
  skillId: string,
): { code: string; reason: string } | null {
  const schoolId = skillSchool[skillId];
  if (!schoolId || character.school_id !== schoolId) {
    return { code: 'INVALID_SKILL', reason: '只能修习本门武学' };
  }

  const school = schools[schoolId];
  const level = (id: string) => Number(skills.find(skill => skill.skill_id === id)?.level ?? 0);
  if (level(skillId) >= 3) return { code: 'SKILL_MAXED', reason: '已达3级上限' };
  if (skillId === school.advanced && level(school.basic) < 2) {
    return { code: 'SKILL_PREREQUISITE', reason: `先将${school.basicName}练至2级` };
  }
  if (Number(character.potential) < 2) {
    return { code: 'INSUFFICIENT_POTENTIAL', reason: '潜能不足：需要2点' };
  }
  return null;
}
