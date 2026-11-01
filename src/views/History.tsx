import { useState } from 'react';
import { exerciseName } from '../data/exercises';
import { sessionVolume, workingSetCount } from '../lib/analytics';
import { templateFromSession, update, useAppState } from '../store';

export function History() {
  const state = useAppState();
  const [open, setOpen] = useState<string | null>(null);
  const sessions = [...state.sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  if (!sessions.length) return <div className="card muted">No workouts yet. Finished workouts show up here.</div>;

  return (
    <div className="stack">
      <h2>History</h2>
      {sessions.map((s) => {
        const d = new Date(s.startedAt);
        const mins = s.finishedAt ? Math.round((new Date(s.finishedAt).getTime() - d.getTime()) / 60000) : null;
        const isOpen = open === s.id;
        return (
          <div className="card" key={s.id}>
            <button className="row spread" style={{ width: '100%', background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' }} onClick={() => setOpen(isOpen ? null : s.id)} aria-expanded={isOpen}>
              <div>
                <h3 style={{ margin: 0 }}>{s.name}</h3>
                <div className="small muted">
                  {d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                  {mins != null ? ` · ${mins} min` : ''} · {workingSetCount(s)} sets · {Math.round(sessionVolume(s)).toLocaleString()} {state.unit}
                </div>
              </div>
              <span className="muted">{isOpen ? '▾' : '▸'}</span>
            </button>
            {isOpen && (
              <>
                <ul className="list" style={{ marginTop: 8 }}>
                  {s.exercises.map((e) => (
                    <li key={e.id}>
                      <div style={{ fontWeight: 500 }}>{exerciseName(e.exerciseId, state.customExercises)}</div>
                      <div className="small muted">
                        {e.sets.map((x) => `${x.weight ?? 0}×${x.reps ?? 0}${x.rir != null ? ` @${x.rir}` : ''}`).join(', ')}
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="row" style={{ marginTop: 8 }}>
                  <button
                    className="btn small"
                    onClick={() => {
                      update((d) => void d.templates.push(templateFromSession(s)));
                      alert(`Saved "${s.name}" to your workouts.`);
                    }}
                  >
                    Save as workout
                  </button>
                  <button
                    className="btn small ghost danger"
                    onClick={() => confirm('Delete this workout from history?') && update((d) => void (d.sessions = d.sessions.filter((x) => x.id !== s.id)))}
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
