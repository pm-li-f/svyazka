import type { EffectEvent, GameEvent, GameSettings, SplashEvent } from '@svyazka/engine/src/events';
import type { StateView } from '../api';
import { Panel } from '../ui';

interface Props {
  state: StateView;
  settings: GameSettings;
  update: (patch: Partial<GameSettings>) => void;
  reduced: boolean;
  /** Показать заставку или эффект сейчас, как бы ни стояли настройки. */
  preview: (event: GameEvent) => void;
}

function Choice<T extends string>({ label, hint, value, options, onPick }: { label: string; hint: string; value: T; options: [T, string][]; onPick: (v: T) => void }) {
  return (
    <div className="setting">
      <div>
        <b>{label}</b>
        <p className="hint">{hint}</p>
      </div>
      <div className="view-as" role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={v} type="button" className={`btn seg ${v === value ? 'on' : ''}`} aria-pressed={v === value} onClick={() => onPick(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Settings({ state, settings, update, reduced, preview }: Props) {
  const storms = Object.values(state.facts.storms);
  const target = state.targetCamp ?? 'лагерь';
  const someone = state.roster.find((r) => r.kind === 'person' && !r.isLead);
  const splashes: [string, string, SplashEvent][] = [
    ['начало хода', 'каждый день · 1–2 с', { kind: 'turn-start', date: state.today, budget: state.turn?.attention.budget ?? state.budget.usual ?? 6 }],
    ['конец хода', 'каждый день · 1–2 с', { kind: 'turn-end', date: state.today, untouched: state.signals.length }],
    ['шторм', 'редко · 3–4 с', { kind: 'storm', id: 'preview', title: storms[0] ?? 'Переход, где сначала действуют' }],
    ['новый участник', 'редко · 3–4 с', { kind: 'new-member', id: 'preview', name: someone?.name ?? 'Новый участник' }],
    ['лагерь взят', 'очень редко · 5–8 с', { kind: 'camp-taken', id: 'preview', name: target }],
  ];
  const effects: [string, EffectEvent][] = [
    ['снят сигнал', { kind: 'signal-cleared', code: 'stale-context', target: someone?.id ?? 'x', subject: someone?.name ?? 'Человек' }],
    ['назначен дублёр', { kind: 'backup-assigned', skill: state.skills.rows[0]?.label ?? 'Навык' }],
    ['линтер зелёный', { kind: 'lint-green' }],
    ['шаг квеста', { kind: 'quest-step', id: someone?.id ?? 'x', name: someone?.name ?? 'Человек', done: 2, steps: 3 }],
    ['лист обновлён', { kind: 'sheet-updated', id: someone?.id ?? 'x', name: someone?.name ?? 'Человек' }],
  ];

  return (
    <div className="split">
      <Panel title="игра · заставки и эффекты" className="grow" block="settings">
        <div className="pad stack-lg">
          <Choice
            label="Заставки"
            hint="Пиксельный кадр из текущего состояния: рельеф карты, погода, время суток, состав отряда. «Только редкие» — шторм, новый участник и взятый лагерь, без ежедневных."
            value={settings.splash}
            options={[
              ['all', 'все'],
              ['rare', 'только редкие'],
              ['off', 'выключены'],
            ]}
            onPick={(splash) => update({ splash })}
          />
          <Choice
            label="Эффекты"
            hint="Короткая отметка, когда что-то действительно закрылось. «Полные» — с искрами, «сдержанные» — одной строкой."
            value={settings.effects}
            options={[
              ['full', 'полные'],
              ['calm', 'сдержанные'],
              ['off', 'выключены'],
            ]}
            onPick={(effects) => update({ effects })}
          />
          <Choice
            label="Звук"
            hint="Короткие сигналы к заставкам и эффектам. Включается отдельно от них."
            value={settings.sound ? 'on' : 'off'}
            options={[
              ['on', 'включён'],
              ['off', 'выключен'],
            ]}
            onPick={(v) => update({ sound: v === 'on' })}
          />
          <p className="hint">
            Настройки у каждого игрока свои: они хранятся в этом браузере и в папку игры не пишутся. Выключишь всё — игра останется той же,
            только без заставок и эффектов.
          </p>
          {reduced && (
            <p className="prose amber" role="note">
              В системе включено «уменьшить движение»: заставка показывается одним неподвижным кадром, эффекты — без искр и сдвигов.
            </p>
          )}
          {storms.length > 0 && (
            <p className="prose coral" role="note">
              Сейчас на карте шторм ({storms.join(', ')}): эффекты молчат, пока он не закончится. Кнопки ниже покажут их для примера.
            </p>
          )}
        </div>

        <h3 className="sub">посмотреть заставку</h3>
        <div className="pad previews" data-block="settings-splashes">
          {splashes.map(([name, when, event]) => (
            <button key={name} type="button" className="btn preview" onClick={() => preview(event)}>
              <b>{name}</b>
              <span className="muted">{when}</span>
            </button>
          ))}
        </div>

        <h3 className="sub">посмотреть эффект</h3>
        <div className="pad previews" data-block="settings-effects">
          {effects.map(([name, event]) => (
            <button key={name} type="button" className="btn preview" onClick={() => preview(event)}>
              <b>{name}</b>
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="когда их не бывает" className="side" block="settings-rules">
        <ul className="rows">
          <li>
            <b>Не за трату внимания</b>
            <p className="prose muted">Потраченные очки и число проведённых 1on1 ничем не отмечаются.</p>
          </li>
          <li>
            <b>Не на оценках людей</b>
            <p className="prose muted">Ремесло, мышление, состояние и нагрузка меняются молча.</p>
          </li>
          <li>
            <b className="coral">Не в шторм</b>
            <p className="prose muted">Пока открыт переход-шторм, эффектов нет. Заставка о начале шторма остаётся.</p>
          </li>
          <li>
            <b>Без серий и сравнений</b>
            <p className="prose muted">Нет «десять дней подряд» и нет «лучше, чем у других».</p>
          </li>
          <li>
            <b className="green">Только настоящее</b>
            <p className="prose muted">Эффект бывает, когда снят сигнал, назначен дублёр, линтер RACI зелёный, сделан шаг квеста или человек обновил свой лист.</p>
          </li>
        </ul>
      </Panel>
    </div>
  );
}
