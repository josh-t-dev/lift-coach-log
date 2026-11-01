import { useMemo, useState } from 'react';
import { allExercises } from '../data/exercises';
import { update, uid, useAppState } from '../store';
import { EQUIPMENT, MUSCLES, type Equipment, type Exercise, type Muscle } from '../types';

export function ExercisePicker({ onPick, onClose }: { onPick: (ex: Exercise) => void; onClose: () => void }) {
  const state = useAppState();
  const [q, setQ] = useState('');
  const [muscle, setMuscle] = useState<Muscle | null>(null);
  const [creating, setCreating] = useState(false);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return allExercises(state.customExercises)
      .filter((e) => !muscle || e.primary.includes(muscle))
      .filter((e) => !needle || e.name.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [q, muscle, state.customExercises]);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Add exercise">
        <div className="row spread" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Add exercise</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {creating ? (
          <CustomExerciseForm
            initialName={q}
            onCancel={() => setCreating(false)}
            onCreate={(ex) => {
              update((d) => void d.customExercises.push(ex));
              onPick(ex);
            }}
          />
        ) : (
          <>
            <input type="search" placeholder="Search exercises" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            <div className="chips" style={{ margin: '10px 0' }}>
              {MUSCLES.map((m) => (
                <button key={m} className={`chip ${muscle === m ? 'on' : ''}`} onClick={() => setMuscle(muscle === m ? null : m)}>
                  {m}
                </button>
              ))}
            </div>
            <div>
              {list.map((e) => (
                <button key={e.id} className="picker-item" onClick={() => onPick(e)}>
                  <span>{e.name}</span>
                  <span className="tag">{e.primary.join(', ')}</span>
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
  const lower = primary.some((m) => ['quads', 'hamstrings', 'glutes', 'calves'].includes(m));

  return (
    <div className="stack">
      <label className="field">
        <span>Name</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <div>
        <span className="muted small">Main muscles worked (used for weekly volume)</span>
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
          disabled={!name.trim() || !primary.length}
          onClick={() =>
            onCreate({ id: `custom-${uid()}`, name: name.trim(), primary, secondary: [], equipment, compound, lowerBody: lower, custom: true })
          }
        >
          Create & add
        </button>
      </div>
    </div>
  );
}
