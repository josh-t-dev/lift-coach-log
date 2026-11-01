import { useState } from 'react';
import { useAppState } from './store';
import { ActiveWorkout } from './views/ActiveWorkout';
import { History } from './views/History';
import { Settings } from './views/Settings';
import { Today } from './views/Today';
import { Workouts } from './views/Workouts';

type Tab = 'today' | 'workout' | 'workouts' | 'history' | 'settings';

export function App() {
  const state = useAppState();
  const [tab, setTab] = useState<Tab>(state.active ? 'workout' : 'today');
  const go = (t: Tab) => {
    setTab(t);
    window.scrollTo(0, 0);
  };

  const tabs: { id: Tab; label: string; ico: string; show: boolean }[] = [
    { id: 'today', label: 'Today', ico: '◎', show: true },
    { id: 'workout', label: 'Logging', ico: '●', show: !!state.active },
    { id: 'workouts', label: 'Workouts', ico: '☰', show: true },
    { id: 'history', label: 'History', ico: '↺', show: true },
    { id: 'settings', label: 'Settings', ico: '⚙', show: true },
  ];
  const current = tab === 'workout' && !state.active ? 'today' : tab;

  return (
    <>
      <main className="app">
        <header className="topbar">
          <h1>{current === 'workout' ? 'Workout' : 'Lift Log'}</h1>
        </header>
        {current === 'today' && <Today goWorkout={() => go('workout')} goSettings={() => go('settings')} />}
        {current === 'workout' && <ActiveWorkout onDone={() => go('today')} />}
        {current === 'workouts' && <Workouts onStart={() => go('workout')} />}
        {current === 'history' && <History />}
        {current === 'settings' && <Settings />}
      </main>
      <nav className="nav" aria-label="Main">
        <div className="nav-inner">
          {tabs.filter((t) => t.show).map((t) => (
            <button key={t.id} className={current === t.id ? 'on' : ''} onClick={() => go(t.id)} aria-current={current === t.id ? 'page' : undefined}>
              <span className="ico" aria-hidden>{t.ico}</span>
              {t.label}
              {t.id === 'workout' && <span className="dot" />}
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}
