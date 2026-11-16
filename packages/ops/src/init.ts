import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';
import { Id, loadGame } from '@svyazka/core';

export interface InitPerson {
  id: string;
  name: string;
  role: string;
}

export interface InitOptions {
  today: string;
  lead: InitPerson;
  people: InitPerson[];
  /** Название ближайшей вехи — лагеря, к которому идёт отряд. */
  camp: string;
  git: boolean;
}

/** Ошибка создания папки с текстом для человека. */
export class InitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InitError';
  }
}

const CONFIG = `# Настройки игры. Числа — прикидки: поиграй пару недель и подкрути.
ttl_days: 14              # срок годности контекста о человеке, в днях
attention:
  cap: 10                 # потолок дневного бюджета внимания
  over_usual: 2           # не выше обычного плюс столько
  window_days: 14         # за сколько дней считается «обычное»
  cap_streak: 3           # столько ходов подряд на потолке — сигнал на тебя самого
action_costs:             # сколько внимания стоит действие, от 1 до 3
  read-sheet: 1
  resolve-signal: 1
  one-on-one: 2
  route-block: 3
raci:
  accountable_max: 2      # за сколько активных переходов можно отвечать одновременно
signals:
  load_crit: 85           # нагрузка, с которой единственный держатель навыка — критический сигнал
labels:                   # подписи для людей: идентификатор → как показывать
  read-sheet: прочитать лист
  resolve-signal: разобрать сигнал
  one-on-one: провести 1on1
  route-block: поработать над маршрутом
navigator:
  provider: anthropic     # anthropic | moonshotai | alibaba
  model: claude-sonnet-5-5
  cloud_layers: [team, pair, me]   # какие слои можно отправлять облачной модели
`;

const README = `# Папка игры «Связка»

Это состояние игры: обычные текстовые файлы. Их можно править руками, в том числе в Obsidian.
Данные лежат в шапке файла между строками \`---\`; ниже шапки можно писать свободные заметки.

## Что где

\`\`\`
team/                 видит отряд
  people/<id>.md      кто, роль, тип, ремесло
  agents/<id>.md      агент, кто за него отвечает, его отчёты
  tasks/<id>.md       переход: местность, статус, RACI
  map.yaml            лагеря по порядку маршрута, этап цикла, погода
pair/<id>/            человек и ты
  sheet.md            состояние, оценки, квест, темы 360
  journal.md          встречи
me/<id>.md            только ты: связи, заметки на полях
turns/<дата>.md       ходы: внимание, действия, решения
config.yaml           настройки и подписи
\`\`\`

## Что заполнить дальше

1. **Люди.** В \`team/people/<id>.md\` добавь тип, роль по Белбину и ремесло:

   \`\`\`yaml
   mbti: ISTP
   belbin: специалист
   owns: [billing-db]
   craft:
     databases: {level: 3, agreed: 2026-11-07}   # 1 учусь, 2 делаю сам, 3 учу других
   \`\`\`

   Подпись для навыка добавь в \`config.yaml\`, в раздел \`labels\`: \`databases: Базы данных\`.

2. **Переходы.** Создай \`team/tasks/<id>.md\`:

   \`\`\`yaml
   ---
   id: billing-migration
   title: Миграция биллинга
   terrain: pass          # trail тропа, pass перевал, fog туман, storm шторм
   status: active         # planned, active, blocked, done
   camp: camp-1           # к какому лагерю из team/map.yaml ведёт
   since: 2026-11-07      # когда начали: от этого растёт пятно на карте
   raci:
     R: [mark]            # ведёт
     A: anya              # отвечает: один, и это человек
     C: []                # на связи
     I: []                # в лагере знает
   ---
   \`\`\`

3. **Листы.** В \`pair/<id>/sheet.md\` — состояние человека и то, что его движет. Состояние заполняет он сам.

4. **Карта.** В \`team/map.yaml\` допиши лагеря по порядку маршрута, вершину и план состава:

   \`\`\`yaml
   vision: Продукт, который окупает себя
   camps:
     - {id: base, name: База, phase: done}
     - {id: camp-1, name: Бета-релиз, phase: current}
     - {id: camp-2, name: Первые платящие, phase: planned}
     - {id: summit, name: Окупаемость, phase: idea}   # последний лагерь с phase: idea — вершина
   headcount: {target: 12, by: 2027-11-01}            # сколько людей нужно и к какой дате
   \`\`\`

   Карту никто не рисует: \`sv map\` и экран «карта» собирают её из этих файлов.

После правок проверь папку: \`sv roster\`. Если что-то не так, команда назовёт файл и поле.
`;

function write(root: string, path: string, content: string, created: string[]): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  created.push(path);
}

const front = (data: unknown) => `---\n${stringify(data, { lineWidth: 0 })}---\n`;

/** Создаёт новую папку игры и проверяет, что она читается. */
export function initGame(dir: string, opts: InitOptions): { created: string[]; git: string | null } {
  if (existsSync(dir) && readdirSync(dir).some((f) => f !== '.git')) {
    throw new InitError(`Папка ${dir} не пуста. Выбери другое место, чтобы ничего не затереть.`);
  }
  const everyone = [opts.lead, ...opts.people];
  for (const p of everyone) {
    if (!Id.safeParse(p.id).success) {
      throw new InitError(`Идентификатор «${p.id}» не подходит: нужны латинские буквы в нижнем регистре, цифры и дефис.`);
    }
    if (!p.name.trim()) throw new InitError(`У «${p.id}» не указано имя.`);
  }
  const ids = everyone.map((p) => p.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new InitError(`Идентификатор «${dup}» указан дважды.`);

  const created: string[] = [];
  write(dir, 'config.yaml', CONFIG, created);
  write(dir, 'README.md', README, created);
  write(
    dir,
    'team/map.yaml',
    stringify(
      {
        cycle: 'planning',
        target: 'camp-1',
        weather: { stage: 'forming', note: 'Отряд только собирается', at: opts.today },
        camps: [
          { id: 'base', name: 'База', phase: 'done' },
          { id: 'camp-1', name: opts.camp.trim() || 'Первый лагерь', phase: 'current' },
        ],
      },
      { lineWidth: 0 },
    ),
    created,
  );
  for (const p of everyone) {
    const isLead = p === opts.lead;
    write(
      dir,
      `team/people/${p.id}.md`,
      front({ id: p.id, name: p.name.trim(), role: p.role.trim() || (isLead ? 'cpto' : 'участник'), is_lead: isLead, joined: opts.today }),
      created,
    );
    write(dir, `pair/${p.id}/sheet.md`, front({ person: p.id }), created);
  }

  // Папка должна читаться сразу: если нет — это ошибка в нас, а не в ответах человека.
  loadGame(dir);

  let git: string | null = null;
  if (opts.git) {
    try {
      const run = (args: string[]) => execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
      if (!existsSync(join(dir, '.git'))) run(['init', '-q']);
      run(['add', '-A']);
      run(['commit', '-q', '-m', 'начало экспедиции']);
      git = 'Репозиторий создан, первый коммит сделан.';
    } catch (e) {
      const reason = String((e as { stderr?: Buffer }).stderr ?? (e as Error).message).trim().split('\n')[0];
      git = `Папка создана, но git не сработал: ${reason}`;
    }
  }
  return { created, git };
}
