import type { Game, Layer } from '@svyazka/core';
import { daysBetween, raciLint, roster, signals, skillCoverage } from '@svyazka/engine';
import { type Cell, type Paint, days, dots, makePaint, table } from './format.js';

const TERRAIN = {
  trail: 'тропа · простой',
  pass: 'перевал · сложный',
  fog: 'туман · запутанный',
  storm: 'шторм · хаотичный',
} as const;

const STATUS = { planned: 'в плане', active: 'идёт', blocked: 'стоит', done: 'готово' } as const;
const CRAFT = { 1: 'учится', 2: 'сам', 3: 'учит' } as const;
const CRAFT_OWN = { 1: 'учусь', 2: 'делаю сам', 3: 'учу других' } as const;
const LAYER_TAG: Record<Layer, string> = { team: '[отряд]', pair: '[пара]', me: '[только ты]' };

const plain = makePaint(false);
const label = (game: Game, id: string) => game.config.labels[id] ?? id;

// ---------------------------------------------------------------- отряд

export function renderRoster(game: Game, today: string, p: Paint = plain): string {
  const head: Cell[] = ['NAME', 'ROLE', 'ТИП', 'РОЛЬ В ОТРЯДЕ', 'STATUS', 'LOAD', '1ON1', 'ЛИСТ', 'OWNS'].map((t) => ({
    t,
    c: p.dim,
  }));
  const statusPaint = { steady: p.green, loaded: p.yellow, stale: p.red, running: p.dim } as const;

  const rows: Cell[][] = roster(game, today).map((r) => {
    if (r.kind === 'agent') {
      return [
        { t: r.name, c: p.dim },
        { t: r.role, c: p.dim },
        '—',
        '—',
        { t: r.status, c: p.dim },
        '—',
        '—',
        { t: days(r.daysSinceUpdate), c: r.staleUpdate ? p.red : p.dim },
        { t: `R only · отвечает ${r.accountable}`, c: p.dim },
      ];
    }
    return [
      { t: r.id, c: p.bold },
      r.role,
      r.mbti ?? '—',
      r.belbin ?? '—',
      { t: r.status, c: statusPaint[r.status] },
      r.load === null ? { t: '?', c: p.dim } : { t: `${r.load}%`, c: r.status === 'loaded' ? p.yellow : undefined },
      { t: days(r.daysSince1on1), c: r.stale1on1 ? p.red : undefined },
      { t: days(r.daysSinceUpdate), c: r.staleUpdate ? p.red : undefined },
      r.owns.join(', ') || '—',
    ];
  });

  return [
    p.dim(`отряд · ${today}`),
    ...table([head, ...rows]),
    '',
    p.dim(
      `1on1 — дней с последней встречи. Лист — когда человек сам обновлял свой лист (у агента — последний отчёт). ` +
        `Срок годности контекста — ${game.config.ttl_days} дн.`,
    ),
  ].join('\n');
}

// ---------------------------------------------------------------- RACI

export function renderRaci(game: Game, p: Paint = plain): string {
  const actors = [
    ...[...game.people].sort((a, b) => Number(b.is_lead) - Number(a.is_lead)).map((x) => x.id),
    ...game.agents.map((a) => a.id),
  ];
  const agents = new Set(game.agents.map((a) => a.id));
  const head: Cell[] = ['ПЕРЕХОД', 'МЕСТНОСТЬ', ...actors, 'СТАТУС'].map((t) => ({ t, c: p.dim }));

  const rows: Cell[][] = game.tasks
    .filter((t) => t.status !== 'done')
    .map((t) => {
      const cells: Cell[] = actors.map((id) => {
        const letters = [
          t.raci.R.includes(id) ? 'R' : '',
          t.raci.A === id ? 'A' : '',
          t.raci.C.includes(id) ? 'C' : '',
          t.raci.I.includes(id) ? 'I' : '',
        ].filter(Boolean);
        if (!letters.length) return { t: '·', c: p.dim };
        const bad = t.raci.A === id && agents.has(id);
        return { t: letters.join(' '), c: bad ? p.yellow : letters.includes('A') ? p.bold : undefined };
      });
      const status = t.note ? `${STATUS[t.status]} · ${t.note}` : STATUS[t.status];
      return [{ t: t.id, c: p.bold }, TERRAIN[t.terrain], ...cells, { t: status, c: t.status === 'blocked' ? p.red : undefined }];
    });

  const lint = raciLint(game).map((f) => {
    switch (f.code) {
      case 'no-responsible':
        return p.red('✗') + ` ${f.task}: никто не ведёт`;
      case 'no-accountable':
        return p.yellow('✗') + ` ${f.task}: нет ответственного`;
      case 'agent-accountable':
        return p.yellow('✗') + ` ${f.task}: отвечает агент (${f.actor})`;
      case 'accountable-overload':
        return p.yellow('!') + ` ${f.actor} отвечает сразу в ${f.tasks.length} переходах`;
    }
  });

  return [
    p.dim('RACI · R ведёт, A отвечает, C на связи, I в лагере знает'),
    ...table([head, ...rows]),
    '',
    ...(lint.length ? lint : [p.green('✓') + ' нарушений нет']),
  ].join('\n');
}

// ---------------------------------------------------------------- навыки

export function renderSkills(game: Game, p: Paint = plain): string {
  const people = [...game.people].sort((a, b) => Number(b.is_lead) - Number(a.is_lead));
  const head: Cell[] = ['РЕМЕСЛО', ...people.map((x) => x.id), 'МОГУТ САМИ'].map((t) => ({ t, c: p.dim }));

  const coverage = skillCoverage(game).sort(
    (a, b) => a.holders.length - b.holders.length || label(game, a.skill).localeCompare(label(game, b.skill), 'ru'),
  );
  const rows: Cell[][] = coverage.map((c) => {
    const cells: Cell[] = people.map((person) => {
      const level = person.craft[c.skill]?.level;
      if (level === undefined) return { t: '·', c: p.dim };
      return { t: CRAFT[level], c: level === 3 ? p.bold : level === 1 ? p.dim : undefined };
    });
    const cover: Cell = c.none
      ? { t: '0 · не держит никто', c: p.red }
      : c.single
        ? { t: '1 · держит один', c: p.red }
        : String(c.holders.length);
    return [label(game, c.skill), ...cells, cover];
  });

  return [
    p.dim('ремесло · видит отряд'),
    ...table([head, ...rows]),
    '',
    p.dim('Три ступени: учится, делает сам, учит других. Шкала отвечает на вопрос «к кому идти», а не «кто лучше».'),
  ].join('\n');
}

// ---------------------------------------------------------------- лист

const ORDER: Layer[] = ['team', 'pair', 'me'];

/**
 * Лист человека. `upTo` — самый закрытый слой, который показываем:
 * team — как видит отряд, pair — как видят человек и CPTO, me — всё, включая заметки CPTO.
 */
export function renderSheet(game: Game, id: string, today: string, upTo: Layer = 'me', p: Paint = plain): string {
  const person = game.people.find((x) => x.id === id);
  if (!person) throw new Error(`человек «${id}» не найден`);
  const visible = (layer: Layer) => ORDER.indexOf(layer) <= ORDER.indexOf(upTo);
  const sheet = game.sheets[id];
  const out: string[] = [];
  const block = (layer: Layer, title: string, lines: string[]) => {
    if (!visible(layer) || !lines.length) return;
    out.push('', `${p.dim(LAYER_TAG[layer])} ${p.bold(title)}`, ...lines.map((l) => `  ${l}`));
  };
  const ago = (date: string) => `${daysBetween(date, today)} дн. назад`;

  out.push(`${p.bold(`лист · ${person.id} · ${person.name}`)}  ${p.dim(`показаны слои до: ${LAYER_TAG[upTo]}`)}`);

  block(
    'team',
    'кто',
    table(
      [
        ['роль', person.role],
        ...(person.joined ? [['в отряде с', person.joined]] : []),
        ...(person.mbti ? [['тип (MBTI)', person.mbti]] : []),
        ...(person.belbin
          ? [['роль (Белбин)', person.belbin + (person.belbin_shadow ? ` · тень: ${person.belbin_shadow}` : '')]]
          : []),
        ...(person.owns.length ? [['владеет', person.owns.join(', ')]] : []),
      ],
      3,
    ),
  );

  block(
    'team',
    'ремесло · согласованный уровень',
    table(
      Object.entries(person.craft)
        .sort((a, b) => b[1].level - a[1].level || a[0].localeCompare(b[0]))
        .map(([skill, v]) => [label(game, skill), CRAFT_OWN[v.level], '▮'.repeat(v.level) + '▯'.repeat(3 - v.level)]),
      3,
    ),
  );

  block(
    'team',
    'в переходах',
    table(
      game.tasks
        .filter((t) => t.status !== 'done')
        .flatMap((t) => {
          const roles = [
            t.raci.R.includes(id) ? 'R' : '',
            t.raci.A === id ? 'A' : '',
            t.raci.C.includes(id) ? 'C' : '',
            t.raci.I.includes(id) ? 'I' : '',
          ].filter(Boolean);
          return roles.length ? [[`${t.id} · ${TERRAIN[t.terrain]}`, roles.join(' ')]] : [];
        }),
      3,
    ),
  );

  if (sheet?.state) {
    const s = sheet.state;
    block('pair', 'состояние · заполняет сам человек', [
      `запас сил ${dots(s.energy, 5)}   нагрузка ${s.load}%   обновлено ${ago(s.at)}`,
      ...(s.note ? [`«${s.note}»`] : []),
    ]);
  }

  block('pair', 'что движет', [
    ...(sheet?.drives.length ? [sheet.drives.join(' · ')] : []),
    ...(sheet?.dampers.length ? [p.dim(`что гасит: ${sheet.dampers.join(' · ')}`)] : []),
  ]);

  const thinking = Object.entries(sheet?.thinking ?? {});
  block(
    'pair',
    'мышление и люди',
    thinking.length
      ? table(
          [
            [{ t: '', c: p.dim }, { t: 'сам', c: p.dim }, { t: 'ты', c: p.dim }, ''],
            ...thinking.map(([k, v]): Cell[] => [
              label(game, k),
              dots(v.self, 5),
              dots(v.lead, 5),
              Math.abs(v.self - v.lead) >= 2 ? { t: '← разрыв: тема для 1on1', c: p.yellow } : '',
            ]),
          ],
          3,
        )
      : [],
  );

  if (sheet?.quest) {
    const q = sheet.quest;
    block('pair', 'личный квест', [q.text, '☑'.repeat(q.done) + '☐'.repeat(Math.max(0, q.steps - q.done))]);
  }

  block(
    'pair',
    'журнал встреч',
    (game.journals[id]?.entries ?? []).map((e) => `${p.dim(`${e.at} · ${e.kind}`)}  ${e.text}`),
  );

  if (sheet?.review360) {
    block('pair', `360 · темы, без баллов · ${sheet.review360.at}`, sheet.review360.themes.map((t) => `«${t}»`));
  }

  const priv = game.privates[id];
  block(
    'me',
    'связи',
    table(
      (priv?.bonds ?? []).map((b) => [
        b.with,
        { t: dots(b.strength, 3), c: b.strength === 1 ? p.red : undefined },
        b.note ?? '',
      ]),
      3,
    ),
  );
  block(
    'me',
    'заметки на полях',
    (priv?.margin ?? []).map((m) => `${p.dim(m.at)}  ${p.yellow(m.text)}`),
  );

  return out.join('\n');
}

// ---------------------------------------------------------------- сигналы

export function renderSignals(game: Game, today: string, p: Paint = plain): string {
  const list = signals(game, today);
  const sev = { crit: p.red, warn: p.yellow, lint: p.yellow, info: p.blue } as const;
  const rows: Cell[][] = list.map((s) => [{ t: s.severity.toUpperCase(), c: sev[s.severity] }, { t: s.code, c: p.dim }, s.text]);
  return [p.dim(`сигналы · ${today} · ${list.length}`), ...table(rows)].join('\n');
}
