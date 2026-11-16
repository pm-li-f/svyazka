import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, type GameSettings } from '@svyazka/engine/src/events';

/**
 * Настройки игрового слоя: заставки, эффекты, звук. У каждого игрока свои,
 * поэтому хранятся в браузере, а не в папке игры.
 */
const KEY = 'svyazka.game';

function read(): GameSettings {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as Partial<GameSettings>;
    return {
      splash: raw.splash === 'all' || raw.splash === 'rare' || raw.splash === 'off' ? raw.splash : DEFAULT_SETTINGS.splash,
      effects: raw.effects === 'full' || raw.effects === 'calm' || raw.effects === 'off' ? raw.effects : DEFAULT_SETTINGS.effects,
      sound: raw.sound === true,
    };
  } catch {
    // Хранилище недоступно или запись испорчена: играем с настройками по умолчанию.
    return DEFAULT_SETTINGS;
  }
}

export function useSettings(): [GameSettings, (patch: Partial<GameSettings>) => void] {
  const [settings, setSettings] = useState<GameSettings>(read);
  const update = useCallback((patch: Partial<GameSettings>) => {
    setSettings((old) => {
      const next = { ...old, ...patch };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Не сохранилось — настройка проживёт до закрытия вкладки.
      }
      return next;
    });
  }, []);
  return [settings, update];
}

/** Системная настройка «уменьшить движение». */
export function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setReduced(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return reduced;
}
