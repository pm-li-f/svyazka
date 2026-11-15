#!/usr/bin/env node
// Запуск «Связки» из исходников на любой ОС:
//   node bin/sv.mjs roster --dir examples/demo
// После `npm link` в корне репозитория та же команда доступна как `sv`.
import { register } from 'tsx/esm/api';

register();

const entry = process.argv[2] === 'web' ? '../apps/web/server/main.ts' : '../packages/cli/src/main.ts';
if (process.argv[2] === 'web') process.argv.splice(2, 1);

await import(new URL(entry, import.meta.url).href);
