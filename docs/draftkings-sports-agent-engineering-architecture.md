# DraftKings Sports Agent Engine
## Architectural Implementation Specification & Engineering Requirements

**Status:** Engineering handoff  
**Deployment:** Vercel  
**Primary database / backend platform:** Supabase (Postgres, Auth, Storage, Realtime, Edge Functions)  
**Frontend:** React / Next.js, mobile-first responsive web application / PWA  
**Contest provider:** DraftKings only  
**System type:** Hybrid deterministic + agentic decision engine  
**Primary interaction model:** Product UI, not chat-first

---

# 1. Executive Summary

This document defines the implementation architecture, data model, application flows, agent boundaries, prompts, deterministic services, UI requirements, multi-tenant database design, orchestration logic, learning loop, and deployment requirements for a DraftKings-only DFS lineup decision engine.

The product experience is intentionally simple:

1. User opens app and signs in.
2. User selects a sport.
3. User selects a DraftKings contest.
4. User chooses how many lineups to generate.
5. User executes the lineup generator.
6. The system derives all available contest metadata from DraftKings.
7. The engine researches the slate.
8. Sport-specific reasoning adjusts opportunity assumptions.
9. Quantitative models generate DraftKings fantasy projections.
10. The optimizer produces mathematically valid candidate lineups.
11. The Selection Agent chooses the final lineup(s) based on contest context.
12. The user reviews the lineup(s) and marks any submitted lineup as **Entered**.
13. The Learning Loop monitors material pre-lock changes and measures post-contest outcomes.

The internal engine is:

```text
SLATE
  ↓
RESEARCH
  ↓
SPORT ADJUSTMENT
  ↓
PROJECTION
  ↓
OPTIMIZE
  ↓
SELECTION
  ↓
LINEUP ENTERED
  ↓
LEARNING LOOP
  ↺ targeted feedback into earlier stages
```

The implementation principle is:

> **Use AI where judgment is required. Use deterministic software where the same inputs should always produce the same outputs.**

---

# 2. Locked Product Principles

## 2.1 DraftKings-only

The application supports DraftKings contests only.

DraftKings is authoritative for:

- Contest identity
- Contest format
- Event/slate membership
- Salary cap
- Roster construction
- Scoring rules
- Player pool
- Salaries
- Player eligibility
- CPT/MVP/UTIL mechanics
- Lock time
- Contest size when available
- Maximum entries when available

Secondary sports sources must never overwrite DraftKings contest data.

## 2.2 Mobile-first web application

The primary user experience is a mobile responsive React/Next.js application.

The product is **not** a chat product.

Chat-style analysis may be added later as a secondary “Ask about this lineup” surface, but the primary workflow is structured UI.

## 2.3 Minimal user input

The user should never be asked for information the system can reliably retrieve.

Ideal setup flow:

```text
Select Sport
→ Select DraftKings Contest
→ Choose Number of Lineups
→ Generate
```

Fallback manual fields may appear only when provider data is incomplete.

## 2.4 Lineup lifecycle

There are exactly two lineup lifecycle states in V1:

```text
GENERATED
ENTERED
```

`GENERATED` means the engine produced the lineup.

`ENTERED` means the user explicitly confirms they submitted that lineup to DraftKings.

There is no separate “Saved” state.

## 2.5 Entered lineups are immutable without explicit user action

The engine may recommend:

- KEEP
- ADJUST
- REBUILD

but it must never silently mutate a lineup marked `ENTERED`.

## 2.6 Learning from process, not wins/losses

The Learning Loop diagnoses whether assumptions were correct.

A lineup losing does not automatically imply model failure.

Valid post-contest diagnoses are:

```text
RESEARCH
SPORT_ADJUSTMENT
PROJECTION
OPTIMIZE
SELECTION
VARIANCE
```

---

# 3. Functional Requirements

## 3.1 Authentication and tenancy

### FR-AUTH-001
Users must authenticate before accessing personalized lineup generation.

### FR-AUTH-002
Every authenticated user belongs to at least one tenant.

### FR-AUTH-003
All tenant-owned records must contain `tenant_id`.

### FR-AUTH-004
Supabase Row Level Security must enforce tenant isolation.

### FR-AUTH-005
A user must never read or modify another tenant's lineup, run, contest preference, engine history, or learning data.

---

# 4. High-Level System Architecture

```text
┌───────────────────────────────────────────────────────────────┐
│                      NEXT.JS / REACT UI                       │
│                  Mobile-first Web / PWA                       │
└─────────────────────────────┬─────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────┐
│                    APPLICATION API LAYER                      │
│            Next.js Route Handlers / Server Actions            │
└─────────────────────────────┬─────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────┐
│                         SUPABASE                              │
│                                                               │
│  Auth   Postgres   RLS   Storage   Realtime   Edge Functions │
└─────────────────────────────┬─────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────┐
│                    SPORTS DECISION ENGINE                     │
│                                                               │
│  Slate Service              deterministic                     │
│  Research Agent             AI + retrieval                    │
│  Sport Adjustment           AI specialists                    │
│  Projection Service         quantitative / hybrid             │
│  Optimize Service           deterministic simulation          │
│  Selection Agent            AI decision + presentation        │
│  Learning Loop              hybrid                            │
└───────────────────────────────────────────────────────────────┘
```

---

# 5. Stage Classification

| Stage | Implementation Type | AI Required? | Primary Responsibility |
|---|---|---:|---|
| Slate | Deterministic service | No | Ingest, normalize, validate DK contest |
| Research | AI agent + retrieval | Yes | Establish current evidence |
| Sport Adjustment | AI specialists | Yes | Interpret evidence into opportunity changes |
| Projection | Quantitative hybrid service | Limited | Convert opportunity into fantasy distributions |
| Optimize | Deterministic optimization/simulation | No | Generate and rank legal lineups |
| Selection | AI decision + UI layer | Yes | Choose final lineup(s), explain mobile-first |
| Learning Loop | Hybrid | Partial | Monitor, measure, diagnose, learn |

---

# 6. Orchestration

## 6.1 Orchestrator responsibility

The Orchestrator owns workflow state.

It must not independently perform sports analysis.

Responsibilities:

- Start a generation run.
- Invoke stages in order.
- Validate each stage's contract.
- Persist each stage version.
- Stop when a critical stage returns `BLOCKED`.
- Route Research gaps back to Research.
- Trigger targeted reruns from Learning Loop.
- Maintain lineage.
- Return Selection output to the UI.

## 6.2 Orchestrator system prompt

```text
You are the Sports Engine Orchestrator for a DraftKings-only DFS system.

Coordinate this workflow:

Slate
→ Research
→ Sport Adjustment
→ Projection
→ Optimize
→ Selection
→ Learning Loop

You do not perform specialist reasoning owned by those stages.

Responsibilities:
1. Maintain workflow state.
2. Ensure every stage receives its required validated inputs.
3. Validate every stage output against the defined contract.
4. Route Sport Adjustment to the correct sport specialist.
5. Stop when a required stage is BLOCKED.
6. Preserve warnings, uncertainty, watch dependencies, source references, and version lineage.
7. Route Learning Loop changes back to the earliest affected stage.
8. Never silently modify an ENTERED lineup.
9. Present only Selection output as the user-facing recommendation.
10. Persist engine versions and package versions for measurement.

Never:
- invent DraftKings contest metadata,
- research players yourself,
- create projections,
- construct lineups,
- override deterministic optimization results.
```

---

# 7. Stage 1 — Slate Service

## 7.1 Purpose

> Define exactly what DraftKings contest is being solved.

Slate performs no player analysis.

## 7.2 Allowed sources

Only:

1. DraftKings contest/API/RSS/feed data.
2. DraftKings screenshots supplied by the user.

No RotoWire, Reddit, ESPN, sportsbooks, or secondary content may define contest data.

## 7.3 Input

```ts
export interface SlateInput {
  tenantId: string;
  userId: string;
  requestId: string;
  receivedAt: string;

  sport?: Sport;
  selectedContestId?: string;

  draftKingsPayload?: unknown;
  screenshotAssetIds?: string[];

  requestedEntryCount: number;
}
```

## 7.4 Normalized output

```ts
export interface ValidatedSlate {
  slateId: string;
  tenantId: string;
  requestId: string;
  version: number;

  sport: Sport;
  league: string;

  event: {
    eventId: string;
    name: string;
    eventDate: string;
    participants: string[];
    venue?: string;
  };

  contest: {
    draftKingsContestId: string;
    name: string;
    format: string;
    lockTime: string;
    contestSize?: number;
    requestedEntryCount: number;
    maxEntriesAllowed?: number;
  };

  salaryCap: number;

  rosterRules: RosterRules;
  scoringRules: ScoringRules;

  playerPool: SlatePlayer[];

  validation: {
    status: "VALID" | "WARNING" | "BLOCKED";
    warnings: string[];
    errors: string[];
  };

  sourceManifest: SourceManifestItem[];

  createdAt: string;
}
```

## 7.5 Validation requirements

Slate must validate:

- Sport/event match.
- Contest exists.
- Lock time is valid.
- Roster rules are complete.
- Scoring rules are complete.
- Player pool exists.
- Player IDs are unique.
- Salaries are valid.
- Roster eligibility is valid.
- Requested entries do not exceed contest maximum when known.
- Salary cap is present.
- Contest format is supported.

## 7.6 Slate status

```text
VALID
WARNING
BLOCKED
```

---

# 8. Stage 2 — Research Agent

## 8.1 Purpose

> Establish what is true right now that could materially affect the slate.

Research does not calculate projections or recommend players.

## 8.2 Seven research buckets

1. Availability
2. Recent Role / Form
3. Matchup / Environment
4. Market Signals
5. News / External Context
6. Field Sentiment
7. Competitive Context

## 8.3 Source tiers

### Tier 1 — Authoritative
- Official league
- Official team
- Official event/tournament
- Official stats
- Government weather
- Actual sportsbook markets

### Tier 2 — Trusted reporting/data
- Credentialed reporters
- Reuters/AP
- ESPN/The Athletic
- Baseball Savant
- FanGraphs
- DataGolf
- PFF
- established statistical providers

### Tier 3 — Specialist analysis
- RotoWire
- Action Network
- DFS analysis
- specialist analysts

### Tier 4 — Community / sentiment
- Reddit
- X/social
- team communities
- forums
- DFS communities

Tier 4 may inform field sentiment but cannot override factual Tier 1/2 research.

## 8.4 Source conflict logic

Resolve based on:

```text
authority × recency × specificity
```

Conflicts must remain explicit when unresolved.

## 8.5 Research plan contract

```ts
export interface ResearchQuestion {
  id: string;
  bucket: ResearchBucket;
  question: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  preferredSourceTiers: number[];
  freshnessRequirementMinutes?: number;
}

export interface ResearchPlan {
  slateId: string;
  generatedAt: string;
  questions: ResearchQuestion[];
}
```

## 8.6 Research finding

```ts
export interface ResearchFinding {
  id: string;
  bucket: ResearchBucket;

  subjectType: "PLAYER" | "TEAM" | "EVENT" | "LEAGUE";
  subjectId: string;

  finding: string;

  sourceUrl?: string;
  sourceName: string;
  sourceTier: 1 | 2 | 3 | 4;
  sourcePurpose: string;

  publishedAt?: string;
  retrievedAt: string;
  ageMinutes?: number;

  confidence: "LOW" | "MEDIUM" | "HIGH";

  conflictingFindingIds?: string[];
}
```

## 8.7 ResearchPackage

```ts
export interface ResearchPackage {
  slateId: string;
  tenantId: string;
  version: number;
  generatedAt: string;
  freshThrough: string;

  findings: ResearchFinding[];

  availability: AvailabilityResearch[];
  recentRoleForm: RoleFormResearch[];
  matchupEnvironment: MatchupEnvironmentResearch;
  marketSignals: MarketSignalResearch;
  newsExternalContext: ResearchFinding[];
  fieldSentiment: FieldSentimentResearch[];
  competitiveContext: CompetitiveContextResearch[];

  playerEvidence: PlayerEvidenceRecord[];

  conflicts: ResearchConflict[];
  unknowns: ResearchUnknown[];
  watchItems: WatchItem[];

  status: "COMPLETE" | "PARTIAL" | "BLOCKED";
}
```

## 8.8 Research Agent prompt

```text
You are the Research Agent for a DraftKings-only DFS decision engine.

Input:
ValidatedSlate

Your objective is to establish the current evidence relevant to this exact slate.

Research exactly these seven buckets:
1. Availability
2. Recent Role / Form
3. Matchup / Environment
4. Market Signals
5. News / External Context
6. Field Sentiment
7. Competitive Context

First create a sport-aware Research Plan.

For every material finding record:
- subject
- finding
- research bucket
- source
- source tier
- source purpose
- timestamp
- recency
- confidence
- conflicts
- unresolved unknowns

Source hierarchy:
Tier 1: official league/team/event/statistics sources, government weather, actual sportsbook markets
Tier 2: credentialed reporters and trusted reporting/data providers
Tier 3: specialist analysis and DFS content
Tier 4: Reddit, social communities, forums, unverified commentary

Use Tier 4 primarily for field sentiment and narrative detection.

Never treat field sentiment as authoritative factual player evidence.

When sources conflict, evaluate authority × recency × specificity.

Competitive context must capture playoff, seeding, elimination, advancement, qualification, rest, or similar situations when relevant.

Do not infer that competitive urgency changes player behavior unless there is evidence of workload, rotation, strategy, or rest changes.

Identify conflicts, unknowns, and watch items likely to change before lock.

Do not:
- calculate fantasy projections
- modify opportunity
- rank DFS plays
- generate lineups

Return a ResearchPackage with status:
COMPLETE
PARTIAL
BLOCKED
```

---

# 9. Stage 3 — Sport Adjustment

## 9.1 Architecture

```text
ValidatedSlate + ResearchPackage
             ↓
       Sport Router
             ↓
┌────────────┼───────────────┐
│            │               │
Basketball   MLB            Golf
Specialist   Specialist      Specialist
│            │               │
└────────────┼───────────────┘
             ↓
   Adjustment Validator
             ↓
     AdjustmentPackage
```

NFL is implemented as an additional specialist on the same contract.

## 9.2 Important rule

Sport Adjustment specialists must not independently browse by default.

They reason from `ResearchPackage`.

When evidence is missing they emit:

```ts
export interface ResearchGap {
  question: string;
  importance: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  reason: string;
  affectedPlayerIds: string[];
}
```

The Orchestrator routes the gap to Research.

## 9.3 Adjustment values

Direction:

```text
UP
DOWN
NEUTRAL
```

Magnitude:

```text
NONE
SMALL
MODERATE
MATERIAL
MAJOR
```

Confidence:

```text
LOW
MEDIUM
HIGH
```

## 9.4 PlayerAdjustment

```ts
export interface PlayerAdjustment {
  playerId: string;

  baselineContext: Record<string, unknown>;

  adjustments: {
    adjustmentType: string;
    direction: "UP" | "DOWN" | "NEUTRAL";
    magnitude: "NONE" | "SMALL" | "MODERATE" | "MATERIAL" | "MAJOR";
    rationale: string;
    evidenceFindingIds: string[];
    confidence: "LOW" | "MEDIUM" | "HIGH";
  }[];

  competitiveContext?: {
    impact: "UP" | "DOWN" | "NEUTRAL";
    rationale: string;
    confidence: "LOW" | "MEDIUM" | "HIGH";
  };

  netOpportunityDirection:
    | "MATERIALLY_UP"
    | "SLIGHTLY_UP"
    | "NEUTRAL"
    | "SLIGHTLY_DOWN"
    | "MATERIALLY_DOWN";

  roleCertainty: "LOW" | "MEDIUM" | "HIGH";

  keyDeltas: string[];
  projectionNotes: string[];
}
```

## 9.5 Basketball specialist rules

Priority:

1. Expected minutes
2. Starting/closing role
3. Usage
4. Ball-handling / assist creation
5. Rebounding opportunity
6. Steal/block opportunity
7. Pace
8. Matchup
9. Rest/fatigue/travel
10. Competitive context

When players are unavailable, explicitly evaluate redistribution of:

- minutes
- usage
- ball handling
- assists
- rebounds
- closing-lineup role

Active != unrestricted workload.

### Basketball prompt

```text
You are the Basketball Sport Adjustment Specialist for WNBA and NBA DraftKings contests.

Your primary objective is to determine how current evidence changes player opportunity.

Reason in this priority order:
1. Expected minutes
2. Starting and closing role
3. Usage
4. Ball-handling / assist creation
5. Rebounding opportunity
6. Steal/block opportunity
7. Pace and possession environment
8. Matchup characteristics
9. Rest, travel, back-to-back, and recent workload
10. Competitive context

Minutes are the highest-priority variable.

When a player becomes unavailable, explicitly evaluate redistribution of:
- minutes
- usage
- ball-handling
- assists
- rebounds
- closing-lineup role

When a player returns from injury, distinguish ACTIVE from NORMAL WORKLOAD.

Prefer current-role samples over season averages when a structural role change explains the difference.

Competitive context may adjust rotation depth, star minutes, closing role certainty, or rest behavior only when supported by evidence.

Return structured adjustments only.
Do not calculate DraftKings fantasy points.
```

## 9.6 MLB specialist rules

Priority:

1. Confirmed batting order
2. Expected plate appearances
3. Handedness
4. Starting pitcher quality
5. Pitch-type matchup
6. Quality of contact
7. K/BB environment
8. Home run environment
9. Bullpen quality/availability
10. Pitcher workload/leash
11. Park/weather
12. Competitive context

### MLB prompt

```text
You are the MLB Sport Adjustment Specialist for DraftKings contests.

For hitters evaluate:
1. Confirmed batting-order position
2. Expected plate appearances
3. Platoon/handedness matchup
4. Opposing starting-pitcher quality
5. Pitch-type matchup
6. Barrel rate, hard-hit rate, xwOBA/xSLG where available
7. Strikeout and walk environment
8. Home-run environment
9. Bullpen quality and availability
10. Park and weather

For pitchers evaluate:
1. Expected pitch count
2. Expected innings
3. Strikeout opportunity
4. Opponent strikeout profile
5. Run-prevention environment
6. Managerial leash
7. Bullpen context

Do not boost a hitter solely because they recently homered.
Bullpen fatigue must be represented as late-game offensive opportunity.

Return adjustments only.
```

## 9.7 Golf specialist rules

Priority:

1. Strokes gained
2. Tee-to-green
3. Approach
4. Off-the-tee
5. Putting
6. Birdie-or-better
7. Bogey avoidance
8. Par-5 scoring
9. Course fit
10. Tee-time weather wave
11. Course conditions
12. Leaderboard position
13. Round-specific form
14. Finishing-position implications
15. Competitive/qualification context

### Golf prompt

```text
You are the Golf Sport Adjustment Specialist for DraftKings contests.

Translate tournament, course, leaderboard, and weather evidence into round-specific player adjustments.

For Showdown, prioritize today's scoring opportunity over generic season ranking.

For final rounds separately evaluate:
- chase aggression
- protect-the-lead behavior
- leaderboard movement potential
- finishing-position equity

Weather must be tied to each golfer's actual playing window.

Return adjustments only.
Do not calculate final DK fantasy points.
```

## 9.8 NFL specialist rules

Priority:

1. Snap share
2. Routes
3. Targets
4. Carries
5. Red-zone role
6. QB efficiency
7. OL/DL matchup
8. Pace
9. Game script / pass rate
10. Weather
11. Injury-driven redistribution
12. Competitive context

---

# 10. Stage 4 — Projection Service

## 10.1 Classification

Hybrid quantitative service.

AI is limited to input interpretation when deterministic mappings are insufficient.

## 10.2 Architecture

```text
ValidatedSlate
ResearchPackage
AdjustmentPackage
      ↓
Projection Input Mapper
      ↓
Sport Projection Model
      ↓
Simulation
      ↓
DraftKings Scoring Engine
      ↓
ProjectionPackage
```

## 10.3 Mandatory rule

> No fantasy projection may exist without an explicit opportunity assumption.

## 10.4 Standard percentile definitions

```text
Floor   = P20
Median  = P50
Ceiling = P90
```

## 10.5 PlayerProjection

```ts
export interface PlayerProjection {
  playerId: string;
  salary: number;

  baselineOpportunity: Record<string, number>;
  adjustedOpportunity: Record<string, number>;
  opportunityDelta: Record<string, number>;

  componentProjection: Record<string, number>;

  projectedOutcomes: {
    floorP20: number;
    medianP50: number;
    ceilingP90: number;
  };

  salaryEfficiency: {
    medianPer1k: number;
    ceilingPer1k: number;
  };

  confidence: "LOW" | "MEDIUM" | "HIGH";

  uncertaintyFactors: string[];
  watchDependencies: string[];

  modelVersion: string;
}
```

## 10.6 Basketball model

Inputs:

- Expected minutes
- Usage
- Assist rate
- Rebound rate
- Steal rate
- Block rate
- Turnover rate
- Three-point rate
- Pace
- Matchup adjustment

Project:

- points
- threes
- rebounds
- assists
- steals
- blocks
- turnovers
- DD probability
- TD probability

## 10.7 MLB model

### Hitters
Inputs:

- Expected PA
- outcome probabilities by PA
- pitcher handedness
- pitcher quality
- bullpen
- park/weather
- stolen base opportunity

### Pitchers
Inputs:

- pitch count
- innings
- K rate
- BB rate
- HR rate
- run prevention
- opponent
- win/QS probability

## 10.8 Golf model

Simulate 18-hole outcomes based on:

- SG components
- birdie rate
- eagle probability
- bogey rates
- course fit
- weather wave
- leaderboard context
- finishing position distribution when scoring applies

## 10.9 NFL model

Inputs:

- snaps
- routes
- targets
- carries
- red-zone work
- catch rate
- YPT
- YPC
- TD probability
- game environment

## 10.10 Projection interpreter prompt

```text
You are the Projection Input Interpreter for a DraftKings DFS engine.

You do not independently create final fantasy projections.

Inputs:
ValidatedSlate
ResearchPackage
AdjustmentPackage

Translate structured sport adjustments into explicit quantitative model assumptions only when deterministic mappings are insufficient.

For every interpreted assumption:
- identify baseline
- identify adjustment
- produce numerical assumption or range
- cite the adjustment/evidence
- assign uncertainty

Do not:
- invent unsupported opportunities
- directly assign DraftKings fantasy points
- build lineups
- rank players
```

---

# 11. Stage 5 — Optimize Service

## 11.1 Classification

Deterministic optimization/simulation service.

No AI agent.

## 11.2 Architecture

```text
ValidatedSlate
ProjectionPackage
AdjustmentPackage
ResearchPackage
      ↓
Constraint Builder
      ↓
Lineup Generator
      ↓
Joint Simulation / Correlation
      ↓
Field Model
      ↓
Duplication Model
      ↓
Objective Scoring
      ↓
Candidate Ranker
      ↓
OptimizerPackage
```

## 11.3 Required metrics

Per lineup:

- Salary used
- Salary remaining
- Floor
- Median
- Ceiling
- Correlation score
- Optimal lineup frequency
- Top-1% lineup frequency
- Ownership estimate
- Leverage
- Duplication risk
- Game-script cluster
- Strategic similarity
- Risk flags

## 11.4 Candidate categories

- HIGHEST_MEDIAN
- HIGHEST_CEILING
- BEST_TOURNAMENT_EV
- LEVERAGE
- LOW_DUPLICATION
- ALTERNATE_GAME_SCRIPT

Categories may point to the same lineup.

Do not create artificial diversity.

## 11.5 Contest objective profiles

Configuration must support different objective weights based on:

- Contest size
- Requested entries
- Maximum entries
- Contest format

Weights must be configurable, not hard-coded into the UI.

---

# 12. Stage 6 — Selection Agent

## 12.1 Purpose

> Choose final optimizer candidates and present them to the user.

Selection cannot create new lineups.

If the candidate set is insufficient, it must emit `OPTIMIZER_GAP`.

## 12.2 Tone

Selection must sound like:

> **A friendly, knowledgeable sports expert who knows the slate cold.**

Tone:

- conversational
- concise
- analytical
- practical
- confident but never falsely certain
- no hype
- no “lock of the century”
- explain the why in plain English
- lineup first, reasoning second

## 12.3 Selection prompt

```text
You are the Selection Agent for a DraftKings-only DFS decision engine.

Inputs:
- ValidatedSlate
- ResearchPackage
- AdjustmentPackage
- ProjectionPackage
- OptimizerPackage

Choose the final lineup or lineup portfolio only from OptimizerPackage.

For each decision consider:
- contest size
- user entry count
- maximum entries allowed
- lineup median
- lineup ceiling
- optimal lineup frequency
- tournament rank
- leverage
- duplication risk
- correlation
- game-script plausibility
- projection confidence
- role certainty
- unresolved watch items

For ONE entry:
Choose the strongest realistic path to winning the specific contest.
Do not automatically choose highest median.
Avoid unnecessary fragility when projection differences are small.

For MULTIPLE entries:
Select a portfolio, not the top N lineups.
Prefer materially different game scripts or leverage profiles.
Avoid redundant lineups unless the mathematical advantage clearly justifies overlap.

Never:
- modify projections
- invent ownership
- create a new lineup
- alter DK rules
- ignore unresolved critical watch items
- silently change an ENTERED lineup

If the candidate set is insufficient, return OPTIMIZER_GAP.

VOICE:
You are a friendly, knowledgeable sports expert.
Sound like someone who understands the sport, DFS strategy, and this slate deeply.
Be concise and grounded.
Explain decisions in plain English.
Never use exaggerated gambling language or fake certainty.
Lead with the lineup.
Then explain the most important reasons.
```

---

# 13. Stage 7 — Learning Loop

## 13.1 Classification

Hybrid.

### Deterministic
- watch item schedules
- change events
- version snapshots
- actual DK scoring
- projection error
- contest finish
- payout
- ROI
- status transitions

### AI
- error diagnosis
- stage attribution
- lesson candidate creation
- qualitative game-script comparison

## 13.2 EnteredLineup

```ts
export interface EnteredLineup {
  id: string;
  tenantId: string;
  slateId: string;
  lineupId: string;
  bulletNumber: number;
  enteredAt: string;

  projectionSnapshot: {
    floor: number;
    median: number;
    ceiling: number;
  };

  researchVersion: number;
  adjustmentVersion: number;
  projectionVersion: number;
  optimizerVersion: number;
  selectionVersion: number;
}
```

## 13.3 Pre-lock decisions

```text
KEEP
ADJUST
REBUILD
```

Never silently mutate an entered lineup.

## 13.4 Learning prompt

```text
You are the Learning & Diagnosis Agent for a DraftKings DFS decision engine.

PRE-LOCK:
When a material change is detected, identify the earliest affected engine stage and recommend:
KEEP
ADJUST
REBUILD

Never silently alter an ENTERED lineup.

POST-CONTEST:
Compare:
- projected opportunity vs actual opportunity
- projected components vs actual stats
- projected DK distribution vs actual DK
- intended game script vs observed game
- selected lineup vs optimizer alternatives

Classify meaningful errors:
RESEARCH
SPORT_ADJUSTMENT
PROJECTION
OPTIMIZE
SELECTION
VARIANCE

Do not infer model failure solely because a lineup lost.

For each diagnosis:
- state the assumption
- state what happened
- identify earliest responsible stage
- cite measurements
- assign confidence

Create Lesson Candidates only when findings could generalize.

Lesson states:
OBSERVED
ACCUMULATING
VALIDATED
REJECTED

Only VALIDATED lessons may change future rules.
```

---

# 14. Multi-Tenant Data Architecture

## 14.1 General tenancy model

Use shared Postgres tables with mandatory `tenant_id`.

All tenant-owned tables must have:

```sql
tenant_id uuid not null references tenants(id)
```

RLS must enforce:

```text
authenticated user
→ tenant membership
→ tenant scoped rows only
```

Do not use schema-per-tenant.

## 14.2 Core identity tables

### `tenants`

```sql
create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  plan text not null default 'standard',
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### `tenant_memberships`

```sql
create table tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);
```

---

# 15. Sports Engine Database Schema

## 15.1 DraftKings contests

### `dk_contests`

```sql
create table dk_contests (
  id uuid primary key default gen_random_uuid(),

  dk_contest_id text not null,
  sport text not null,
  league text not null,
  contest_name text not null,
  contest_format text not null,

  event_name text not null,
  event_date timestamptz not null,
  lock_time timestamptz not null,

  contest_size integer,
  max_entries_allowed integer,

  salary_cap integer not null,

  roster_rules jsonb not null,
  scoring_rules jsonb not null,

  raw_payload jsonb,
  source_type text not null,

  status text not null default 'active',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(dk_contest_id)
);
```

Contest definitions are provider-level and may be shared across tenants.

## 15.2 Player pool

### `dk_contest_players`

```sql
create table dk_contest_players (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references dk_contests(id) on delete cascade,

  dk_player_id text,
  player_name text not null,
  team text,
  opponent text,
  position text,

  salary integer not null,
  captain_salary integer,
  utility_salary integer,

  eligibility jsonb not null default '{}',
  provider_status text,
  provider_fppg numeric,

  raw_payload jsonb,

  created_at timestamptz not null default now(),

  unique(contest_id, dk_player_id)
);
```

---

# 16. Tenant Run Tables

## 16.1 `generation_runs`

```sql
create table generation_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  contest_id uuid not null references dk_contests(id),

  requested_entry_count integer not null,

  state text not null check (
    state in (
      'created',
      'slate_validated',
      'researching',
      'adjusting',
      'projecting',
      'optimizing',
      'selecting',
      'ready',
      'blocked',
      'failed',
      'complete'
    )
  ),

  current_stage text,
  error jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

## 16.2 `slate_versions`

```sql
create table slate_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  generation_run_id uuid not null references generation_runs(id) on delete cascade,

  version integer not null,
  payload jsonb not null,
  validation_status text not null,

  created_at timestamptz not null default now(),

  unique(generation_run_id, version)
);
```

## 16.3 `research_runs`

```sql
create table research_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  generation_run_id uuid not null references generation_runs(id) on delete cascade,

  version integer not null,
  research_plan jsonb not null,
  research_package jsonb not null,

  status text not null,
  model_name text,
  prompt_version text,

  created_at timestamptz not null default now(),

  unique(generation_run_id, version)
);
```

## 16.4 `research_findings`

Use normalized rows for searchability/learning.

```sql
create table research_findings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  research_run_id uuid not null references research_runs(id) on delete cascade,

  bucket text not null,
  subject_type text not null,
  subject_id text not null,

  finding text not null,

  source_name text not null,
  source_url text,
  source_tier integer not null,
  source_purpose text,

  published_at timestamptz,
  retrieved_at timestamptz not null,

  confidence text not null,

  metadata jsonb not null default '{}'
);
```

## 16.5 `adjustment_runs`

```sql
create table adjustment_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  generation_run_id uuid not null references generation_runs(id) on delete cascade,

  version integer not null,
  sport text not null,
  adjustment_package jsonb not null,

  status text not null,
  model_name text,
  prompt_version text,

  created_at timestamptz not null default now(),

  unique(generation_run_id, version)
);
```

## 16.6 `player_adjustments`

```sql
create table player_adjustments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  adjustment_run_id uuid not null references adjustment_runs(id) on delete cascade,
  contest_player_id uuid not null references dk_contest_players(id),

  adjustment_type text not null,
  direction text not null,
  magnitude text not null,
  confidence text not null,

  rationale text not null,
  evidence_finding_ids uuid[],

  metadata jsonb not null default '{}'
);
```

## 16.7 `projection_runs`

```sql
create table projection_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  generation_run_id uuid not null references generation_runs(id) on delete cascade,

  version integer not null,
  sport text not null,
  model_version text not null,

  simulation_runs integer,
  random_seed bigint,

  projection_package jsonb not null,
  status text not null,

  created_at timestamptz not null default now(),

  unique(generation_run_id, version)
);
```

## 16.8 `player_projections`

```sql
create table player_projections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  projection_run_id uuid not null references projection_runs(id) on delete cascade,
  contest_player_id uuid not null references dk_contest_players(id),

  baseline_opportunity jsonb not null,
  adjusted_opportunity jsonb not null,
  component_projection jsonb not null,

  floor_p20 numeric not null,
  median_p50 numeric not null,
  ceiling_p90 numeric not null,

  median_per_1k numeric,
  ceiling_per_1k numeric,

  confidence text not null,
  uncertainty_factors jsonb not null default '[]',

  created_at timestamptz not null default now()
);
```

## 16.9 `optimization_runs`

```sql
create table optimization_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  generation_run_id uuid not null references generation_runs(id) on delete cascade,

  version integer not null,

  optimizer_version text not null,
  simulation_runs integer,
  objective_profile jsonb not null,

  summary jsonb not null,
  status text not null,

  created_at timestamptz not null default now(),

  unique(generation_run_id, version)
);
```

## 16.10 `lineup_candidates`

```sql
create table lineup_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  optimization_run_id uuid not null references optimization_runs(id) on delete cascade,

  salary_used integer not null,
  salary_remaining integer not null,

  floor numeric,
  median numeric,
  ceiling numeric,

  optimal_frequency numeric,
  top_one_percent_frequency numeric,

  ownership_estimate numeric,
  leverage_score numeric,

  duplication_risk text,
  estimated_duplicates numeric,

  median_rank integer,
  ceiling_rank integer,
  tournament_rank integer,

  candidate_types text[] not null default '{}',
  game_script_cluster text,

  risk_flags jsonb not null default '[]',

  created_at timestamptz not null default now()
);
```

## 16.11 `lineup_candidate_players`

```sql
create table lineup_candidate_players (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  lineup_candidate_id uuid not null references lineup_candidates(id) on delete cascade,
  contest_player_id uuid not null references dk_contest_players(id),

  roster_slot text not null,
  salary integer not null,

  unique(lineup_candidate_id, contest_player_id)
);
```

## 16.12 `selection_runs`

```sql
create table selection_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  generation_run_id uuid not null references generation_runs(id) on delete cascade,

  version integer not null,

  selection_package jsonb not null,
  decision_status text not null,

  model_name text,
  prompt_version text,

  created_at timestamptz not null default now(),

  unique(generation_run_id, version)
);
```

## 16.13 `generated_lineups`

```sql
create table generated_lineups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  generation_run_id uuid not null references generation_runs(id) on delete cascade,
  selection_run_id uuid not null references selection_runs(id),
  lineup_candidate_id uuid not null references lineup_candidates(id),

  bullet_number integer not null,

  status text not null default 'GENERATED'
    check (status in ('GENERATED','ENTERED')),

  selection_type text,
  game_script text,
  why_selected text,
  primary_risk text,

  floor numeric,
  median numeric,
  ceiling numeric,

  entered_at timestamptz,

  created_at timestamptz not null default now()
);
```

---

# 17. Learning Tables

## 17.1 `watch_items`

```sql
create table watch_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  generation_run_id uuid not null references generation_runs(id) on delete cascade,

  subject text not null,
  importance text not null,

  current_state jsonb,
  trigger_condition jsonb,

  affected_player_ids uuid[] not null default '{}',
  affected_lineup_ids uuid[] not null default '{}',

  expected_update_at timestamptz,

  status text not null default 'active',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

## 17.2 `change_events`

```sql
create table change_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  generation_run_id uuid not null references generation_runs(id),

  event_type text not null,
  subject text not null,

  previous_state jsonb,
  new_state jsonb,

  materiality text not null,
  source jsonb,

  detected_at timestamptz not null default now()
);
```

## 17.3 `lock_snapshots`

```sql
create table lock_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  generated_lineup_id uuid not null references generated_lineups(id),

  locked_at timestamptz not null,

  lineup_payload jsonb not null,
  projection_snapshot jsonb not null,
  game_script text,
  risk_flags jsonb,

  research_version integer not null,
  adjustment_version integer not null,
  projection_version integer not null,
  optimization_version integer not null,
  selection_version integer not null
);
```

## 17.4 `contest_results`

```sql
create table contest_results (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  generated_lineup_id uuid not null references generated_lineups(id),

  actual_dk_points numeric,
  finish_position integer,
  finish_percentile numeric,
  payout numeric,
  roi numeric,

  result_payload jsonb,

  measured_at timestamptz not null default now()
);
```

## 17.5 `player_measurements`

```sql
create table player_measurements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  generated_lineup_id uuid not null references generated_lineups(id),
  contest_player_id uuid not null references dk_contest_players(id),

  projected_opportunity jsonb,
  actual_opportunity jsonb,

  projected_floor numeric,
  projected_median numeric,
  projected_ceiling numeric,
  actual_dk numeric,

  projection_error numeric,
  within_expected_range boolean,

  created_at timestamptz not null default now()
);
```

## 17.6 `learning_diagnostics`

```sql
create table learning_diagnostics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  generation_run_id uuid not null references generation_runs(id),

  subject_type text not null,
  subject_id text not null,

  error_stage text not null,
  severity text,
  confidence text not null,

  assumption text,
  actual_outcome text,
  evidence jsonb,

  diagnosis text not null,

  created_at timestamptz not null default now()
);
```

## 17.7 `lesson_candidates`

```sql
create table lesson_candidates (
  id uuid primary key default gen_random_uuid(),

  sport text not null,
  stage text not null,

  observation text not null,
  proposed_change text,

  status text not null check (
    status in ('OBSERVED','ACCUMULATING','VALIDATED','REJECTED')
  ),

  sample_count integer not null default 1,
  confidence text,

  evidence jsonb not null default '[]',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Validated lessons may be global model assets rather than tenant-specific user data.

---

# 18. RLS Requirements

## 18.1 Tenant membership helper

```sql
create or replace function is_tenant_member(target_tenant uuid)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1
    from tenant_memberships
    where tenant_id = target_tenant
      and user_id = auth.uid()
  );
$$;
```

## 18.2 Standard tenant policy

Apply to every tenant-owned table:

```sql
create policy "tenant_select"
on generated_lineups
for select
using (is_tenant_member(tenant_id));

create policy "tenant_insert"
on generated_lineups
for insert
with check (is_tenant_member(tenant_id));

create policy "tenant_update"
on generated_lineups
for update
using (is_tenant_member(tenant_id))
with check (is_tenant_member(tenant_id));
```

Equivalent policies are required for all tenant-owned engine tables.

## 18.3 Service role

Supabase Edge Functions performing engine work may use service-role credentials server-side only.

Never expose service-role credentials to Vercel client bundles.

---

# 19. Supabase Edge Functions

Recommended boundaries:

```text
ingest-dk-contests
parse-dk-screenshot
create-generation-run
run-research
run-sport-adjustment
run-projection
run-optimizer
run-selection
mark-lineup-entered
learning-recheck
capture-lock-snapshot
ingest-contest-results
run-learning-diagnosis
```

## 19.1 `create-generation-run`

Input:

```json
{
  "contestId": "...",
  "requestedEntryCount": 2
}
```

Responsibilities:

1. Validate tenant/user.
2. Create generation run.
3. Build/verify Slate.
4. Invoke asynchronous engine workflow.
5. Return run ID.

## 19.2 Long-running execution

Do not require a single synchronous HTTP request to complete the entire engine.

Use persisted run state and stage jobs.

```text
Create Run
→ persist
→ invoke Research
→ persist
→ invoke Adjustment
→ persist
→ invoke Projection
→ persist
→ invoke Optimize
→ persist
→ invoke Selection
→ mark ready
```

The UI polls or subscribes to run state.

---

# 20. Async Job Model

Supabase database tables should represent durable work.

### `engine_jobs`

```sql
create table engine_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  generation_run_id uuid not null references generation_runs(id),

  stage text not null,
  status text not null check (
    status in ('queued','running','succeeded','failed','cancelled')
  ),

  attempt integer not null default 0,
  max_attempts integer not null default 3,

  input_payload jsonb,
  output_ref jsonb,
  error jsonb,

  available_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,

  created_at timestamptz not null default now()
);
```

Worker functions claim jobs transactionally.

Idempotency is mandatory.

---

# 21. Frontend Architecture

## 21.1 Framework

- Next.js
- React
- TypeScript
- Mobile-first responsive layout
- PWA manifest
- Supabase Auth client
- Server-side authenticated API calls
- Realtime subscriptions for generation run updates

## 21.2 Primary routes

```text
/login
/
/sports
/sports/:sport/contests
/contests/:contestId
/runs/:runId
/lineups
/lineups/:lineupId
/history
/results/:lineupId
/settings
```

## 21.3 Core user flow

```text
Home
  ↓
Select Sport
  ↓
Select DraftKings Contest
  ↓
Choose number of lineups
  ↓
Generate
  ↓
Progress
  ↓
Final lineup cards
  ↓
Copy lineup
  ↓
Lineup Entered
  ↓
Monitoring
  ↓
Results / Learning
```

---

# 22. Mobile UI Requirements

## 22.1 Sport selection

Card/grid interface.

```text
Choose Sport

[ WNBA ]
[ NBA  ]
[ MLB  ]
[ GOLF ]
[ NFL  ]
```

## 22.2 Contest selection

Contest card must show:

- Contest name
- Event
- Lock time
- Contest size if known
- Maximum entries if known
- Contest format

## 22.3 Generate screen

Inputs:

- Number of requested lineups

System-derived fields should be displayed but not editable when provider-authoritative.

Primary CTA:

```text
[ Generate Lineups ]
```

## 22.4 Generation progress

Do not expose agent names.

Display meaningful state:

```text
✓ Contest verified
✓ Latest player news checked
✓ Projections updated
✓ 18,427 lineups evaluated
Selecting your lineup…
```

## 22.5 Final lineup card

```text
IND vs CHI
7:00 PM ET • 1 Bullet • 1,200 Entries

FINAL LINEUP

CPT  Caitlin Clark        $18,300
UTIL Kamilla Cardoso      $10,400
UTIL Kelsey Mitchell      $10,200
UTIL Makayla Timpson       $6,200
UTIL Lexie Hull            $2,400
UTIL Gabriela Jaquez       $2,200

$49,700 / $50,000

Median 182
Ceiling 243

Why:
Best one-bullet balance of ceiling,
correlation and duplication.

Risk:
Jaquez minutes.

[ Copy Lineup ]
[ Lineup Entered ]
```

## 22.6 Progressive disclosure

Layer 1:
- Final lineup
- salary
- median/ceiling
- actions

Layer 2:
- why selected
- primary risk
- watch items

Layer 3:
- player reasoning
- research findings
- projections
- sources

## 22.7 Multi-entry UI

Use tabs/cards:

```text
[ Bullet 1 ] [ Bullet 2 ] [ Bullet 3 ]
```

Show:

- overlap
- strategic difference
- game-script difference

Avoid stacking full cards vertically.

---

# 23. Selection UI Statuses

```text
READY
READY_WITH_WATCH
HOLD
REBUILD_REQUIRED
```

`REBUILD_REQUIRED` is primarily triggered by Learning Loop.

---

# 24. Learning Loop Mobile UI

## 24.1 Pre-lock

Normal state:

```text
✓ Lineup current
Monitoring for material changes
```

Alert:

```text
⚠ Lineup update

Player X ruled out.
Your entered lineup is no longer the preferred build.

REBUILD recommended

[ View New Lineup ]
```

## 24.2 Post-contest

```text
BULLET 1 RESULT

Projected Median  182
Actual            196
Finish            Top 8%

WHAT WORKED
✓ Minutes assumptions
✓ Cardoso rebounding
✓ Competitive game script

WHAT MISSED
• Hull minutes -5 vs projection

ENGINE DIAGNOSIS
Normal variance
No model rule change recommended
```

---

# 25. DraftKings Ingestion Requirements

The integration layer must be abstracted behind an interface:

```ts
export interface DraftKingsProvider {
  listSports(): Promise<Sport[]>;
  listContests(sport: Sport): Promise<DraftKingsContest[]>;
  getContest(id: string): Promise<DraftKingsContest>;
  getPlayerPool(id: string): Promise<DraftKingsPlayer[]>;
  getScoringRules(id: string): Promise<ScoringRules>;
  getRosterRules(id: string): Promise<RosterRules>;
}
```

Implementations:

```text
DraftKingsFeedProvider
DraftKingsScreenshotProvider
```

The rest of the engine must not depend on how provider data was obtained.

---

# 26. Screenshot Ingestion

If DraftKings structured data is unavailable, allow the user to upload screenshots.

Flow:

```text
Upload screenshots
→ Supabase Storage
→ extraction service
→ DraftKings-specific schema parser
→ confidence checks
→ Slate validation
```

Low-confidence extraction must be surfaced as `WARNING` or `BLOCKED`.

Do not guess unreadable salaries.

---

# 27. External Research Integration

The Research layer should support pluggable tools.

```ts
export interface ResearchTool {
  search(query: ResearchQuery): Promise<ResearchSourceResult[]>;
}
```

Suggested capability classes:

- web search
- official league source
- sportsbook odds
- weather
- statistics provider
- social/Reddit search

Each result must be normalized into the Research source contract.

---

# 28. Prompt Management

Prompts must not be hard-coded directly into function source.

### `prompt_templates`

```sql
create table prompt_templates (
  id uuid primary key default gen_random_uuid(),

  prompt_key text not null,
  sport text,
  version text not null,

  system_prompt text not null,
  developer_prompt text,
  schema_version text not null,

  active boolean not null default false,

  created_at timestamptz not null default now(),

  unique(prompt_key, sport, version)
);
```

Examples:

```text
research.v1
sport_adjustment.basketball.v1
sport_adjustment.mlb.v1
sport_adjustment.golf.v1
sport_adjustment.nfl.v1
projection_interpreter.v1
selection.v1
learning_diagnosis.v1
```

Every run persists prompt version.

---

# 29. Model Configuration

### `model_configs`

```sql
create table model_configs (
  id uuid primary key default gen_random_uuid(),
  config_key text unique not null,

  provider text not null,
  model_name text not null,

  temperature numeric,
  max_output_tokens integer,

  settings jsonb not null default '{}',

  active boolean not null default true,

  created_at timestamptz not null default now()
);
```

Do not couple prompts to one model implementation.

---

# 30. Observability

Every stage must emit:

- run ID
- tenant ID
- stage
- version
- started_at
- completed_at
- duration
- status
- token usage where applicable
- tool usage count
- error
- retry count

### `engine_events`

```sql
create table engine_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id),
  generation_run_id uuid references generation_runs(id),

  event_type text not null,
  stage text,

  payload jsonb not null default '{}',

  created_at timestamptz not null default now()
);
```

---

# 31. Security Requirements

## SEC-001
All tenant data must be protected by RLS.

## SEC-002
Supabase service-role keys are server-side only.

## SEC-003
LLM prompts must never receive unrelated tenant data.

## SEC-004
Uploaded screenshots use tenant-scoped storage paths.

Example:

```text
/{tenant_id}/draftkings/{user_id}/{asset_id}.png
```

## SEC-005
Agent outputs must be schema-validated before persistence.

## SEC-006
All external research content is untrusted input and must not be allowed to override system prompts.

## SEC-007
Research agents must treat retrieved instructions as source content, not operational instructions.

## SEC-008
Every generated/entered lineup must be traceable to exact stage versions.

---

# 32. Performance Requirements

## PERF-001
Slate validation target: < 2 seconds for structured DK data.

## PERF-002
UI must immediately return a run ID after generation request.

## PERF-003
Long research/model work runs asynchronously.

## PERF-004
UI should receive state updates via Realtime or polling.

## PERF-005
Optimizer must support exhaustive enumeration for small Showdown player pools.

## PERF-006
Optimizer must support constrained optimization for large Classic slates.

## PERF-007
Simulation runs must be configurable by environment:

```text
development: 1,000
staging: 5,000
production: 10,000+
```

Tune by latency/cost.

---

# 33. Reliability Requirements

## REL-001
Every stage is idempotent against `(generation_run_id, stage_version)`.

## REL-002
Jobs support retry.

## REL-003
No stage may overwrite historical versions.

## REL-004
Entered lineups retain immutable lock snapshots.

## REL-005
Partial research uncertainty must be represented rather than silently filled.

## REL-006
If critical DraftKings scoring/roster data is missing, generation must block.

---

# 34. Testing Strategy

## 34.1 Unit tests

### Slate
- salary parsing
- roster validation
- scoring rule normalization
- entry max validation
- duplicate player validation

### Projection
- DK scoring
- percentile outputs
- sport-specific component math
- deterministic seed behavior

### Optimize
- salary cap
- roster legality
- captain multipliers
- candidate ranking
- overlap
- duplication rules

### Learning
- projection error
- stage attribution data
- lock snapshot

## 34.2 Contract tests

Every stage must validate input/output schemas.

Use Zod or equivalent.

```ts
ValidatedSlateSchema.parse(output);
ResearchPackageSchema.parse(output);
AdjustmentPackageSchema.parse(output);
ProjectionPackageSchema.parse(output);
OptimizerPackageSchema.parse(output);
SelectionPackageSchema.parse(output);
```

## 34.3 Agent evals

### Research evals
- detects official injury update
- separates social sentiment from fact
- properly represents conflict
- does not project players

### Adjustment evals
- injury redistribution
- active vs unrestricted distinction
- competitive context neutrality when no behavioral evidence
- sport-specific reasoning

### Selection evals
- does not invent lineup
- one-bullet behavior
- multi-bullet diversification
- respects duplication risk
- concise knowledgeable tone

### Learning evals
- correctly attributes variance
- does not overfit one result
- routes rerun to earliest affected stage

---

# 35. Example End-to-End State

```text
Run created
  ↓
Slate v1 VALID
  ↓
Research v1 PARTIAL
  └── watch Carrington workload
  ↓
Adjustment v1
  ↓
Projection v1
  ↓
Optimize v1
  ↓
Selection v1 READY_WITH_WATCH
  ↓
Lineup A GENERATED
  ↓
User taps LINEUP ENTERED
  ↓
Lineup A ENTERED
  ↓
Research change event:
Carrington unrestricted
  ↓
Learning impact map
  ↓
Rerun from Research
  ↓
Research v2
Adjustment v2
Projection v2
Optimize v2
Selection v2
  ↓
Learning result:
REBUILD
  ↓
UI alerts user
```

---

# 36. Vercel Deployment

## 36.1 Vercel responsibilities

Deploy:

- Next.js web app
- public/static assets
- authenticated UI routes
- lightweight API route handlers
- server-side rendering

## 36.2 Supabase responsibilities

- Postgres
- Auth
- RLS
- Storage
- Realtime
- Edge Functions
- durable engine state
- job queue tables
- orchestration state
- result persistence

Avoid relying on long-running Vercel request lifetimes for research, simulation, or multi-stage workflows.

---

# 37. Environment Separation

Required environments:

```text
local
development
staging
production
```

Each environment gets separate:

- Supabase project/database
- API keys
- LLM credentials
- research provider credentials
- prompt activation
- projection model configuration
- optimization settings

Do not test production prompts directly on live user runs without versioning.

---

# 38. Suggested Repository Structure

```text
/apps
  /web
    /app
    /components
    /features
      /sports
      /contests
      /generation
      /lineups
      /learning

/packages
  /contracts
    slate.ts
    research.ts
    adjustment.ts
    projection.ts
    optimizer.ts
    selection.ts
    learning.ts

  /draftkings
    provider.ts
    feed-provider.ts
    screenshot-provider.ts

  /research
    planner.ts
    normalizer.ts
    sources.ts

  /sport-adjustment
    basketball.ts
    mlb.ts
    golf.ts
    nfl.ts

  /projection
    basketball
    mlb
    golf
    nfl
    scoring

  /optimizer
    constraints
    simulation
    field-model
    duplication
    rankings

  /selection
    selection-agent.ts

  /learning
    monitoring
    measurement
    diagnosis

  /database
    supabase.ts
    types.ts

/supabase
  /functions
  /migrations
  /seed
```

---

# 39. TypeScript Contract Package

All stages must depend on a shared `@sports-engine/contracts` package.

No stage may invent its own private version of shared objects.

Key exports:

```ts
ValidatedSlate
ResearchPlan
ResearchPackage
ResearchFinding
ResearchGap
AdjustmentPackage
PlayerAdjustment
ProjectionPackage
PlayerProjection
OptimizerPackage
LineupCandidate
SelectionPackage
GeneratedLineup
EnteredLineup
WatchItem
ChangeEvent
LearningDiagnosis
LessonCandidate
```

---

# 40. API Surface

Suggested application APIs:

```text
GET  /api/sports
GET  /api/contests?sport=WNBA
GET  /api/contests/:id

POST /api/generation-runs
GET  /api/generation-runs/:id

GET  /api/generation-runs/:id/lineups

POST /api/lineups/:id/entered

GET  /api/lineups/:id
GET  /api/lineups/:id/status
GET  /api/lineups/:id/result

GET  /api/history
```

Generation endpoint:

```json
POST /api/generation-runs

{
  "contestId": "uuid",
  "requestedEntryCount": 2
}
```

Response:

```json
{
  "runId": "uuid",
  "state": "created"
}
```

---

# 41. Application State Machine

```text
CREATED
  ↓
SLATE_VALIDATED
  ↓
RESEARCHING
  ↓
ADJUSTING
  ↓
PROJECTING
  ↓
OPTIMIZING
  ↓
SELECTING
  ↓
READY
```

Failure states:

```text
BLOCKED
FAILED
```

After entry:

```text
ENTERED
  ↓
MONITORING
  ↓
LOCKED
  ↓
RESULTS_PENDING
  ↓
MEASURED
  ↓
LEARNING_REVIEW
  ↓
COMPLETE
```

---

# 42. Acceptance Criteria — MVP

The MVP is complete when an authenticated user can:

1. Select one of the supported sports.
2. View available DraftKings contests.
3. Select a contest.
4. Choose 1-N lineups.
5. Execute generation.
6. See generation progress.
7. Receive valid DraftKings lineup(s).
8. View salary used.
9. View median and ceiling.
10. View concise why/risk.
11. Copy the lineup.
12. Mark a lineup Entered.
13. Have the system persist the exact entered version.
14. Receive a pre-lock KEEP/ADJUST/REBUILD notification when a material watch item changes.
15. View post-contest projection-vs-actual measurement.
16. Ensure all data is tenant-isolated.

Engine acceptance:

17. Research separates facts from sentiment.
18. Sport Adjustment cites Research evidence.
19. Projection contains explicit opportunity assumptions.
20. Optimize produces only legal DraftKings lineups.
21. Selection selects only optimizer candidates.
22. Learning does not rewrite rules after a single contest.
23. All stages are versioned and auditable.

---

# 43. Recommended MVP Scope

Support initially:

```text
WNBA Showdown
MLB Showdown
Golf Showdown
```

Why:

- These are the workflows already exercised during product discovery.
- Showdown player pools simplify early optimizer validation.
- Sport Adjustment logic already exists.
- Mobile lineup presentation is straightforward.

Add:

```text
NBA
NFL
Classic slates
```

after core pipeline accuracy and performance are validated.

---

# 44. Implementation Sequence

## Phase 1 — Foundation
- Supabase projects
- Auth
- tenant schema
- RLS
- shared TypeScript contracts
- DraftKings provider interface
- contest/player ingestion

## Phase 2 — Deterministic engine
- Slate
- DraftKings scoring engine
- projection scaffolding
- optimizer constraints
- lineup enumeration
- version persistence

## Phase 3 — Research + Adjustment
- Research Agent
- research source normalization
- basketball specialist
- MLB specialist
- golf specialist
- ResearchGap loop

## Phase 4 — Quantitative models
- basketball model
- MLB models
- golf model
- simulations
- confidence/value metrics

## Phase 5 — Optimize intelligence
- joint correlation simulation
- field model
- duplication model
- objective profiles
- candidate ranking

## Phase 6 — Selection/UI
- Selection Agent
- mobile lineup cards
- progressive disclosure
- Copy Lineup
- Lineup Entered

## Phase 7 — Learning Loop
- watch items
- change event routing
- lock snapshots
- contest results
- measurement
- Learning Diagnosis Agent
- lesson candidates

## Phase 8 — Production hardening
- observability
- retries
- agent evals
- load tests
- prompt versioning
- model versioning
- security review
- production deployment

---

# 45. Non-Goals for V1

Do not include unless separately approved:

- automatic DraftKings lineup submission
- wagering/bet placement
- FanDuel support
- autonomous bankroll management
- chat-first experience
- user-editable projection formulas
- automatic model-rule mutation
- 150-max portfolio optimization before single/showdown reliability is proven
- native iOS/Android apps
- social/community features

---

# 46. Architecture Decisions Summary

| Decision | Locked Choice |
|---|---|
| Provider | DraftKings only |
| Frontend | React / Next.js |
| Primary form factor | Mobile web |
| PWA | Recommended |
| Deployment | Vercel |
| DB/backend | Supabase |
| Tenancy | Shared DB + tenant_id + RLS |
| Slate | Deterministic |
| Research | Shared AI agent |
| Sports intelligence | Sport Adjustment specialists |
| Projection | Quantitative hybrid |
| Optimize | Deterministic |
| Selection | Shared AI agent |
| Learning | Hybrid |
| Lineup states | GENERATED → ENTERED |
| Agent UI | Hidden from primary UX |
| Primary UX | Sport → Contest → Entries → Generate → Lineups |
| Learning objective | Assumption quality, not simply win/loss |

---

# 47. Engineering Definition of Done

A production release should not be approved until:

- All tenant tables have tested RLS.
- Every stage has schema validation.
- Every run has full version lineage.
- No Selection output can reference a lineup absent from OptimizerPackage.
- No projection can exist without explicit opportunity assumptions.
- No Sport Adjustment can cite evidence absent from ResearchPackage.
- No Research Tier 4 sentiment can override Tier 1 factual state.
- Entered lineups are immutable without explicit user action.
- Material change events trigger targeted reruns.
- Lock snapshots are immutable.
- Post-contest measurement distinguishes model error from variance.
- Prompt/model versions are persisted on every AI stage.
- Generation works end-to-end on mobile browsers.
- The UI never requires users to understand internal agents or packages.

---

# 48. Final System Definition

```text
USER
  ↓
Select Sport
  ↓
Select DraftKings Contest
  ↓
Choose Number of Lineups
  ↓
Generate
  ↓

SLATE SERVICE
DraftKings ingest / normalize / validate
  ↓

RESEARCH AGENT
What is true?
  ↓

SPORT ADJUSTMENT SPECIALIST
What does that change?
  ↓

PROJECTION SERVICE
What is that opportunity worth in DraftKings points?
  ↓

OPTIMIZE SERVICE
Which legal combinations are strongest?
  ↓

SELECTION AGENT
Which lineup(s) should this user enter?
  ↓

MOBILE UI
Lineup → Why → Risk → Copy → Lineup Entered
  ↓

LEARNING LOOP
Monitor → Recheck → Measure → Diagnose → Learn
  ↺

FUTURE ENGINE RUNS
```

The system should remain intentionally boring at the infrastructure boundaries and sophisticated only where judgment or statistical modeling genuinely requires it.

That is the central architecture principle for the entire product.
