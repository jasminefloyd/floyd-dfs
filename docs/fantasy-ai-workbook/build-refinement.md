# YSNT Framework — Build: Refinement Phase

## What You're Refining

Build Core works. Now make it production-ready:
- Error handling that doesn't crash
- Loading states so users know what's happening
- Input validation so bad data doesn't break lineups
- Rate limit handling so API failures don't kill the app
- Prompt tuning so output quality noticeably improves

---

## Your Build Refinement Phase

### Part 1 — Error Handling & Loading States (~1.5 hrs)

Add error boundaries, loading spinners, empty states, toast notifications.

**Prompt to Claude Code:**
```
You are adding production-grade error handling to Fantasy AI.

TASK: Implement error boundaries, loading states, empty states, and toast notifications

1. Create src/components/ErrorBoundary.jsx:
   - Catch all unhandled errors in child components
   - Display user-friendly error message (not stack trace)
   - Log to console for debugging
   - Include retry button

2. Create src/components/Toast.jsx:
   - Simple toast notification component
   - Types: success, error, warning, info
   - Auto-dismiss after 3 seconds
   - Dismissable by clicking

3. Create src/hooks/useToast.ts:
   - Context-based toast management
   - Add, remove, clear toast functions
   - Export ToastProvider wrapper for App.jsx

4. Update ScanPage.jsx:
   - Wrap with ErrorBoundary
   - Add try-catch around orchestrateMiosScan
   - Catch and display errors as toasts
   - Catch and display errors as toasts
   - Show loading spinner while collecting data
   - Show empty state if no results

5. Add empty states:
   - If no sport selected: "Select a sport to begin"
   - If MIOS fails: "Failed to collect data. Try again with different date."
   - If no lineups generated: "No valid lineups could be generated with your settings."

6. Update MiosScanner.jsx:
   - Disable all inputs while loading
   - Show "Scanning..." text while loading
   - Disable Scan button while loading
   - Show validation errors in real-time

7. Update LineupDisplay.jsx:
   - Add "Lineup saved!" toast on save
   - Add "Copied to clipboard!" toast on copy
   - Handle missing data gracefully (show "—" instead of crashing)

Output: App handles errors gracefully, users never see stack traces, loading states clear.
```

### Part 2 — Prompt Tuning (~1.5 hrs)

Improve MIOS and PIOS output quality through prompt refinement.

**Prompt to Claude Code:**
```
You are tuning MIOS and PIOS agents to improve output quality.

TASK: Refine agent prompts and algorithms

1. In src/lib/miosAgents.ts, enhance collectNewsAndInjuries():
   - Parse ESPN RSS more accurately (extract player names, injury status, severity)
   - Classify injuries: out, doubtful, questionable, probable, day-to-day
   - Assign confidence to each injury report (0-1 scale)
   - Return structured injury data, not raw XML lines

2. Enhance collectLast5Stats():
   - Handle missing data gracefully (player might have < 5 games played)
   - Compute trend vector: slope of performance over 5 games
   - Identify hot streaks (last 2 games trending up) and cold spells (trending down)
   - Flag "new season" or "recently returned from injury" scenarios
   - Confidence based on: sample size (5 games = 0.9, 4 games = 0.75, etc.) + consistency

3. Enhance collectRedditSentiment():
   - Integrate actual PRAW library (install praw package)
   - Query /r/{sport}, /r/{sport}_dgd, team subreddits
   - Extract: number of mentions, sentiment score (-1 to 1), key themes
   - Themes: breakout, injury_concern, trade_rumors, slump, hot_streak, etc.
   - Use textblob or similar for sentiment analysis

4. Enhance scorePlayerConfidence():
   - Weight injury status: out (0), doubtful (0.2), questionable (0.5), active (1.0)
   - Weight last-5-games consistency: low variance = high confidence
   - Weight Vegas alignment: if Vegas expects high score, boost confidence
   - Weight recency: most recent game 40%, prior games weighted lower
   - Weight social sentiment: positive mentions boost, negative concerns lower
   - Handle edge cases: new players (low confidence), injury returns (medium confidence)

5. In src/lib/piosGenerator.ts, enhance calculateLineupConfidence():
   - Average player confidence (weighted by projected points)
   - Boost for salary efficiency (using $48-50K is better than $40K)
   - Penalty for injury concerns (if lineup has too many "questionable" players)
   - Bonus for Vegas alignment (if Vegas expects high-scoring game and lineup heavily features that game)
   - Penalty for extreme exposure (if 50%+ of points from one game)

6. Add narrative generation (placeholder for now):
   - For each lineup, generate 1-2 sentence explanation
   - Example: "Heavy LeBron and role-player stack in Game 1 (LAL +5.5 vs MIA). Strong projection with upside if LeBron plays 36+ minutes."
   - Include: captain reasoning (Showdown), game context, injury caveats, Vegas rationale
   - Placeholder: "Lineup #{rank} optimized for {contest_type} with {confidence}% confidence."
   - Full Claude integration happens in Refinement Phase Part 3

7. Test with 10+ real contests:
   - Scan NBA game (today or tomorrow)
   - Review lineups: do projections look reasonable?
   - Check confidence scores: are they well-calibrated?
   - Review narratives: do they make sense?
   - Iterate until output quality is high

Output: MIOS data quality improved, PIOS confidence scoring more accurate, narratives make sense.
```

### Part 3 — Data Validation (~1 hr)

Add input validation, sanitization, guardrails.

**Prompt to Claude Code:**
```
You are adding data validation to prevent invalid lineups and bad data.

TASK: Implement input validation and data guardrails

1. Create src/lib/validation.ts:
   - Validate sport: must be in ['nba', 'wnba', 'nfl', 'mlb', 'f1']
   - Validate contestType: must be in ['showdown', 'classic']
   - Validate contestDate: must be today or future date
   - Validate excludedPlayers: comma-separated, lowercase names
   - Validate riskTolerance: must be 'conservative', 'balanced', or 'aggressive'
   - Return errors as array of strings

2. In MiosScanner.jsx, validate on form submission:
   - Call validation functions
   - If errors, show them as toast notifications
   - Don't call onScan() until all validation passes

3. In piosGenerator.ts, add lineup validation:
   - Verify salary_used <= 50000 (always)
   - Verify all required positions filled
   - Verify projected_points > 0
   - Verify confidence_score between 0-1
   - If any lineup fails validation, remove it from results
   - Log validation failures to console

4. Add guardrails for edge cases:
   - If MIOS roster is empty: return empty lineups array (don't crash)
   - If all players are injured: show "No healthy players available"
   - If no valid lineup combinations possible: show "Adjust your settings and try again"
   - If salary cap prevents any lineup: show "Salary cap prevents lineup construction"

5. Sanitize player names in excludedPlayers:
   - Lowercase, trim whitespace
   - Handle special characters (LeBron → lebron)
   - Check against roster names case-insensitively

Output: Invalid inputs caught before they cause errors, lineups validated, edge cases handled.
```

### Part 4 — Rate Limiting & Resilience (~1 hr)

Handle API timeouts, rate limits, graceful fallbacks.

**Prompt to Claude Code:**
```
You are making MIOS resilient to API failures and rate limits.

TASK: Implement rate limit handling and fallback logic

1. Create src/lib/rateLimiter.ts:
   - Track API calls per service (ESPN, Reddit, Sleeper, Ergast)
   - Exponential backoff: 1s, 2s, 4s, 8s, 16s max
   - Debounce: prevent duplicate requests within 500ms
   - Return 429 handling: wait and retry

2. In orchestrateMiosScan():
   - Add 90-second timeout per scan
   - If ESPN RSS times out (> 5s): skip, use cached data if available
   - If Stats API times out (> 15s): skip, use cached last_5_stats
   - If Reddit times out (> 30s): skip, use cached sentiment
   - If Sleeper times out (> 10s): skip, use last known props
   - Partial MIOS is OK (better than failing completely)

3. Implement caching:
   - Cache player_last_5_stats in Supabase (24-hour TTL)
   - Cache Reddit sentiment in Supabase (24-hour TTL)
   - Cache DraftKings contests in Supabase (24-hour TTL)
   - On MIOS scan, check cache first (if < 2 hours old)
   - If live data fails, fall back to cache
   - Return "Data may be stale (from {time} ago)" notice if using cache

4. In ScanPage.jsx, handle partial MIOS:
   - If MIOS collection partially failed, show warning toast: "Some data unavailable, using cached data"
   - Continue with lineup generation anyway
   - Mark affected lineups with lower confidence scores

5. Add retry logic:
   - On API error, retry once after 2 seconds
   - If retry fails, use cache
   - If no cache available, show "Unable to fetch data. Try again later."

Output: App resilient to API failures, timeouts, and rate limits. Graceful degradation.
```

---

## Build Refinement Deliverables Checklist

- [ ] ErrorBoundary catches and displays errors
- [ ] No unhandled promise rejections in console
- [ ] Loading spinners on all async operations
- [ ] Empty states for: no sport selected, MIOS failed, no lineups generated
- [ ] Toast notifications for: success, errors, warnings
- [ ] All inputs validated before submission
- [ ] Lineups validated (salary cap, positions, confidence scores)
- [ ] Player names sanitized (case-insensitive exclusions)
- [ ] MIOS agents handle missing/incomplete data
- [ ] Injured players weighted correctly in PIOS
- [ ] Confidence scores well-calibrated (0.7-0.9 for high-quality lineups)
- [ ] Rate limit handling (exponential backoff, retries)
- [ ] Caching implemented (player stats, sentiment, contests)
- [ ] Fallback to cache if live data fails
- [ ] No API timeouts crash the app
- [ ] Narratives generated (placeholder or full Claude integration)
- [ ] Tested with 10+ real contests
- [ ] Code committed to GitHub

---

*Next up → Build Bonus: differentiating features*
