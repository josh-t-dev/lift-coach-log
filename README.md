# Lift Log

A simple workout tracker with an AI coach running on an **open-weight LLM**.

- **Log workouts**: start an empty workout and add exercises as you go, or start from a saved workout. Your previous numbers show beside each set, and a rest timer starts each time you tick a set off.
- **Saved workouts**: create and edit them, or save any finished session or coach plan as one.
- **Coach**: looks at your history (weekly sets per muscle, sessions per week, days since your last workout, recent loads) and plans your week and today's session. For example: *"You missed last week — here's this week."*
- Data stays in your browser (localStorage). Export and import are in Settings.

## How the coach works ("evidence first")

```
your log ──► analytics.ts ──► snapshot (status, adherence, sets/muscle, loads)
                                   │
evidence.ts (principles + sources) ├──► planner.ts ──► baseline plan (rules)
                                   │                          │
                                   └──────► llm.ts ◄──────────┘
                                   system prompt = principles
                                   user prompt   = snapshot + baseline + your note
                                             │
                                   validated JSON plan (or the baseline if the LLM fails)
```

1. **`src/lib/evidence.ts`** holds the research principles, each with its source. Topics: weekly volume, ≥2×/week frequency, 0–3 reps in reserve, rep ranges by goal, double progression, rest periods, and detraining after time off.
2. **`src/lib/analytics.ts`** works out your status deterministically. The statuses are *new*, *on track*, *missed last week*, *returning* (2–3 weeks off) and *detrained* (4+ weeks off). It also suggests next loads using double progression.
3. **`src/lib/planner.ts`** builds a complete plan from rules. It picks a split from your days per week, filters exercises by your equipment, fits the session length, and cuts load and volume after a break.
4. **`src/lib/llm.ts`** sends the principles, your data and the baseline plan to the model. The model may only adjust the plan and must explain why. Its reply is validated: exercise ids are mapped to the library and numbers are clamped. If the server is unreachable or the output can't be used, you get the rule-based plan with a notice.

So the LLM personalizes and explains the plan, while the guardrails and the numbers come from code.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

### Set up an open-weight model (Ollama)

```bash
# install from https://ollama.com, then:
ollama pull qwen3:8b
ollama serve
```

The defaults (`http://localhost:11434/v1`, `qwen3:8b`) work as they are. Ollama accepts requests from `localhost` pages. If you open the app from another device (for example your phone at `http://<your-pc-ip>:5173`), allow that origin:

```bash
OLLAMA_HOST=0.0.0.0 OLLAMA_ORIGINS="*" ollama serve
```

Then set the server URL in Settings to `http://<your-pc-ip>:11434/v1`.

Other options: **LM Studio** (`http://localhost:1234/v1`; turn off "Request JSON output" if it rejects it), **llama.cpp server**, **vLLM**, or a hosted open-weight provider (base URL + API key). Suggested models: `qwen3:8b`, `qwen3:14b`, `gpt-oss:20b`, `gemma3:12b`, `llama3.1:8b`.

## Scripts

| | |
|---|---|
| `npm run dev` | dev server |
| `npm test` | unit tests (analytics, planner, LLM parsing/fallback) |
| `npm run build` | type-check + production build to `dist/` |

General fitness guidance, not medical advice.
