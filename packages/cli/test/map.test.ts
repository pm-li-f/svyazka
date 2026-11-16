import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadGame } from '@svyazka/core';
import { makePaint, renderMap } from '../src/index.js';

const demo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../examples/demo');
const TODAY = '2026-11-13';
const squash = (s: string) => s.replace(/\s+/g, ' ');

describe('sv map', () => {
  it('без цвета: картинка знаками, 23 строки не шире 72 знаков, со значками лагерей, отряда и переходов', () => {
    const lines = renderMap(loadGame(demo), TODAY).split('\n');
    const start = lines.indexOf('') + 1;
    const picture = lines.slice(start, start + 23);
    expect(lines[start + 23]).toContain('# перевал');
    for (const line of picture) expect([...line].length).toBeLessThanOrEqual(72);
    const text = picture.join('\n');
    for (const mark of ['Б', '1', '2', '3', '▲', '◆', 'a', 'b', 'c', 'd', 'e', 'f']) expect(text).toContain(mark);
    for (const glyph of ['!', '%', '#', '^', '~']) expect(text).toContain(glyph);
    expect(text).not.toContain('\u001b');
  });

  it('маршрут, переходы, состав и трещины — текстом', () => {
    const out = squash(renderMap(loadGame(demo), TODAY));
    expect(out).toContain('карта · 2026-11-13 · цикл: переход · погода: storming');
    expect(out).toContain('2 лагерь 2 · Бета-релиз ▸ переход 4 недели, один перевал, один шторм');
    expect(out).toContain('▲ вершина · Окупаемость замысел в дымке');
    expect(out).toContain('отряд между «MVP» и «Бета-релиз», пройдено переходов: 0 из 5');
    expect(out).toContain('d шторм queue-incident день 2 ведёт Тимур · отвечает Аня');
    expect(out).toContain('f туман second-rope стоит ведёт никто · отвечает Ты никто не ведёт');
    expect(out).toContain('людей 5 → 12 к 01.11.2027, агентов 2');
    expect(out).toContain('нет ролей: исследователь ресурсов, координатор, мотиватор, душа команды, доводчик');
    expect(out).toContain('Базы данных: Держит один человек — Марк.');
    expect(out).toContain('внимание командира: за 14 дн. потрачено 6, из них на маршрут — 3');
  });

  it('с цветом: каждая клетка картинки — полублок в палитре из 256 цветов', () => {
    const lines = renderMap(loadGame(demo), TODAY, makePaint(true)).split('\n');
    const start = lines.indexOf('') + 1;
    for (const line of lines.slice(start, start + 23)) {
      const cells = line.match(/\u001b\[[0-9;]+m.\u001b\[0m/gu) ?? [];
      expect(cells).toHaveLength(72);
      expect(cells.join('')).toBe(line);
    }
  });

  it('пустая карта: один лагерь, переходов нет', () => {
    const game = loadGame(demo);
    game.map.camps = [{ id: 'beta', name: 'Бета', phase: 'current' }];
    game.tasks = [];
    const out = squash(renderMap(game, TODAY));
    expect(out).toContain('отряд у лагеря «Бета», переходов к цели пока нет');
    expect(out).toContain('открытых переходов нет');
  });
});

describe('ответ штурмана в терминале', () => {
  it('подписан: модель, ушедшие слои, что она смотрела', async () => {
    const { renderAnswer } = await import('../src/index.js');
    const out = renderAnswer({
      text: 'Первым — с Тимуром.',
      model: { name: 'kimi', provider: 'moonshotai', model: 'kimi-k3', layers: ['team'] },
      tools: ['roster', 'sheet(timur)'],
      tokens: { input: 1200, output: 80 },
    });
    expect(out.split('\n')).toEqual([
      'штурман · kimi · moonshotai/kimi-k3 · ушли слои: team',
      '',
      'Первым — с Тимуром.',
      '',
      'смотрел: roster, sheet(timur) · токены: 1200 → 80',
    ]);
  });
});
