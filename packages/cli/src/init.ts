import { createInterface } from 'node:readline';
import { Id } from '@svyazka/core';
import { initGame, InitError, type InitOptions, type InitPerson } from '@svyazka/ops';

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** Идентификатор из имени: «Аня» → anya. */
export function suggestId(name: string): string {
  const s = [...name.trim().toLowerCase()]
    .map((c) => TRANSLIT[c] ?? c)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'person';
}

/** Разбирает `id:Имя:роль` или `Имя:роль` из флага --person. */
export function parsePerson(spec: string): InitPerson {
  const parts = spec.split(':').map((s) => s.trim());
  const first = parts[0] ?? '';
  if (parts.length >= 3 || Id.safeParse(first).success) {
    return { id: first, name: parts[1] || first, role: parts.slice(2).join(':') };
  }
  return { id: suggestId(first), name: first, role: parts.slice(1).join(':') };
}

/** Вопросы в терминале. Пустой ответ — значение по умолчанию. */
export async function askInit(base: InitOptions): Promise<InitOptions> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Читаем построчно, а не через question: так не теряются строки, вставленные разом.
  const lines = rl[Symbol.asyncIterator]();
  let closed = false;
  const ask = async (q: string, def = '') => {
    rl.setPrompt(def ? `${q} [${def}] ` : `${q} `);
    rl.prompt();
    const next = await lines.next();
    if (next.done) closed = true;
    return (next.done ? '' : next.value.trim()) || def;
  };
  try {
    console.log('Создаём папку игры. Пустой ответ — значение в скобках.\n');
    const leadName = await ask('Как тебя зовут?', base.lead.name);
    const leadRole = await ask('Твоя роль?', base.lead.role);
    const camp = await ask('Ближайшая веха, к которой идёт команда?', base.camp);

    console.log('\nТеперь люди в команде. Чтобы закончить, оставь имя пустым.');
    const people: InitPerson[] = [...base.people];
    const taken = new Set([base.lead.id, ...people.map((p) => p.id)]);
    for (;;) {
      const name = await ask(`Имя ${people.length + 1}-го человека:`);
      if (!name) break;
      let id = await ask('  короткий идентификатор латиницей', suggestId(name));
      while (!Id.safeParse(id).success || taken.has(id)) {
        if (closed) throw new InitError('Ввод прерван, папка не создана.');
        id = await ask(taken.has(id) ? '  такой уже есть, другой:' : '  только латиница, цифры и дефис:');
      }
      const role = await ask('  роль', 'участник');
      taken.add(id);
      people.push({ id, name, role });
    }
    return { ...base, lead: { ...base.lead, name: leadName, role: leadRole }, people, camp };
  } finally {
    rl.close();
  }
}

export function runInit(dir: string, opts: InitOptions): string {
  const { created, git } = initGame(dir, opts);
  const people = [opts.lead, ...opts.people].map((p) => p.id).join(', ');
  return [
    `Папка игры создана: ${dir}`,
    `файлов: ${created.length} · в отряде: ${people}`,
    ...(git ? [git] : []),
    '',
    'Что дальше:',
    `  1. Заполни людей и переходы — подсказки в ${dir}/README.md`,
    `  2. Посмотри отряд:   sv roster --dir "${dir}"`,
    `  3. Начни первый ход: sv turn start --dir "${dir}"`,
    '',
    'Чтобы не писать --dir каждый раз, запиши путь в переменную SVYAZKA_DIR.',
  ].join('\n');
}
