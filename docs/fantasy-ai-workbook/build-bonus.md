# YSNT Framework — Build: Bonus Phase

## What You're Building

Show-off features that make users say "oh, that's clever":
- Correlation analysis (which player pairs work together?)
- Lineup comparison (see differences between top 3)
- Auto-pivot suggestions (if top player ruled out, here's plan B)
- Export to CSV (download lineups for analysis)
- History dashboard (track past scans + actual vs projected)

By end: Product is shareworthy.

---

## Your Build Bonus Phase

### Part 1 — Secondary Agent: Correlation Analyzer (~2 hrs)

**Prompt to Claude Code:**
```
TASK: Build correlation analysis for player pairs and stacking strategies

1. Create src/lib/correlationAgent.ts:
   - Analyze player pair performance (which combos work together?)
   - Input: player_roster with last_5_stats
   - Output: correlation scores between pairs
   
   Interface CorrelationPair {
     player1_id: string;
     player2_id: string;
     correlation_score: number; // -1 to 1
     co_appearance_count: number; // games played together
     avg_combined_points: number;
     recommendation: string; // "stack together", "avoid together", "neutral"
   }

2. Algorithm:
   - For each player pair, calculate: Pearson correlation of their last 5 games
   - If correlation > 0.6: recommend stacking
   - If correlation < -0.2: recommend avoiding
   - Weight by sample size (need both to play 5 games)
   - Return top 10 recommended pairs

3. Integrate into LineupDisplay.jsx:
   - Show "Recommended Stack" section
   - Display top 3 player pairs with correlation > 0.6
   - Highlight when lineup already contains recommended pair

Output: Users see "Stack LeBron + role player (0.78 correlation)" advice
```

### Part 2 — Extended Features (~1 hr)

**Prompt to Claude Code:**
```
TASK: Add lineup comparison, export, and history dashboard

1. Create LineupComparison.jsx:
   - Display top 3 lineups side-by-side
   - Show differences: which players differ, salary impact
   - Toggle view: full detail vs compact

2. Create ExportLineup.jsx:
   - Export button on each lineup
   - Options: Copy to clipboard, Download CSV, Share link
   - CSV format: Player | Position | Salary | Projected | Status
   - Copy format: Player Name (Pos) \\$Salary format for DK paste

3. Create HistoryDashboard.jsx:
   - Table of past scans: sport, date, top lineup projected, actual points, status
   - Filter by sport/date range
   - Click to view details: all lineups from that scan
   - Track accuracy over time (projected vs actual)

Output: Users can export, compare, and track lineups over time
```

### Part 3 — Show-Off Feature (~1.5 hrs)

**Prompt to Claude Code:**
```
TASK: Build real-time lineup updates and auto-pivot suggestions

1. Create PivotSuggestions.jsx:
   - "If top captain ruled out by 5pm, here's your backup"
   - For each lineup, generate fallback option
   - Show: swap player X → player Y, projected points change: -3.2 to 5.1
   - Trigger: injury news comes in real-time (simulate with button)

2. Real-time injury alerts (simulate for now):
   - Create src/hooks/useInjuryAlerts.ts
   - Simulated: check for injury news every 10 seconds
   - On new injury, show toast: "{Player} ruled OUT"
   - Auto-update confidence scores
   - Suggest lineup changes

3. Visual momentum indicators:
   - In LineupDisplay, show player trend arrow: ↗ (up), → (stable), ↘ (down)
   - Color code: green (hot), gray (stable), orange (cold)
   - Tooltip: "Averaged 45 pts over last 5 games, trending up"

Output: Users see live updates, auto-pivots, momentum indicators. Shareable.
```

---

## Build Bonus Deliverables Checklist

- [ ] Correlation analyzer working (player pair analysis)
- [ ] Top 10 recommended stacks displayed
- [ ] LineupComparison shows differences between top 3
- [ ] Export to CSV working
- [ ] Copy to clipboard working
- [ ] Share link functional (or planned for later)
- [ ] History dashboard showing past scans
- [ ] Accuracy tracking (projected vs actual)
- [ ] Pivot suggestions showing "If player X out, use Y instead"
- [ ] Real-time injury alerts (simulated or live)
- [ ] Momentum indicators (↗ ↘ →) on players
- [ ] All features integrated into main UI
- [ ] Code committed to GitHub

---

*Next up → Design: design system + UI polish*
