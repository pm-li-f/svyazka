import type { Game } from '@svyazka/core';

export interface SkillCoverage {
  skill: string;
  /** Учат других (уровень 3). */
  teachers: string[];
  /** Могут сами (уровень 2 и выше), включая тех, кто учит. */
  holders: string[];
  /** Учатся (уровень 1). */
  learners: string[];
  /** Навык держит один человек. */
  single: boolean;
  /** Навык не держит никто. */
  none: boolean;
}

/** Покрытие ремесла по отряду. Считается только по слою `team`: его видит весь отряд. */
export function skillCoverage(game: Game): SkillCoverage[] {
  const skills = new Set<string>();
  for (const p of game.people) for (const s of Object.keys(p.craft)) skills.add(s);

  return [...skills].sort().map((skill) => {
    const teachers: string[] = [];
    const holders: string[] = [];
    const learners: string[] = [];
    for (const p of game.people) {
      const level = p.craft[skill]?.level;
      if (level === undefined) continue;
      if (level === 3) teachers.push(p.id);
      if (level >= 2) holders.push(p.id);
      else learners.push(p.id);
    }
    return { skill, teachers, holders, learners, single: holders.length === 1, none: holders.length === 0 };
  });
}
