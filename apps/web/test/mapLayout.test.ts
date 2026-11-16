import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadGame } from '@svyazka/core';
import { mapView } from '@svyazka/engine';
import { type Anchor, type Box, placeLabels, pointBox, taskBox } from '../src/screens/mapLayout';

const demo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../examples/demo');

function boxOf(x: number, y: number, size: { width: number; height: number }, anchor: Anchor): Box {
  const gap = anchor === 'center' ? 0 : 1.3;
  const left = anchor === 'left' ? x - gap - size.width : anchor === 'right' ? x + gap : x - size.width / 2;
  const top = anchor === 'above' ? y - gap - size.height : anchor === 'below' ? y + gap : y - size.height / 2;
  return { left, top, ...size };
}
const hits = (a: Box, b: Box) =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

describe('подписи на карте', () => {
  for (const today of ['2026-11-13', '2026-12-20']) {
    it(`не пересекаются и не выходят за край (${today})`, () => {
      const view = mapView(loadGame(demo), today);
      const taskLabels = Object.fromEntries(view.tasks.map((t) => [t.id, { head: `ПЕРЕВАЛ · день 100`, lint: t.lint[0] ?? null }]));
      const pointLabels = Object.fromEntries(view.route.map((p) => [p.id, `лагерь 9 · ${p.name}`]));
      const labels = placeLabels({ view, taskLabels, pointLabels, squadLabel: 'отряд здесь' });

      const boxes: { name: string; box: Box }[] = [
        ...view.tasks.map((t) => {
          const at = labels.tasks[t.id]!;
          return { name: t.id, box: boxOf(at.x, at.y, taskBox({ id: t.id, ...taskLabels[t.id]! }), at.anchor) };
        }),
        ...view.route.map((p) => {
          const at = labels.points[p.id]!;
          return { name: p.id, box: boxOf(at.x, at.y, pointBox(pointLabels[p.id]!), at.anchor) };
        }),
        { name: 'squad', box: boxOf(labels.squad.x, labels.squad.y, pointBox('отряд здесь'), labels.squad.anchor) },
      ];
      for (const a of boxes) {
        expect(a.box.left, a.name).toBeGreaterThanOrEqual(0);
        expect(a.box.top, a.name).toBeGreaterThanOrEqual(0);
        expect(a.box.left + a.box.width, a.name).toBeLessThanOrEqual(view.cols);
        expect(a.box.top + a.box.height, a.name).toBeLessThanOrEqual(view.rows);
        for (const b of boxes) if (a.name < b.name) expect(hits(a.box, b.box), `${a.name} × ${b.name}`).toBe(false);
      }
    });
  }
});
