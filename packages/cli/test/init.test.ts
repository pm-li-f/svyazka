import { describe, expect, it } from 'vitest';
import { parsePerson, suggestId } from '../src/init.js';

describe('подсказки для sv init', () => {
  it('предлагает идентификатор из имени', () => {
    expect(suggestId('Аня')).toBe('anya');
    expect(suggestId('Тимур Шамсутдинов')).toBe('timur-shamsutdinov');
    expect(suggestId('Юля')).toBe('yulya');
    expect(suggestId('Mark')).toBe('mark');
    expect(suggestId('  ')).toBe('person');
  });

  it('разбирает флаг --person', () => {
    expect(parsePerson('anya:Аня:tech-lead')).toEqual({ id: 'anya', name: 'Аня', role: 'tech-lead' });
    expect(parsePerson('Аня:tech-lead')).toEqual({ id: 'anya', name: 'Аня', role: 'tech-lead' });
    expect(parsePerson('Марк')).toEqual({ id: 'mark', name: 'Марк', role: '' });
    expect(parsePerson('mark')).toEqual({ id: 'mark', name: 'mark', role: '' });
  });
});
