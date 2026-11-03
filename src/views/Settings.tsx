import { useRef, useState } from 'react';
import { applyPreset, listModels, presetOf, PRESETS, testConnection } from '../lib/providers';
import { exportJson, hydrate, initialState, replaceState, update, useAppState } from '../store';
import type { DistanceUnit, Unit } from '../types';
import { fmtRest } from './ActiveWorkout';

export function Settings() {
  const state = useAppState();
  const llm = state.llm;
  const preset = presetOf(llm);
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const file = useRef<HTMLInputElement>(null);

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      const found = await listModels(llm).catch(() => [] as string[]);
      setModels(found);
      const reply = await testConnection(llm);
      const missing = found.length && !found.includes(llm.model) ? ` Note: "${llm.model}" isn't in the server's model list.` : '';
      setTest({ ok: true, msg: `Connected to ${llm.model}. It replied: ${reply}${missing}` });
    } catch (e) {
      setTest({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="stack">
      <h2>Settings</h2>

      <div className="card stack">
        <h3>Units & rest timer</h3>
        <p className="small muted">Your goal, schedule, activities and targets are on the Plan tab. Each exercise can override the rest time (⏲ while logging).</p>
        <div className="grid2">
          <label className="field"><span>Weight</span>
            <select value={state.unit} onChange={(e) => update((d) => void (d.unit = e.target.value as Unit))}>
              <option value="kg">kg</option>
              <option value="lb">lb</option>
            </select>
          </label>
          <label className="field"><span>Default rest between sets</span>
            <select value={state.defaultRestSec} onChange={(e) => update((d) => void (d.defaultRestSec = Number(e.target.value)))}>
              {[30, 45, 60, 75, 90, 120, 150, 180, 240, 300].map((r) => <option key={r} value={r}>{fmtRest(r)}{r === 90 ? ' (default)' : ''}</option>)}
            </select>
          </label>
          <label className="field"><span>Distance</span>
            <select value={state.distanceUnit} onChange={(e) => update((d) => void (d.distanceUnit = e.target.value as DistanceUnit))}>
              <option value="km">km</option>
              <option value="mi">miles</option>
            </select>
          </label>
        </div>
      </div>

      <div className="card stack">
        <div className="row spread">
          <h3 style={{ margin: 0 }}>AI coach</h3>
          <label className="row small"><input type="checkbox" checked={llm.enabled} onChange={(e) => update((d) => void (d.llm.enabled = e.target.checked))} /> Enabled</label>
        </div>
        <p className="small muted">
          Choose where the coach's model runs. If it's off or unreachable, the built-in evidence-based planner is used instead.
        </p>
        <label className="field"><span>Provider</span>
          <select value={preset.id} onChange={(e) => { setTest(null); setModels([]); update((d) => void (d.llm = applyPreset(e.target.value, d.llm))); }}>
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <div className="banner info small">
          {preset.openWeight
            ? 'Open-weight: the model files are public and can run on your own hardware.'
            : 'Claude is a hosted model from Anthropic (not open-weight). Requests go to Anthropic and are billed to your API key.'}
          <ol className="bullets" style={{ marginTop: 6 }}>{preset.setup.map((x, i) => <li key={i}>{x}</li>)}</ol>
        </div>
        {preset.id !== 'claude' && (
          <label className="field"><span>Server URL</span>
            <input type="url" value={llm.baseUrl} onChange={(e) => update((d) => void (d.llm.baseUrl = e.target.value.trim()))} />
          </label>
        )}
        <label className="field"><span>Model</span>
          <input type="text" list="model-list" value={llm.model} onChange={(e) => update((d) => void (d.llm.model = e.target.value.trim()))} />
          <datalist id="model-list">
            {[...new Set([...preset.models.map((m) => m.id), ...models])].map((m) => <option key={m} value={m} />)}
          </datalist>
        </label>
        {preset.models.length > 0 && (
          <div className="chips">
            {preset.models.map((m) => (
              <button key={m.id} className={`chip ${llm.model === m.id ? 'on' : ''}`} title={m.note} onClick={() => update((d) => void (d.llm.model = m.id))}>
                {m.label ?? m.id}
              </button>
            ))}
          </div>
        )}
        {preset.models.find((m) => m.id === llm.model) && (
          <p className="small muted" style={{ margin: 0 }}>{preset.models.find((m) => m.id === llm.model)!.note}</p>
        )}
        {(preset.keyLabel || preset.id === 'custom') && (
          <label className="field"><span>{preset.keyLabel ?? 'API key (if the server needs one)'}{preset.keyWhere ? ` — from ${preset.keyWhere}` : ''}</span>
            <input type="password" value={llm.apiKey} autoComplete="off" onChange={(e) => update((d) => void (d.llm.apiKey = e.target.value.trim()))} />
          </label>
        )}
        {llm.api === 'openai' && (
          <label className="row small"><input type="checkbox" checked={llm.jsonMode} onChange={(e) => update((d) => void (d.llm.jsonMode = e.target.checked))} /> Request JSON output (turn off if the server rejects it)</label>
        )}
        <button className="btn" onClick={runTest} disabled={testing || (!!preset.keyLabel && !llm.apiKey)}>
          {testing ? <><span className="spinner" /> Testing…</> : 'Test connection'}
        </button>
        {test && <div className={`banner ${test.ok ? 'info' : 'warn'}`}>{test.msg}</div>}
        {models.length > 0 && <p className="small muted">Available: {models.slice(0, 30).join(', ')}{models.length > 30 ? '…' : ''}</p>}
      </div>

      <div className="card stack">
        <h3>Data</h3>
        <p className="small muted">Everything is stored in this browser. Export a backup to move it to another device.</p>
        <div className="row wrap">
          <button className="btn" onClick={() => {
            const blob = new Blob([exportJson()], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `workouts-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
          }}>Export</button>
          <button className="btn" onClick={() => file.current?.click()}>Import</button>
          <button className="btn ghost danger" onClick={() => confirm('Erase all workouts, templates and settings?') && replaceState(initialState())}>Reset</button>
          <input ref={file} type="file" accept="application/json" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const data = hydrate(JSON.parse(await f.text()));
              if (confirm(`Import ${data.sessions.length} workouts and ${data.templates.length} saved workouts? This replaces current data.`)) {
                replaceState({ ...data, llm: { ...data.llm, apiKey: data.llm.apiKey || state.llm.apiKey } });
              }
            } catch {
              alert('That file is not a valid backup.');
            }
          }} />
        </div>
      </div>
    </div>
  );
}
