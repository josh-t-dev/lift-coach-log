import { useMemo, useState } from 'react';
import { allExercises } from '../data/exercises';
import { update, uid, useAppState } from '../store';
import { EQUIPMENT, METRIC_LABEL, MUSCLES, type Equipment, type Exercise, type Metric, type Muscle } from '../types';

export function ExercisePicker({ onPick, onClose }: { onPick: (ex: Exercise, metric: Metric) => void; onClose: () => void }) {
  const state = useAppState();
  const [q, setQ] = useState('');
  const [muscle, setMuscle] = useState<Muscle | null>(null);
  const [creating, setCreating] = useState(false);
  const [chosen, setChosen] = useState<Exercise | null>(null);
  const [kind, setKind] = useState<'all' | 'strength' | 'cardio'>('all');

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return allExercises(state.customExercises)
      .filter((e) => kind === 'all' || (kind === 'cardio' ? e.metric === 'time_distance' : e.metric === 'weight_reps'))
      .filter((e) => !muscle || e.primary.includes(muscle))
      .filter((e) => !needle || e.name.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [q, muscle, kind, state.customExercises]);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Add exercise">
        <div className="row spread" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Add exercise</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {chosen ? (
          <div className="stack">
            <p>How do you want to track <b>{chosen.name}</b>?</p>
            {(['weight_reps', 'time_distance'] as Metric[])
              .sort((a) => (a === chosen.metric ? -1 : 1))
              .map((m) => (
                <button key={m} className={`btn block ${m === chosen.metric ? 'primary' : ''}`} onClick={() => onPick(chosen, m)}>
                  {METRIC_LABEL[m]}{m === chosen.metric ? ' (usual)' : ''}
                  <div className="small" style={{ fontWeight: 400, opacity: 0.85 }}>
                    {m === 'weight_reps' ? 'Log weight, reps and effort per set' : 'Log minutes and distance'}
                  </div>
                </button>
              ))}
            <button className="btn ghost" onClick={() => setChosen(null)}>← Back</button>
          </div>
        ) : creating ? (
          <CustomExerciseForm
            initialName={q}
            onCancel={() => setCreating(false)}
            onCreate={(ex) => {
              update((d) => void d.customExercises.push(ex));
              onPick(ex, ex.metric);
            }}
          />
        ) : (
          <>
            <input type="search" placeholder="Search exercises" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            <div className="segmented" style={{ marginTop: 10 }} role="group" aria-label="Type">
              {(['all', 'strength', 'cardio'] as const).map((k) => (
                <button key={k} className={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>
                  {k === 'all' ? 'All' : k === 'strength' ? 'Weight & reps' : 'Time & distance'}
                </button>
              ))}
            </div>
            <div className="chips" style={{ margin: '10px 0' }}>
              {MUSCLES.map((m) => (
                <button key={m} className={`chip ${muscle === m ? 'on' : ''}`} onClick={() => setMuscle(muscle === m ? null : m)}>
                  {m}
                </button>
              ))}
            </div>
            <div>
              {list.map((e) => (
                <button key={e.id} className="picker-item" onClick={() => setChosen(e)}>
                  <span>{e.name}</span>
                  <span className="tag">{e.metric === 'time_distance' ? 'time & distance' : e.primary.join(', ')}</span>
                </button>
              ))}
              {!list.length && <p className="muted small" style={{ padding: '10px 0' }}>No match.</p>}
            </div>
            <button className="btn block" style={{ marginTop: 12 }} onClick={() => setCreating(true)}>
              + Create custom exercise{q.trim() ? ` "${q.trim()}"` : ''}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function CustomExerciseForm({ initialName, onCreate, onCancel }: { initialName: string; onCreate: (e: Exercise) => void; onCancel: () => void }) {
  const [name, setName] = useState(initialName);
  const [primary, setPrimary] = useState<Muscle[]>([]);
  const [equipment, setEquipment] = useState<Equipment>('dumbbell');
  const [compound, setCompound] = useState(false);
  const [metric, setMetric] = useState<Metric | null>(null);
  const lower = primary.some((m) => ['quads', 'hamstrings', 'glutes', 'calves'].includes(m));

  return (
    <div className="stack">
      <label className="field">
        <span>Name</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <div>
        <span className="muted small">How do you track it?</span>
        <div className="segmented" style={{ marginTop: 4, display: 'flex' }} role="group" aria-label="How do you track it?">
          {(['weight_reps', 'time_distance'] as Metric[]).map((m) => (
            <button key={m} className={metric === m ? 'on' : ''} aria-pressed={metric === m} style={{ flex: 1 }} onClick={() => setMetric(m)}>
              {METRIC_LABEL[m]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <span className="muted small">Main muscles worked (used for weekly volume{metric === 'time_distance' ? '; leave empty for cardio' : ''})</span>
        <div className="chips" style={{ marginTop: 4 }}>
          {MUSCLES.map((m) => (
            <button key={m} className={`chip ${primary.includes(m) ? 'on' : ''}`} onClick={() => setPrimary(primary.includes(m) ? primary.filter((x) => x !== m) : [...primary, m])}>
              {m}
            </button>
          ))}
        </div>
      </div>
      <div className="grid2">
        <label className="field">
          <span>Equipment</span>
          <select value={equipment} onChange={(e) => setEquipment(e.target.value as Equipment)}>
            {EQUIPMENT.map((x) => <option key={x}>{x}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Type</span>
          <select value={compound ? 'c' : 'i'} onChange={(e) => setCompound(e.target.value === 'c')}>
            <option value="i">Isolation (one joint)</option>
            <option value="c">Compound (multi-joint)</option>
          </select>
        </label>
      </div>
      <div className="row">
        <button className="btn" onClick={onCancel}>Back</button>
        <button
          className="btn primary grow"
          disabled={!name.trim() || !metric || (metric === 'weight_reps' && !primary.length)}
          onClick={() =>
            metric &&
            onCreate({
              id: `custom-${uid()}`, name: name.trim(), primary, secondary: [], equipment, compound, lowerBody: lower, metric,
              cardio: metric === 'time_distance' && !primary.length, custom: true,
            })
          }
        >
          Create & add
        </button>
      </div>
    </div>
  );
}
