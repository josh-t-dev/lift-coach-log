# Lift Log

A simple workout tracker with an AI coach running on an **open-weight LLM**.

- **Log workouts**: start an empty workout and add exercises as you go, or start from a saved workout. When you add an exercise, the app asks how to track it: **weight & reps** or **time & distance**. You can switch any exercise mid-workout with the ⇄ button. Your previous numbers show beside each set. Effort is logged as **RPE** (1–10, where 10 means nothing left; RPE = 10 − reps in reserve). A **rest timer** starts when you tick a set off. It defaults to 1:30, and each exercise can have its own time (⏲ while logging, or in a saved workout or plan day).
- **Fixed-day programs** (Plan tab): pin plan days to weekdays (e.g. Mon sprints, Sat lower B), or to all 7 for a daily routine. Give each exercise a **week-by-week prescription** for the block (W1 "4×5 @ 75–80%" … W6 "deload"); the current week's line shows on Today and in the logger. Days missed earlier in the week are flagged, and the coach applies your drop-order rules. **Export / Import** (Plan tab) move a whole program as one file.
- **Sprints and runs**: sprints log seconds and metres; runs log minutes and distance, with pace shown in History.
- **Weekly activities** (Plan tab): volleyball, basketball, flag football, yoga, or anything you name, on set weekdays. Lifting is scheduled around them and avoids the day before a hard game where possible. They count toward your cardio minutes, and Today has a one-tap **Log it**.
- **Base plan** (Plan tab): your program for a training block, such as a quarter or a year. It holds your weekly days and exercises, set targets per muscle, rep ranges, effort, cardio minutes, and the research principles plus your own rules. Edit any of it. **New Plan** saves the old plan under *Past blocks*, where you can restore it.
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

### Choose where the AI runs (Settings → AI coach)

| Provider | Open-weight? | Needs | Notes |
|---|---|---|---|
| **Ollama** (default) | Yes | Ollama on your computer: `ollama pull qwen3:8b` | Free and private. For phones, run `OLLAMA_HOST=0.0.0.0 OLLAMA_ORIGINS="*" ollama serve` |
| **Hugging Face** | Yes | A Hugging Face access token | Hosted, so no computer needs to stay on. Default model `openai/gpt-oss-20b`; **Test connection** lists what your account can use |
| **LM Studio** | Yes | LM Studio's local server | |
| **Claude** | No (hosted by Anthropic) | An Anthropic API key from platform.claude.com | Uses the official `@anthropic-ai/sdk`, loaded only when Claude is selected. Default `claude-opus-5-5`; also Sonnet 5.5 and Haiku 5.5. Uses Anthropic's server-side fallback if a request is declined |
| **Other** | Usually | Any chat-completions server (llama.cpp, vLLM…) | |

"OpenAI-compatible" only describes the **request format**: the chat-completions API shape OpenAI introduced, which most open-weight servers now accept as a standard. Using it sends nothing to OpenAI. Claude uses Anthropic's own Messages API.

API keys are stored only in the browser on that device, and **Export** leaves them out.

## Host it (GitHub Pages)

1. Push this repository to GitHub. It must be **public** for free GitHub Pages.
2. In the repository, go to **Settings → Pages → Source: GitHub Actions**.
3. Every push to `main` then builds, tests and publishes the app to `https://<username>.github.io/<repo>/`.

Your workouts never go to GitHub; they stay in each device's browser. To move data between addresses or devices, use **Settings → Export** and then **Import**.

**AI from the hosted site:**
- **Hugging Face** and **Claude** work from any device.
- **Ollama** on your Mac works from the Mac's browser once Ollama allows the site: run `launchctl setenv OLLAMA_ORIGINS "https://<username>.github.io"`, then quit and reopen Ollama. Chrome may ask permission to access local network devices; allow it.
- A phone can't reach Ollama on your Mac from the hosted (https) site, because browsers block https pages from calling plain-http addresses on your network. On the phone, use Hugging Face, or open the app from your Mac with `npm run dev -- --host` on the same Wi-Fi.

## Scripts

| | |
|---|---|
| `npm run dev` | dev server |
| `npm test` | unit tests (analytics, planner, LLM parsing/fallback) |
| `npm run build` | type-check + production build to `dist/` |

General fitness guidance, not medical advice.
