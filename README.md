# Lift Log

A simple workout tracker with an AI coach running on an **open-weight LLM**.

- **Log workouts**: start an empty workout and add exercises as you go, or start from a saved workout. When you add an exercise, the app asks how to track it: **weight & reps** or **time & distance**. You can switch any exercise mid-workout with the ⇄ button. Your previous numbers show beside each set, and a rest timer starts each time you tick a set off.
- **Base plan** (Plan tab): your program for a training block, such as a quarter or a year. It holds your weekly days and exercises, set targets per muscle, rep ranges, effort, cardio minutes, and the research principles plus your own rules. Edit any of it. **Start a new block** saves the old plan under *Past blocks*, where you can restore it.
- **Coach**: every time you ask, it starts from your base plan and adjusts for your history: weekly sets per muscle, sessions per week, days since your last workout, and recent loads. For example: *"You missed last week — here's this week."*
- **Progress**: bar charts for workouts per week vs plan, progress per exercise (estimated 1-rep max, top set, volume, or distance and minutes), hard sets per muscle vs target, cardio minutes per week, and weekly volume. Each chart has a table view. Your workout history is listed below the charts.
- Data stays in your browser (localStorage). Export and import are in Settings. Data saved by older versions is upgraded automatically.

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

0. **Your base plan** (`BasePlan` in `src/types.ts`, edited on the Plan tab) is the starting point for every request. The principles you tick, plus your own rules, become the model's system prompt. The plan's days, targets and block dates are sent with every request.
1. **`src/lib/evidence.ts`** holds the research principles, each with its source. Topics: weekly volume, ≥2×/week frequency, 0–3 reps in reserve, rep ranges by goal, double progression, rest periods, and detraining after time off.
2. **`src/lib/analytics.ts`** works out your status deterministically. The statuses are *new*, *on track*, *missed last week*, *returning* (2–3 weeks off) and *detrained* (4+ weeks off). It also suggests next loads using double progression.
3. **`src/lib/planner.ts`** generates the starting base plan from the evidence. It picks a split from your days per week, filters exercises by your equipment, and adds sets until each muscle reaches its weekly target within your session time. Each week it turns your plan's next day into today's workout, with progressed loads and less load and volume after a break.
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
