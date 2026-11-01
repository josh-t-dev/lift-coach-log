import { useRef, useState } from 'react';
import { chat, listModels, SUGGESTED_MODELS } from '../lib/llm';
import { exportJson, hydrate, initialState, replaceState, update, useAppState } from '../store';
import { EQUIPMENT, type Experience, type Goal, type Unit } from '../types';

export function Settings() {
  const state = useAppState();
  const p = state.profile;
  const llm = state.llm;
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
      const reply = await chat(llm, [{ role: 'user', content: 'Reply with the JSON {"ok": true}' }], AbortSignal.timeout(60_000));
      const missing = found.length && !found.includes(llm.model) ? ` Note: "${llm.model}" isn't in the server's model list.` : '';
      setTest({ ok: true, msg: `Connected. Model replied: ${reply.replace(/<think>[\s\S]*?<\/think>/g, '').trim().slice(0, 80)}${missing}` });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setTest({
        ok: false,
        msg: /Failed to fetch|NetworkError|Load failed/i.test(m)
          ? `Couldn't reach ${llm.baseUrl}. Check the server is running and allows this page's origin (see README: OLLAMA_ORIGINS).`
          : m,
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="stack">
      <h2>Settings</h2>

      <div className="card stack">
        <h3>Your training</h3>
        <div className="grid2">
          <label className="field"><span>Goal</span>
            <select value={p.goal} onChange={(e) => update((d) => void (d.profile.goal = e.target.value as Goal))}>
              <option value="hypertrophy">Build muscle</option>
              <option value="strength">Get stronger</option>
              <option value="general">General fitness</option>
            </select>
          </label>
          <label className="field"><span>Experience</span>
            <select value={p.experience} onChange={(e) => update((d) => void (d.profile.experience = e.target.value as Experience))}>
              <option value="beginner">Beginner (&lt;1 yr)</option>
              <option value="intermediate">Intermediate (1–3 yrs)</option>
              <option value="advanced">Advanced (3+ yrs)</option>
            </select>
          </label>
          <label className="field"><span>Days per week</span>
            <select value={p.daysPerWeek} onChange={(e) => update((d) => void (d.profile.daysPerWeek = Number(e.target.value)))}>
              {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="field"><span>Session length</span>
            <select value={p.sessionMinutes} onChange={(e) => update((d) => void (d.profile.sessionMinutes = Number(e.target.value)))}>
              {[30, 45, 60, 75, 90].map((n) => <option key={n} value={n}>{n} min</option>)}
            </select>
          </label>
          <label className="field"><span>Units</span>
            <select value={state.unit} onChange={(e) => update((d) => void (d.unit = e.target.value as Unit))}>
              <option value="kg">kg</option>
              <option value="lb">lb</option>
            </select>
          </label>
        </div>
        <div>
          <span className="muted small">Equipment you have</span>
          <div className="chips" style={{ marginTop: 4 }}>
            {EQUIPMENT.map((x) => (
              <button key={x} className={`chip ${p.equipment.includes(x) ? 'on' : ''}`}
                onClick={() => update((d) => void (d.profile.equipment = p.equipment.includes(x) ? p.equipment.filter((y) => y !== x) : [...p.equipment, x]))}>
                {x}
              </button>
            ))}
          </div>
        </div>
        <label className="field"><span>Notes for the coach (injuries, preferences, priorities)</span>
          <textarea value={p.notes} placeholder="e.g. Left knee is cranky with deep lunges. Want bigger shoulders." onChange={(e) => update((d) => void (d.profile.notes = e.target.value))} />
        </label>
      </div>

      <div className="card stack">
        <div className="row spread">
          <h3 style={{ margin: 0 }}>AI coach (open-weight model)</h3>
          <label className="row small"><input type="checkbox" checked={llm.enabled} onChange={(e) => update((d) => void (d.llm.enabled = e.target.checked))} /> Enabled</label>
        </div>
        <p className="small muted">
          Any OpenAI-compatible server works: Ollama, LM Studio, llama.cpp, vLLM, or a hosted open-weight provider.
          When it's off or unreachable, the built-in evidence-based planner is used.
        </p>
        <label className="field"><span>Server URL</span>
          <input type="url" value={llm.baseUrl} onChange={(e) => update((d) => void (d.llm.baseUrl = e.target.value.trim()))} />
        </label>
        <label className="field"><span>Model</span>
          <input type="text" list="model-list" value={llm.model} onChange={(e) => update((d) => void (d.llm.model = e.target.value.trim()))} />
          <datalist id="model-list">
            {[...new Set([...models, ...SUGGESTED_MODELS.map((m) => m.id)])].map((m) => <option key={m} value={m} />)}
          </datalist>
        </label>
        <label className="field"><span>API key (only for hosted providers)</span>
          <input type="password" value={llm.apiKey} autoComplete="off" onChange={(e) => update((d) => void (d.llm.apiKey = e.target.value))} />
        </label>
        <label className="row small"><input type="checkbox" checked={llm.jsonMode} onChange={(e) => update((d) => void (d.llm.jsonMode = e.target.checked))} /> Request JSON output (turn off if your server rejects it)</label>
        <button className="btn" onClick={runTest} disabled={testing}>{testing ? <><span className="spinner" /> Testing…</> : 'Test connection'}</button>
        {test && <div className={`banner ${test.ok ? 'info' : 'warn'}`}>{test.msg}</div>}
        {models.length > 0 && <p className="small muted">Models on server: {models.join(', ')}</p>}
        <details>
          <summary className="small" style={{ cursor: 'pointer' }}>Suggested models</summary>
          <ul className="bullets">{SUGGESTED_MODELS.map((m) => <li key={m.id}><code>{m.id}</code> — {m.note}</li>)}</ul>
        </details>
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
