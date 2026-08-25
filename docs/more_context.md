Good. Slate should be the cleanest part of the whole engine because it defines the problem before any research starts.

I’d make Slate answer only five things:

What sport is this?
What contest format is this?
What are the roster/salary rules?
What is the actual player pool?
When does it lock?

So the Slate step would look like:

Input

Sport: WNBA / MLB / Golf / NFL / NBA
Contest: Showdown / Classic / Round 4 Showdown / etc.
Number of bullets: 1, 2, 20-max, etc.
Salary cap
Roster construction rules
DraftKings player pool + salaries
Lock time

Validation

Is the matchup/event correct?
Are the salaries current?
Is the contest actually available today?
Are there duplicate/missing players?
Are CPT/UTIL salaries interpreted correctly?
Does the slate include one game, multiple games, or one golf round?

Output
A normalized slate object that the rest of the engine can consume.

Conceptually:

SLATE

Sport: WNBA
Contest: Showdown
Matchup: IND vs CHI
Lock: 7:00 PM ET
Salary Cap: $50,000
Entries: 1

Roster Rules:
- 1 CPT
- 5 UTIL
- CPT salary = 1.5x
- CPT points = 1.5x
- No duplicate players

Player Pool:
Caitlin Clark | IND | $12,200 UTIL | $18,300 CPT
Aliyah Boston | IND | $11,400
Kamilla Cardoso | CHI | $10,400
...

And that’s basically it.

I would not let the Slate step make judgments like:

Clark is a good play.

or

Cardoso is underpriced.

That belongs later.

Slate should be dumb but reliable.

Its job is:

Define the exact game we are solving.

The only slightly intelligent thing I’d add is a Slate Integrity Check. That catches the kind of mistake we made earlier when “LAS” got interpreted as Las Vegas instead of Los Angeles.

So before the engine moves on, Slate should return:

VALIDATED
or
BLOCKED

with a reason.

Example:

SLATE STATUS: BLOCKED

Reason:
User requested CON vs LAS, but today's schedule shows
CON vs Los Angeles Sparks.

Need confirmation before research begins.

That one guardrail alone prevents a lot of downstream garbage.

The next useful question is probably: what exact inputs should the Slate accept from the user versus what should the engine infer automatically?

I think Slate should also include Scoring Rules of the contest as well 

Yes. I’d add Scoring Rules directly into Slate because projections are meaningless unless the engine knows how the contest actually awards points.

So Slate becomes:

Slate = Event Definition + Contest Definition + Scoring Definition + Player Pool

The workflow inside Slate would now be:

Sport
Contest format
Matchup/event
Lock time
Number of entries/bullets
Salary cap
Roster construction rules
Scoring rules
Player pool + salaries
Validation status

For example, a WNBA Showdown slate might look like:

SLATE

Sport: WNBA
Contest: DraftKings Showdown
Matchup: IND vs CHI
Lock: 7:00 PM ET
Entries: 1
Salary Cap: $50,000

Roster Rules:
- 1 CPT
- 5 UTIL
- CPT salary = 1.5x
- CPT fantasy points = 1.5x
- No duplicate players

Scoring Rules:
- Point: +1
- 3PT Made: +0.5
- Rebound: +1.25
- Assist: +1.5
- Steal: +2
- Block: +2
- Turnover: -0.5
- Double-double: +1.5
- Triple-double: +3

Player Pool:
...

And for golf, Scoring Rules becomes even more important because the engine needs to know whether that specific Showdown includes things like birdies, bogeys, streak bonuses, bogey-free rounds, hole-in-one, finishing-position points, etc.

I’d actually make Scoring Rules a required validation gate:

If the engine cannot verify the scoring system, Slate is not complete.

That prevents the Projection Agent from using generic DraftKings assumptions when the contest has different rules.

So the simplified Slate output is now:

WHO is playing + WHAT contest we're solving + HOW rosters are built + HOW points are earned + WHEN it locks.

That feels like the right boundary for Slate.

I also think Slate should include the contest total size along with number or entries 

Yes. I’d include both, because contest size and your number of entries change the objective function.

A 300-entry single-entry contest should not be treated the same as a 50,000-entry GPP, even with the exact same slate and salaries.

So Slate now becomes:

Slate = Event + Contest + Scoring + Player Pool + Entry Context

I’d structure it like this:

SLATE

Sport: WNBA
Contest: DraftKings Showdown
Matchup: IND vs CHI
Lock: 7:00 PM ET

Entry Context:
- Contest Size: 2,500 entries
- User Entries: 1
- Max Entries Allowed: 20
- Entry Fee: optional
- Payout Structure: optional for now

Roster Rules:
- Salary Cap: $50,000
- 1 CPT
- 5 UTIL
- CPT salary = 1.5x
- CPT fantasy points = 1.5x
- No duplicate players

Scoring Rules:
- Point: +1
- 3PT Made: +0.5
- Rebound: +1.25
- Assist: +1.5
- Steal: +2
- Block: +2
- Turnover: -0.5
- Double-double: +1.5
- Triple-double: +3

Player Pool:
...

Slate Status:
VALIDATED

The reason Contest Size belongs here is that it affects downstream strategy:

Small field → prioritize projection and floor more heavily.
Large field → ceiling, leverage and duplication matter more.
1 bullet → strongest single construction.
Multiple bullets → portfolio diversification across game scripts.
20-max / 150-max → much more aggressive exposure management becomes possible.

I’d also include Max Entries Allowed separately from User Entries. If a contest allows 20 but the user is entering 1, that tells the engine something about how much of the field may be multi-entering.

So I think the current Slate definition should be:

1. Sport/Event
2. Contest Format
3. Lock Time
4. Contest Size
5. User Entry Count
6. Max Entries Allowed
7. Roster Rules
8. Scoring Rules
9. Player Pool + Salaries
10. Validation Status

That feels complete without letting Slate drift into actual analysis.

Locked. I'm good with this for Slate

Locked.

Slate is now defined as:

Sport / Event
Contest Format
Lock Time
Contest Size
User Entry Count
Max Entries Allowed
Roster Rules
Scoring Rules
Player Pool + Salaries
Validation Status

And importantly, Slate does no analysis. Its job is only to define and validate the exact contest problem before the engine moves forward.

That’s a good boundary.

Ok. Let's move to the next step in the engine 

The next step should be Research.

Its job is simple:

Establish what is true right now that could materially affect the slate.

Research should not build lineups yet, and it should not decide who is a “good play.” It should gather the evidence the sport-specific agent will use later.

I’d break Research into six buckets:

Availability
injuries
active/inactive status
starters
expected minutes/workload restrictions
withdrawals/scratches
confirmed lineups
Recent Role / Form
recent minutes or usage
recent batting order / tee position / snap share
changes caused by injuries or rotation shifts
last 3 / 5 / 10 relevant performances
current-role performance rather than blindly using season averages
Matchup / Environment
opponent
pace
park/course
handedness
weather
travel/back-to-back
course conditions
anything sport-specific that changes opportunity
Market Signals
spread
total
implied team totals
player props
line movement
meaningful market changes since open
News / External Context
beat reporter updates
coach comments
league news
workload comments
bullpen availability
equipment/course news
anything else that may not show up in the box score yet
Field Sentiment
Reddit
DFS communities
social chatter
ownership narratives
popular “must plays”
players the field appears to be fading

The important rule should be:

Research reports facts and signals. It does not convert them into fantasy projections yet.

For example:

RESEARCH FINDING

Player: DiJonai Carrington

Status:
Active

Recent Role:
- 24 minutes
- 19 minutes
- 27 minutes
- missed previous game

Current News:
- returning from foot issue
- no confirmed minutes restriction

Field Sentiment:
- moderate interest because of discounted salary

Confidence:
Medium

Research should stop there.

It should not say:

Carrington projects for 21.4 DK points.

That belongs in the next step.

I’d also add two required attributes to every important research finding:

Source Quality

Official
High-confidence reporting
Secondary
Social/speculative

and

Recency

timestamp / age of information

That way the engine can distinguish:

Official starting lineup posted 12 minutes ago

from:

Reddit user thinks someone might start.

So the simplified engine is now:

Slate → Research → Sport Adjustment → Projection → Optimize → Select → Recheck

And Research’s one-line purpose is:

Collect and validate all current evidence that may change player opportunity or game environment.

I think this is good. I think we should also continue playoff position and situations, especially for the wnba since we're coming up to the playoffs 

Yes. I’d add a seventh Research bucket: Competitive Context.

That captures not just playoff position, but whether the game actually means something differently today than it did three weeks ago.

For WNBA, I’d research:

current standings / seed
games remaining
games ahead/behind playoff cutoff
clinching scenarios
elimination scenarios
seeding implications
home-court implications
tiebreakers where relevant
whether a team has already clinched
whether a team is effectively eliminated
rest/manage-minutes incentives
urgency around today's matchup
upcoming schedule difficulty

The key is that we shouldn't mechanically translate "must-win game" → +5 fantasy points. Competitive context is evidence that can change expected behavior.

For example:

Team is fighting for final playoff spot + star normally plays 34 minutes + coach has recently extended her to 38 in close games.

That's actionable.

Whereas:

Team desperately needs to win.

by itself isn't enough to change a projection.

It could also work in the opposite direction. A team that has locked its seed and has nothing to gain could create increased rest risk or reduced fourth-quarter workload.

I'd make this applicable across sports, too:

WNBA/NBA: playoff race, seeding, elimination, rest.

MLB: pennant/wild-card race, eliminated teams, bullpen management, September call-ups.

NFL: playoff qualification, division race, resting starters late season.

Golf: FedExCup position, qualification thresholds, Ryder Cup points, keeping a Tour card, Sunday leaderboard incentives.

So Research now becomes:

Availability
Recent Role / Form
Matchup / Environment
Market Signals
News / External Context
Field Sentiment
Competitive Context

And I’d define #7 simply as:

What does this game/event mean competitively, and is there credible evidence that it could change player/team behavior?

That keeps us from falling into the narrative trap of treating “must win” as a magical performance multiplier while still capturing situations that genuinely affect minutes, aggression, rotations, and workload.

Perfect. 

Locked. Research now has seven buckets:

Availability
Recent Role / Form
Matchup / Environment
Market Signals
News / External Context
Field Sentiment
Competitive Context

And the boundary stays clean: Research establishes the current evidence; it does not yet turn that evidence into fantasy projections or lineup decisions.

We’re ready to move to the next engine step whenever you are.

I'm ready 

The next step should be Sport Adjustment.

Its job is:

Take the raw research and translate it into sport-specific fantasy meaning.

This is the first place where judgment enters.

Research tells us:

“Player X is starting because Player Y is out.”

Sport Adjustment tells us:

“That likely means +7 expected minutes, more rebound opportunity, and a higher usage band.”

For simplicity, I’d define the step in four parts:

Translate the evidence
What actually changed?
Minutes?
Usage?
Batting order?
Tee-time advantage?
Workload?
Opportunity?
Apply sport-specific logic
WNBA/NBA → minutes, usage, on/off, pace, stocks
MLB → batting order, handedness, pitcher matchup, park, bullpen
Golf → strokes gained, birdie rate, tee wave, leaderboard pressure
NFL → snaps, routes, target share, red-zone role
Identify meaningful deltas
Who is materially better positioned than their baseline?
Who is materially worse?
Which season averages are now misleading?
Which salary has not caught up to the role change?
Assign adjustment confidence
High
Medium
Low

A WNBA example might be:

SPORT ADJUSTMENT

Player: Olivia Nelson-Ododa

Baseline:
- 23.1 DK FPPG
- normal frontcourt role

Research:
- Griner OUT
- Edwards OUT
- recently played expanded minutes
- 18 pts / 11 reb vs same opponent

Adjustment:
- Expected minutes: UP
- Rebounding opportunity: UP
- Offensive involvement: UP
- Double-double probability: UP

Confidence: High

Still no final fantasy projection yet.

The important boundary is:

Research = what happened / what is true.

Sport Adjustment = what that probably means for opportunity.

Projection = how many fantasy points that opportunity is worth.

That separation is useful because we can inspect whether the problem came from bad information, bad interpretation, or bad projection later.

So the engine is now:

Slate → Research → Sport Adjustment → Projection → Optimize → Select → Recheck

I’d keep Sport Adjustment this lean before we start defining each sport’s exact adjustment rules.

I agree but I think we still need to include the competitive context in the lean version before diving into each sport 

Agreed. Competitive Context should survive the handoff from Research into Sport Adjustment, because this is where we decide whether the standings situation actually changes opportunity.

So the lean Sport Adjustment step should be five parts, not four:

Translate the evidence
What actually changed in role, opportunity, environment, or workload?
Apply sport-specific logic
Convert those changes into the variables that matter for that sport.
Apply competitive context
Does playoff/seeding/elimination/tournament-position pressure realistically change:
expected minutes or workload
aggressiveness
rotation depth
rest risk
bullpen usage
strategic behavior
If yes, capture the adjustment.
If no, explicitly leave it neutral.
Identify meaningful deltas
Who is materially above/below baseline?
Which historical averages are now misleading?
Where has salary not caught up?
Assign adjustment confidence
High
Medium
Low

For example:

SPORT ADJUSTMENT

Player: X

Baseline:
Normal 31–33 minute role

Research:
- Team is 1 game out of final playoff spot
- 4 games remaining
- Coach has shortened rotation in last 3 competitive games
- Player logged 37 / 36 / 38 minutes

Adjustment:
- Expected minutes: UP
- Late-game workload: UP
- Rotation certainty: UP

Competitive Context:
Meaningful positive adjustment

Confidence:
High

And equally important:

Competitive Context:
Team is in a must-win situation, but no evidence of changed
minutes, rotation, or usage.

Adjustment:
NEUTRAL

That second example is important. It prevents the engine from turning playoff narratives into fake projection boosts.

So the clean definition becomes:

Sport Adjustment translates current evidence — including competitive context — into changes in player opportunity and expected behavior before fantasy points are assigned.

That feels like the right lean version.

Agreed 

Locked.

Sport Adjustment now has five lean responsibilities:

Translate the evidence
Apply sport-specific logic
Apply competitive context
Identify meaningful deltas
Assign adjustment confidence

And the boundary is still clean:

Research = what is true.
Sport Adjustment = what that means for opportunity.
Projection = what that opportunity is worth in fantasy points.

Ready for Projection.

Yes, let's move to Projection but make a note to come back to Sport Adjustment to define each sports adjustments later 

Noted. We’ll come back to Sport Adjustment later and define the actual adjustment rules for each sport after we finish the lean engine.

Now, Projection.

Its job is:

Convert adjusted player opportunity into an expected fantasy outcome under this slate’s scoring rules.

I’d keep the lean version to five responsibilities.

Establish a baseline
Start from the player’s normal fantasy-producing profile:
season performance
recent/current-role performance
fantasy points per minute / per plate appearance / per round where relevant
historical volatility

Apply the Sport Adjustments
Take everything determined in the prior step and quantify it.

Examples:

+5 expected minutes
higher usage
better batting-order position
favorable pitcher matchup
stronger weather wave
increased playoff workload
reduced role because of injury/rest risk

Translate into the contest’s scoring system
This is why Scoring Rules had to live in Slate.

Projection shouldn't just estimate:

22 points, 8 rebounds, 7 assists.

It should convert that into:

41.5 DraftKings fantasy points

using the exact rules for that contest.

Produce a range, not just one number
Every viable player should get at least:

PROJECTION

Player: X

Floor: 24
Median: 34
Ceiling: 48

Confidence: High

I’d define these conceptually as:

Floor — reasonable poor outcome
Median — most useful expected outcome
Ceiling — realistic high-end outcome, not impossible perfection

For tournament DFS, that ceiling number matters a lot.

Calculate salary efficiency
Now compare fantasy output with the player's DraftKings price.

At minimum:

Median Value = Median Projection / Salary
Ceiling Value = Ceiling Projection / Salary

This is how we identify players whose current opportunity has outrun their salary.

So Projection outputs something like:

PLAYER PROJECTION

Player:
Makayla Timpson

Salary:
$6,200

Baseline:
19 DK

Sport Adjustments:
+ Expected minutes
+ Starting role
+ Defensive-stat opportunity
+ Competitive workload

Projected Range:
Floor: 16
Median: 24
Ceiling: 34

Median Value:
3.87 DK per $1K

Ceiling Value:
5.48 DK per $1K

Projection Confidence:
Medium-High

One distinction I think we should establish now:

Projection should not choose players.

It can say:

Timpson projects better than her salary.

But it should not say:

Therefore put Timpson in the lineup.

That belongs downstream.

And I wouldn't put ownership or duplication here either. Those aren't properties of the player's fantasy production; they're properties of the field and lineup construction.

So our boundaries now look very clean:

Slate
What are we solving?

Research
What is true right now?

Sport Adjustment
What does that change?

Projection
What is that opportunity worth in fantasy points?

Optimize
Which combinations work best?

Select
Which lineup(s) should we actually enter?

Recheck
Has anything changed before lock?

For the lean version, I think Projection = Baseline → Adjust → Score → Range → Value is enough.

Locked 

Locked.

Projection is:

Baseline → Apply Adjustments → Score to Contest Rules → Produce Floor/Median/Ceiling → Calculate Salary Efficiency

And its boundary is:

Projection measures player fantasy value. It does not select the lineup.

Next step is Optimize.

Let's move to optimize 

Optimize is where the engine stops evaluating players individually and starts evaluating lineups as combinations.

Its job is:

Generate legal lineups and score them against the contest objective.

I’d keep the lean version to six responsibilities.

Generate legal combinations
Apply the Slate rules exactly:

salary cap
roster positions
CPT/UTIL rules
team minimums/maximums
unique-player constraints
showdown-specific rules
sport-specific roster construction

At this stage, illegal lineups simply never enter the candidate pool.

Calculate lineup projection
For every legal lineup, combine the player projections from the prior step.

At minimum:

lineup floor
lineup median
lineup ceiling

Example:

LINEUP A

Salary: $49,700

Floor: 122
Median: 181
Ceiling: 244

Apply correlation
This is where the engine asks whether the players make sense together.

Examples:

WNBA: PG + scorer can be positively correlated
MLB: hitters stacked consecutively can score together
NFL: QB + WR
Golf: correlation may be lower, but tee-wave/weather exposure matters
Showdown: opposing players may still correlate depending on game script

This should adjust the lineup score, not necessarily the individual player projection.

Apply contest strategy
Use the Slate’s contest context:

field size
user entries
max entries allowed

A 300-entry single-entry contest may favor:

stronger median
less extreme leverage

A 50,000-entry GPP may favor:

higher ceiling
more differentiation
more willingness to sacrifice median projection

So the optimizer should not have one universal objective.

Rank by multiple objectives
I would not produce one master score only.

Keep at least three rankings:

Median Rank
Ceiling Rank
Tournament Rank

The Tournament Rank can later incorporate ownership/leverage/duplication once we formally define those inputs.

Conceptually:

Lineup A
Median Rank: #1
Ceiling Rank: #7
Tournament Rank: #4

Lineup B
Median Rank: #6
Ceiling Rank: #1
Tournament Rank: #2

Create a candidate set
Optimize should not make the final decision.

It should hand Select a small group of the best constructions.

For example:

OPTIMIZER OUTPUT

Candidate 1:
Highest Median

Candidate 2:
Highest Ceiling

Candidate 3:
Best Balanced GPP

Candidate 4:
Best Contrarian Construction

Candidate 5:
Best Alternate Game Script

That last part matters because it keeps the boundary clean.

Optimize should not decide which lineup we enter

Its job is:

Find the strongest legal possibilities.

Then Select decides which possibility best matches:

one bullet vs multiple
field size
risk preference
diversification
game-script coverage

So the engine now looks like:

Slate
Define the problem.

Research
Establish reality.

Sport Adjustment
Translate reality into opportunity.

Projection
Quantify player fantasy value.

Optimize
Generate and rank legal lineup combinations.

Select
Choose the actual entry or portfolio.

Recheck
Re-run anything affected by late news.

For the lean engine, I’d define Optimize as:

Generate → Score → Correlate → Apply Contest Objective → Rank → Produce Candidates.

That feels like the right boundary before we get into the heavier questions around ownership, leverage, duplication, and portfolio construction.

Agreed. Let's move on to Selection 

Selection is where the engine makes the actual recommendation.

Its job is:

Choose the lineup or lineup portfolio that best fits the user’s contest situation and number of bullets.

I’d keep the lean version to five responsibilities.

Read the candidate set from Optimize
Selection does not build new lineups from scratch unless a constraint changed.

It starts with candidates like:

highest median
highest ceiling
best balanced GPP
best leverage
alternate game script

Apply entry context
Use the Slate information:

contest size
user entry count
max entries allowed
contest format

The same candidate set can produce different selections depending on whether the user has:

1 bullet
2 bullets
20 entries

Choose the right risk posture
For one bullet, I’d generally favor:

strongest combination of median + ceiling + realistic path to first

Not necessarily:

mathematically highest median

For multiple bullets, Selection should diversify intentionally.

Avoid redundant lineups
This is especially important for 2+ entries.

Selection should ask:

Are these actually different bets?

Two lineups with one cheap-player swap may not provide meaningful diversification.

Better:

Bullet 1: likely game script
Bullet 2: alternate but realistic game script
Bullet 3: leverage/contrarian script

Explain the selection thesis
Every selected lineup should carry a short reason:

SELECTED LINEUP

Type:
Single-Entry GPP

Why Selected:
- Top-3 median
- Top-2 ceiling
- Strong correlation
- Lower duplication than median leader
- Best fit for one-bullet contest

Game Script:
IND stays competitive, Clark controls usage,
Mitchell scores efficiently, Cardoso wins interior.

And I think Selection should output one of two things:

1 BULLET
→ Final Lineup
→ Why this one
→ Primary risk

or

MULTI-BULLET
→ Lineup 1
→ Lineup 2
→ Lineup 3
→ Why each is different
→ Overlap/exposure summary

The clean boundary is:

Optimize finds the best legal possibilities.

Selection decides which of those possibilities we actually want to enter.

For the lean engine:

Candidate Set → Apply Entry Context → Choose Risk Posture → Diversify if Needed → Final Recommendation

That’s the Selection step.

Agreed. We also need to note this is the UI Layer to the user. This is where they actually see the generated lineups 

Yes — that changes the definition in an important way.

Selection is also the UI/output layer. It is where the engine stops being internal and presents the user with the actual recommendation.

So I’d update the lean definition to:

Selection chooses the final lineup(s) from the optimizer candidate set and presents them to the user in a clear, decision-ready format.

Its responsibilities become:

Choose the final candidate(s)
based on contest size
user entry count
risk posture
median/ceiling balance
diversification if multiple bullets
Package the recommendation
The user should see:
lineup
salary used
projected range
lineup type
why it was selected
Explain the thesis
Keep it concise:
what game script this lineup is betting on
which players are projection plays
which are value/leverage plays
primary risk
Show multi-bullet differentiation
If there are multiple entries:
why Lineup 2 is different from Lineup 1
overlap
what alternate outcome it covers
Surface watch items
If something could still change before lock:
injury status
weather
starting lineup
tee-time conditions
late scratch

So the UI might look conceptually like:

FINAL LINEUP — BULLET 1

CPT  Caitlin Clark        $18,300
UTIL Kamilla Cardoso      $10,400
UTIL Kelsey Mitchell      $10,200
UTIL Makayla Timpson       $6,200
UTIL Lexie Hull            $2,400
UTIL Gabriela Jaquez       $2,200

Salary Used: $49,700
Median Projection: 182
Ceiling: 241

WHY THIS LINEUP
Best one-bullet balance of raw projection and Captain ceiling.

GAME SCRIPT
Competitive IND–CHI game with Clark controlling creation,
Mitchell benefiting as scorer, and Cardoso winning the interior.

PRIMARY RISK
Cheap-player minutes.

WATCH BEFORE LOCK
Carrington workload.

That means Selection has two jobs:

Decision layer: Which lineup wins the recommendation?

Presentation layer: How does the user understand and act on it?

I’d lock that into the engine.

Agreed. Let's move to the Recheck phase, we're going to call this the Learning loop

Yes — and I think Learning Loop is a better name, because it should do more than just recheck before lock.

I’d define it as:

Learning Loop continuously compares the engine’s assumptions against new information and actual outcomes, then feeds corrections back into the system.

For the lean version, I’d give it four responsibilities:

Pre-lock recheck
Revisit anything that can still change:

injuries / active status
starters / batting order
weather
tee-time conditions
betting-line movement
workload restrictions
late scratches
meaningful field sentiment changes

Then decide:

KEEP
ADJUST
REBUILD

Update affected assumptions
Don’t rerun everything blindly.

If one injury changes, identify what it affects:

Research finding
Sport Adjustment
Projection
Optimize
Selection

Then rerun only the necessary downstream steps.

Conceptually:

NEW INFORMATION
Carrington confirmed OUT

IMPACT
Jaquez expected minutes ↑
Cloud usage slightly ↑

ACTION
Update Sport Adjustment
→ Reproject affected players
→ Re-optimize
→ Re-select lineup

Post-contest review
After the event, compare:

What we expected
versus
What actually happened

Importantly, this should not simply ask:

Did the lineup win?

A good process can produce a bad outcome.

Instead:

Were minutes projected correctly?
Did the batting order behave as expected?
Was the weather edge real?
Did the game script make sense?
Were our ceilings reasonable?
Did the value player's role actually materialize?
Was ownership/leverage estimated correctly?
Did the selected lineup represent the intended strategy?

Feed lessons back into the engine
The engine should identify where the error occurred.

For example:

LEARNING

Prediction:
Player X expected 30 minutes

Actual:
19 minutes

Root Cause:
Rotation assumption incorrect

Error Location:
Sport Adjustment

Lesson:
Reduce confidence in projected starter minutes
when player is returning from injury without
explicit workload confirmation.

This is where the separation we've built starts paying off.

Because we can diagnose:

Bad source?
→ Research problem.

Correct information, wrong interpretation?
→ Sport Adjustment problem.

Opportunity estimated correctly but fantasy output model was wrong?
→ Projection problem.

Player projections were good but lineup combination was weak?
→ Optimize problem.

Optimizer produced the right candidate but we chose the wrong portfolio?
→ Selection problem.

That gives us an actual learning system instead of:

“The lineup lost, so change everything.”

So the lean flow becomes:

Slate → Research → Sport Adjustment → Projection → Optimize → Selection → Learning Loop

And the Learning Loop is:

Recheck → Update → Review → Learn → Feed Back

I’d also make one architectural distinction explicit: the Learning Loop is not really the “last” step. It wraps around the whole engine.

Everything can feed back into it, and its lessons should influence future slates.

Locked. What do we have so far 

So far, we’ve defined the lean Sports Agent engine as a seven-stage workflow:

Slate → Research → Sport Adjustment → Projection → Optimize → Selection → Learning Loop

Here’s the current locked version.

1. Slate

Purpose:

Define and validate the exact contest problem before any analysis begins.

Slate includes:

Sport / Event
Contest Format
Lock Time
Contest Size
User Entry Count
Max Entries Allowed
Roster Rules
Scoring Rules
Player Pool + Salaries
Validation Status

Boundary:
No player analysis. No recommendations. Just define the problem correctly.

2. Research

Purpose:

Establish what is true right now that could materially affect the slate.

Research has seven buckets:

Availability
Recent Role / Form
Matchup / Environment
Market Signals
News / External Context
Field Sentiment
Competitive Context

Important rules:

Research gathers facts/signals, not projections.
Important findings should carry source quality and recency.
Competitive context includes playoff/seeding/elimination/tournament implications, but does not automatically create a fantasy boost.
3. Sport Adjustment

Purpose:

Translate current evidence into changes in player opportunity and expected behavior.

Lean responsibilities:

Translate the evidence
Apply sport-specific logic
Apply competitive context
Identify meaningful deltas
Assign adjustment confidence

Boundary:
Research says what is true. Sport Adjustment says what that likely changes.

Example:

Starter ruled out → backup expected minutes rise → rebound opportunity rises → confidence high.

We also explicitly marked a TODO here:

Come back later and define the actual adjustment rules for each sport individually.

4. Projection

Purpose:

Convert adjusted player opportunity into expected fantasy production under the actual contest scoring rules.

Workflow:

Baseline → Apply Adjustments → Score → Range → Value

Outputs per player:

Floor
Median
Ceiling
Projection confidence
Median salary efficiency
Ceiling salary efficiency

Boundary:
Projection evaluates players. It does not choose lineups.

5. Optimize

Purpose:

Generate legal lineup combinations and rank their quality against the contest objective.

Workflow:

Generate → Score → Correlate → Apply Contest Objective → Rank → Produce Candidates

Responsibilities:

Generate legal combinations
Calculate lineup floor / median / ceiling
Apply correlation
Apply contest strategy
Rank using multiple objectives
Produce candidate lineup set

Candidate types might include:

Highest median
Highest ceiling
Best balanced GPP
Best contrarian construction
Best alternate game script

Boundary:
Optimize finds strong possibilities; it does not decide what the user enters.

6. Selection

Purpose:

Choose the final lineup(s) and present them to the user.

This is both the decision layer and UI layer.

Responsibilities:

Choose final candidate(s)
Apply entry context
Apply risk posture
Diversify multiple bullets
Explain selection thesis
Surface pre-lock watch items

User-facing output should include:

Actual lineup(s)
Salary used
Projection range
Lineup type
Why it was selected
Game-script thesis
Primary risk
Watch-before-lock items
Multi-entry overlap/differentiation when relevant

Boundary:
This is where the user actually sees the generated lineup.

7. Learning Loop

Purpose:

Continuously compare assumptions against new information and actual outcomes, then feed corrections back into the engine.

Workflow:

Recheck → Update → Review → Learn → Feed Back

Responsibilities:

Pre-lock recheck
Update affected assumptions
Post-contest review
Feed lessons back into the appropriate engine stage

Pre-lock outcome:

KEEP
ADJUST
REBUILD

Post-contest, it should diagnose where an error occurred:

Bad information → Research
Bad interpretation → Sport Adjustment
Bad fantasy estimate → Projection
Bad lineup construction → Optimize
Wrong final portfolio choice → Selection

And importantly, we agreed that the Learning Loop wraps around the engine rather than simply sitting at the end.

So, visually:

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
USER

      ↖───────────────↙
        LEARNING LOOP

That’s a pretty clean core engine now. The obvious next deep-dive is either defining the sport-specific Sport Adjustment rules or defining the internal data contract passed between each stage.

I want to bookmark this position in the chat: SYSTEM DEFINITION 

Bookmarked as SYSTEM DEFINITION.

This marks the completed lean core engine:

Slate → Research → Sport Adjustment → Projection → Optimize → Selection → Learning Loop.

Now let's move to defining the internal data contract passed between each stage. Both inputs and outputs, starting at the beginning of the flow with Slate 

Yes. Starting with Slate, I’d define the contract very explicitly because every downstream stage depends on this being clean and normalized.

Slate — Internal Data Contract
Purpose

Slate receives the raw contest definition and turns it into a validated, normalized contest object that every later stage can trust.

Slate should not contain player analysis, projections, or recommendations.

Its job is only:

Define exactly what contest we are solving, who is eligible, how points are scored, and what constraints apply.

Slate Input

Slate can accept data from the user, DraftKings screenshots/API, contest metadata, or a combination of those.

SLATE_INPUT

request_id
timestamp_received

sport
league
event
contest_provider
contest_format

lock_time

contest_size
user_entry_count
max_entries_allowed

salary_cap

roster_rules
scoring_rules

raw_player_pool

source_metadata
What each field means
Field	Required?	Purpose
request_id	Yes	Unique identifier for this engine run
timestamp_received	Yes	Establishes freshness
sport	Yes	WNBA, MLB, Golf, NFL, etc.
league	Yes	WNBA, PGA Tour, MLB, etc.
event	Yes	Actual game, tournament, or slate
contest_provider	Yes	DraftKings initially
contest_format	Yes	Showdown, Classic, Round 4 Showdown, etc.
lock_time	Yes	Contest lock timestamp
contest_size	Yes	Total entries in contest
user_entry_count	Yes	Number of bullets being entered
max_entries_allowed	Yes	Contest max-entry rule
salary_cap	Yes	Usually $50K, but shouldn't be assumed
roster_rules	Yes	Required roster construction
scoring_rules	Yes	Exact scoring system
raw_player_pool	Yes	Player names, teams, salaries, positions, etc.
source_metadata	Yes	Where each input came from

I’d make source metadata part of the contract from day one.

For example:

source_metadata:

player_pool:
  source: user_screenshot
  received_at: 09:01 ET

scoring_rules:
  source: DraftKings
  verified_at: 09:02 ET

contest_size:
  source: user_input

That becomes extremely valuable later when something is wrong.

Roster Rules Contract

I would normalize roster rules rather than leaving them as prose.

For example, WNBA Showdown:

roster_rules:

roster_size: 6

slots:
  captain:
    count: 1
    salary_multiplier: 1.5
    fantasy_multiplier: 1.5

  utility:
    count: 5

unique_players_required: true

team_constraints:
  minimum_teams: 2

salary_cap: 50000

Golf might instead look like:

roster_rules:

roster_size: 6

slots:
  golfer:
    count: 6

unique_players_required: true

salary_cap: 50000

That way Optimize later doesn't need to understand free-form text like:

"Choose six golfers under $50K."

It receives actual rules.

Scoring Rules Contract

Same principle.

Don't store:

"Rebounds are worth 1.25."

Store:

scoring_rules:

points:
  value: 1.0

three_point_made:
  value: 0.5

rebound:
  value: 1.25

assist:
  value: 1.5

steal:
  value: 2.0

block:
  value: 2.0

turnover:
  value: -0.5

double_double:
  value: 1.5

triple_double:
  value: 3.0

For golf, we'd have a completely different event set.

This is important because Projection should never hard-code DraftKings scoring assumptions.

It consumes whatever Slate says the rules are.

Raw Player Pool Input

The initial player record should be very lean.

Slate does not need advanced stats yet.

RAW_PLAYER

player_id
player_name
team
opponent
position

salary

captain_salary
utility_salary

eligibility

status_from_provider
provider_fppg

source

Not every sport needs every field.

Golf would substitute things like:

golfer_id
golfer_name
salary
tee_time

But I'd normalize the player identity wherever possible.

Slate Validation

This is probably the most important part of the stage.

Slate should run a set of validations before anything moves downstream.

At minimum:

VALIDATION

event_exists
event_matches_requested_sport
lock_time_valid
contest_format_valid

salary_cap_present
roster_rules_complete
scoring_rules_complete

player_pool_present
player_ids_unique
salaries_valid
team_assignments_valid

contest_size_valid
user_entries_valid
user_entries_lte_max_entries

all_required_fields_present

Then produce:

validation_status:
  VALID
  WARNING
  BLOCKED
VALID

Everything required is present and consistent.

WARNING

The slate can proceed, but something should be surfaced.

Example:

Contest size supplied manually and not independently verified.

BLOCKED

Do not continue.

Examples:

Requested matchup does not exist.

Scoring rules missing.

Player pool appears to belong to a different slate.

This is where we prevent the earlier LAS = Las Vegas vs Los Angeles problem.

Slate Output

The output should be one normalized object.

I’d call it:

ValidatedSlate

Conceptually:

VALIDATED_SLATE

slate_id
request_id

sport
league

event:
  event_id
  participants
  event_date
  venue

contest:
  provider
  format
  lock_time
  contest_size
  user_entry_count
  max_entries_allowed

salary:
  cap

roster_rules:
  ...

scoring_rules:
  ...

player_pool:
  ...

validation:
  status
  warnings
  errors

source_manifest:
  ...

created_at

This becomes the single source of truth for every downstream stage.

What Slate passes to Research

Research should not receive the messy original input.

It receives:

ValidatedSlate

Research can therefore safely answer questions like:

What injury news matters?

What game should I research?

Which players are actually eligible?

What time must my information be fresh through?

without trying to reconstruct the contest itself.

That boundary is important.

What Slate does NOT output

I would explicitly prohibit Slate from adding:

projections
rankings
value scores
ownership
injury interpretations
matchup opinions
recommended players
game-script assumptions
confidence in individual players

Those belong downstream.

Slate's final responsibility is simply:

Here is the verified contest definition. Everything after this point may safely reason from it.

So the contract between Slate → Research is very clean:

INPUT TO SLATE
Raw Contest Data

        ↓

SLATE
Normalize + Validate

        ↓

OUTPUT
ValidatedSlate

        ↓

INPUT TO RESEARCH
ValidatedSlate

I think that's the right level of rigor for Slate without turning it into a bloated schema.

The next logical step is to define the Research input/output contract, especially because that's where we'll need to decide how evidence, sources, timestamps, confidence, and conflicting information are represented.

What the source for Slate? Where can this data come from 

Slate can come from a few places, and I’d deliberately support multiple source types rather than assuming one perfect feed.

The clean model is:

Slate assembles from provider data first, then user-supplied data, then public verification.

For DraftKings specifically, the strongest sources would be:

DraftKings contest data / API feed
Best source for:

contest format
salary cap
roster rules
player pool
salaries
lock time
contest size
max entries

If we can access a reliable official or licensed DK feed, this should be the primary source.

DraftKings screenshots supplied by the user
This is what we’ve effectively been doing manually.

Useful for:

player pool
salaries
CPT/UTIL pricing
contest size
entry count
scoring rules
lock time

This is a very practical fallback, especially for MVP.

DraftKings contest page / downloadable CSV
If available for the contest, a CSV is probably better than screenshots because it gives structured player IDs, salaries, teams, positions, and eligibility with less parsing risk.

User-entered contest metadata
For things the user may know directly:

“I have 2 bullets”
contest size
max entries
contest type
exact contest they’re entering

User entry count especially has to come from the user or their connected account; it isn’t something we should infer.

Official DraftKings scoring/rules documentation
I’d treat this separately from the player pool.

Rules change by sport and contest type, so the engine should retrieve or cache the correct rule set for:

WNBA Showdown
MLB Showdown
PGA Round Showdown
NFL Classic
etc.

League / event sources for identity validation
These are not the source of DK salaries, but they’re useful to verify:

event exists
correct teams
correct date
correct participants

Examples:

WNBA official schedule
MLB official schedule
PGA Tour event field
NFL schedule

That gives Slate a source hierarchy something like:

1. Official contest-provider structured data
2. Contest-provider CSV / export
3. User-supplied contest screenshots
4. User-entered metadata
5. Official contest-provider rules documentation
6. Official league/event source for validation

I’d also distinguish between authoritative fields.

For example:

Field	Preferred source
Player salary	DraftKings
Player eligibility	DraftKings
Contest size	DraftKings
Lock time	DraftKings
Scoring rules	DraftKings rules
User bullets	User
Max entries	DraftKings contest
Event participants	DraftKings + league verification
Event date/time	DraftKings + league verification

The important architectural point is that Slate should not go to Reddit, ESPN, Rotowire, betting sites, etc. for its core definition.

Those belong in Research.

Slate should use only sources that answer:

“What contest is this, who is eligible, what are the rules, and when does it lock?”

So I’d define Slate’s source classes as:

Contest Provider
User Input
Official League/Event Verification

That’s enough for the lean system.

Slate will use DraftKings contest data / API feed / RSS feed or DraftKings screenshots supplied by the user

Locked.

Slate source hierarchy:

DraftKings contest data / API feed / RSS feed
DraftKings screenshots supplied by the user

That means Slate is intentionally DraftKings-native. We won’t use secondary sports sites to define salaries, contest rules, player eligibility, or roster structure.

Secondary/public sources only enter later during Research.

Exactly. This will be a DraftKings only engine 

Exactly. Locked: this is a DraftKings-only engine.

That simplifies the system in a good way because we can optimize every stage around one provider’s contest formats, scoring rules, salary structures, and lineup constraints instead of trying to normalize FanDuel, Yahoo, etc.

So Slate now assumes DraftKings as the provider by default, with its source limited to:

DraftKings contest/API/RSS data when available
DraftKings screenshots supplied by the user

Everything downstream inherits that DraftKings context.

Ok. Let's move on to Research 

Great. For Research, the internal contract needs to be a little richer than Slate because this is where the engine starts ingesting live external evidence.

The clean definition is:

Research receives a validated DraftKings slate and returns a structured evidence package describing everything currently known that could materially affect player opportunity or the game environment.

Research — Internal Data Contract
Input

Research should receive the entire ValidatedSlate from Slate.

It also needs a small execution context so it knows how aggressively to research and how fresh the information must be.

RESEARCH_INPUT

validated_slate

research_context:
  current_timestamp
  lock_time
  minutes_to_lock
  sport
  league
  contest_format

research_requirements:
  availability
  recent_role_form
  matchup_environment
  market_signals
  news_external_context
  field_sentiment
  competitive_context

The important point is that Research does not need the original screenshots or messy user input.

Slate has already normalized all of that.

Research starts from:

Here is the verified DraftKings contest. Now tell me everything relevant happening around it.

The Core Research Object

I’d have Research produce one object:

ResearchPackage

Inside it, findings should be organized by the seven buckets we already locked.

RESEARCH_PACKAGE

slate_id
generated_at
fresh_through

availability
recent_role_form
matchup_environment
market_signals
news_external_context
field_sentiment
competitive_context

player_evidence
team_event_evidence

conflicts
unknowns
watch_items

research_status
source_manifest

Let’s unpack the important pieces.

1. Availability

This should answer:

Who can actually play, start, or participate, and under what restrictions?

availability:

player_id
status:
  active
  probable
  questionable
  doubtful
  out
  suspended
  withdrawn
  unknown

expected_to_start:
  true
  false
  unknown

workload_status:
  unrestricted
  limited
  expected_limit
  unknown

reported_limit:
  value
  unit

reason

last_updated
source_refs
confidence

For WNBA:

Player:
DiJonai Carrington

Status:
Active

Expected to Start:
False

Workload:
Unknown

Reason:
Returning from foot injury

Confidence:
Medium

For golf:

Player:
Golfer X

Status:
Withdrawn

Reason:
Back injury

Confidence:
High

Research records it.

It does not say what that means for projections yet.

2. Recent Role / Form

This one should distinguish role from results.

That matters.

A player can be playing badly while their role is improving.

I’d structure it roughly like:

recent_role_form:

player_id

role_window:
  last_3
  last_5
  last_10
  season

role_metrics:
  minutes
  starts
  usage
  opportunities
  batting_order
  snap_share
  routes
  tee_time
  etc.

performance_metrics:
  fantasy_points
  scoring
  rebounds
  assists
  strikeouts
  home_runs
  strokes_gained
  etc.

trend:
  increasing
  stable
  decreasing
  volatile

context_notes

source_refs
confidence

The sport agent later decides which metrics matter.

Research simply gathers them.

3. Matchup / Environment

This should be an event-level object, with player-specific matchup evidence when needed.

matchup_environment:

event_id

opponent_context
venue
home_away

pace_or_game_environment

weather:
  temperature
  wind
  precipitation
  humidity
  severity
  timing

surface_or_course_conditions

travel_context

rest_context

back_to_back

sport_specific_environment

source_refs
confidence

Examples:

WNBA:

projected pace
back-to-back
travel
opponent defensive profile

MLB:

park
weather
pitcher handedness
bullpen availability

Golf:

course conditions
wind by tee-time window
rain
morning/afternoon wave

Again, Research doesn't yet say:

Wind gives Player X +2.4 DK.

It just establishes the condition.

4. Market Signals

This should capture both the current market and movement.

market_signals:

event_id

spread:
  open
  current
  movement

total:
  open
  current
  movement

moneyline

implied_team_totals

player_props:
  player_id
  market
  line
  price
  timestamp

notable_movements

market_timestamp
source_refs
confidence

The movement piece is important.

A total moving:

168.5 → 175.5

is more informative than simply knowing the current total is 175.5.

Same with player props.

5. News / External Context

This catches important information that doesn't fit cleanly elsewhere.

news_external_context:

finding_id

scope:
  player
  team
  event
  league

subject_id

headline_or_summary

category:
  coach_comment
  workload
  lineup_change
  injury_update
  roster_move
  strategy
  equipment
  bullpen
  travel
  disciplinary
  other

published_at
source_refs
confidence

Examples:

Coach says player will have no minutes restriction.

Starting pitcher expected around 80 pitches.

Golfer changed equipment.

Team recalled reliever because bullpen is depleted.

6. Field Sentiment

I think this needs to be deliberately separated from factual evidence.

Something like:

field_sentiment:

subject_id

sentiment:
  strongly_bullish
  bullish
  neutral
  bearish
  strongly_bearish

attention_level:
  low
  normal
  elevated
  extreme

dominant_narratives:
  [...]

potential_ownership_implication

source_channels:
  reddit
  dfs_forums
  social
  analyst_content

confidence

The important thing is:

Field Sentiment is explicitly tagged as sentiment, not fact.

So if Reddit says:

Player X is a lock.

that never gets confused with:

Coach confirmed Player X is starting.

That separation should be hard-coded.

7. Competitive Context

This should probably be both team/event level and player level where relevant.

competitive_context:

team_or_player_id

season_stage

standings_position

games_remaining

playoff_status:
  clinched
  fighting_for_position
  bubble
  elimination_risk
  eliminated
  not_applicable

seeding_implication

qualification_implication

rest_incentive

urgency_level:
  low
  normal
  elevated
  extreme

evidence_of_behavior_change:
  true
  false
  unknown

behavior_evidence:
  [...]

source_refs
confidence

The field I particularly like is:

evidence_of_behavior_change

because that enforces our earlier rule.

A must-win narrative does not automatically matter.

Research has to identify evidence that it is affecting behavior.

Player Evidence Record

Rather than making Sport Adjustment search through seven separate buckets every time, Research should also produce a consolidated player evidence record.

For example:

PLAYER_EVIDENCE

player_id
player_name

availability_summary
recent_role_summary
recent_form_summary
matchup_summary
market_summary
news_summary
field_sentiment_summary
competitive_context_summary

key_findings:
  [...]

risks:
  [...]

unknowns:
  [...]

source_confidence:
  high
  medium
  low

This is essentially the player's research dossier.

No projection.

No recommendation.

Just:

Here's what we currently know about this player.

Conflicting Information

This needs to be first-class in the contract.

Sports information changes quickly.

Instead of silently choosing one source, Research should record:

CONFLICT

subject:
Player X status

source_a:
Official team
Status: Questionable
Timestamp: 4:12 PM

source_b:
Beat reporter
Status: Expected to play
Timestamp: 5:03 PM

resolution:
Unresolved

preferred_source:
Official team

watch_required:
True

That makes the Learning Loop much stronger later.

Unknowns

Research should explicitly admit what it does not know.

unknowns:

- Carrington expected minutes
- confirmed Chicago starting lineup
- exact wind speed during final golf pairing

This matters because downstream agents can reduce confidence instead of inventing certainty.

Watch Items

Research should output anything likely to change before lock.

watch_items:

item_id
subject
expected_update_time
importance:
  low
  medium
  high
  critical

affected_players
affected_research_buckets

Example:

WATCH ITEM

Subject:
Carrington workload

Expected Update:
Pregame media availability

Importance:
High

Affected Players:
Carrington
Jaquez
Cloud

That feeds directly into the Learning Loop.

Source Quality

Every source should have a classification.

I'd keep this simple:

source_quality:

TIER_1:
  official_league
  official_team
  official_event
  official_stats
  sportsbook_market

TIER_2:
  credentialed_reporter
  established_data_provider
  established_sports_media

TIER_3:
  specialist_analysis
  dfs_content
  community_reporting

TIER_4:
  reddit
  social
  forums
  unverified_commentary

Research can still use Tier 4 heavily for field sentiment.

It just cannot treat it like Tier 1 evidence.

Recency

I’d make every finding carry:

published_at
retrieved_at
age_minutes

And allow Research to classify it:

Fresh
Current
Aging
Stale

The threshold can eventually vary by sport and finding type.

An injury report from six hours ago might still be useful.

A starting lineup prediction from six hours ago might be stale 15 minutes before lock.

Research Status

At the end:

research_status:

COMPLETE
PARTIAL
BLOCKED

COMPLETE
Enough evidence exists to move into Sport Adjustment.

PARTIAL
We can proceed, but material unknowns remain.

BLOCKED
Something necessary cannot currently be established.

For example:

Golf weather source unavailable and tee-wave conditions are critical to this slate.

That doesn't necessarily mean the entire engine always stops, but it tells downstream stages not to pretend confidence is high.

Research Output → Sport Adjustment Input

So the handoff becomes very clean:

ValidatedSlate
      +
ResearchPackage
      ↓
SPORT ADJUSTMENT

Sport Adjustment receives both because it needs:

Slate to understand the contest.

and

ResearchPackage to understand current reality.

The important boundary remains:

Research may collect statistics, markets, news and sentiment. It does not change a player's fantasy expectation.

That happens next.

And when we get to Research Sources, I think we should define them separately by bucket rather than saying “search the web,” because Availability should have a very different source hierarchy than Field Sentiment.

Let's talk sources 

Yes. I’d define Research Sources by research bucket, because the right source for Availability is not the right source for Field Sentiment.

The clean principle should be:

Use the highest-authority source available for facts, and use lower-authority sources mainly for context, interpretation, and sentiment.

Research Source Hierarchy
1. Availability

This should be the strictest source hierarchy.

Primary

Official league injury reports
Official team injury reports
Official team starting lineups / roster announcements
Official tournament withdrawal lists
Official MLB lineup cards / transaction wires

Secondary

Credentialed beat reporters
Established injury/news providers such as RotoWire, ESPN, CBS Sports
Team pregame media availability

Avoid as authoritative

Reddit
X/social speculation
DFS personalities saying someone is “expected” to play without sourcing

Rule:

Official availability overrides everything else unless a newer credible report materially updates it.

2. Recent Role / Form

This should lean heavily on structured stats.

Primary

Official league/stat sites
NBA/WNBA stats
MLB / Baseball Savant
PGA Tour stats
NFL Next Gen Stats
official box scores / play-by-play

Secondary

Basketball Reference
Baseball Reference
Stathead
FanGraphs
StatMuse
ESPN game logs

Specialist

PFF for NFL role metrics
DataGolf for golf
advanced DFS/statistical providers where available

Rule:

Prefer raw structured data over articles summarizing recent performance.

3. Matchup / Environment

This varies by sport.

Weather

National Weather Service
NOAA
trusted weather APIs
Windy / course-specific weather tools as secondary

Venue / course / park

Official league/event source
Baseball Savant park factors
PGA Tour course data
DataGolf
official stadium/course information

Opponent / matchup statistics

Official league data
Baseball Savant / FanGraphs
NBA/WNBA advanced stats
NFL Next Gen Stats / PFF
DataGolf

Rule:

Environment should come from objective data sources first, not analyst opinion.

4. Market Signals

This should be sourced from actual betting markets whenever possible.

Primary

DraftKings Sportsbook
FanDuel Sportsbook
Caesars
BetMGM

Even though the DFS engine is DraftKings-only, I would still allow other sportsbooks as market-information sources. They aren't defining the DFS contest; they're helping us understand market expectations.

Aggregators / secondary

Action Network
Covers
Vegas Insider
OddsPortal-type services
consensus line feeds

Useful data:

open spread
current spread
total
moneyline
implied totals
player props
line movement

Rule:

Record the actual line and timestamp, not just “Vegas likes Team X.”

5. News / External Context

Here I’d prioritize direct reporting.

Primary

Official team/league announcements
press conferences
coach/player quotes
league transaction wires

Secondary

Reuters
AP
ESPN
The Athletic
local beat writers
credentialed reporters

Sport-specific

MLB beat reporters for bullpen usage / pitch counts
WNBA beat reporters for minutes restrictions
PGA Tour reporters for equipment/course conditions
NFL reporters for snap/workload expectations

Rule:

Whenever an article reports a coach quote, prefer the original quote/source if accessible.

6. Field Sentiment

This is where lower-authority sources become intentionally useful.

Primary sentiment sources

Reddit
sport-specific subreddits
DFS subreddits
team subreddits
X/social posts
Discord/forums if available
DFS analyst/community content

Potential examples:

r/wnba
r/fantasybaseball
r/dfsports
team-specific subreddits
golf DFS communities

We are looking for:

“locks”
popular punts
injury narratives
recency bias
players people are fading
breakout hype
ownership narratives
unusual attention spikes

Rule:

Sentiment can affect ownership/leverage assumptions. It cannot directly override factual research or player projections.

This should be a hard system rule.

7. Competitive Context

This should primarily use official standings and rules.

Primary

official league standings
official playoff rules
official tournament standings
official qualification systems
schedule / remaining games

Secondary

ESPN standings/playoff race pages
major sports publications
playoff scenario calculators

Useful data:

seed
games back
elimination number
clinching scenarios
games remaining
tiebreakers
qualification thresholds
FedExCup position
playoff advancement requirements

Rule:

Competitive context should be factual first. “They need this game more” is not enough.

The engine should also look for evidence that competitive context is changing behavior.

I’d also define approved source classes

Rather than hard-code hundreds of websites into the engine immediately, I’d classify every source.

Tier 1 — Authoritative
Official league
Official team
Official event/tournament
Official stats
Government weather
Actual sportsbook market

Used for:
facts

Tier 2 — Trusted reporting/data
Reuters
AP
ESPN
The Athletic
credentialed beat reporters
Baseball Savant/FanGraphs/DataGolf/PFF-type specialist data

Used for:
facts + context

Tier 3 — Specialist analysis
RotoWire
Action Network
DFS analysis sites
sport-specific analysts
projection services

Used for:
context, interpretation, sanity checking

Tier 4 — Community / sentiment
Reddit
X
forums
Discord
team communities

Used primarily for:
field sentiment and narrative detection

One thing I would make mandatory: source purpose

Every research finding should say why that source was used.

For example:

Finding:
Carrington expected to play

Source:
Official Chicago Sky injury report

Source Tier:
Tier 1

Used For:
Availability

Confidence:
High

Versus:

Finding:
Carrington appears likely to be popular at $4,800

Source:
Reddit + DFS discussion

Source Tier:
Tier 4

Used For:
Field Sentiment

Confidence:
Medium

That prevents the engine from accidentally treating Reddit chatter as equivalent to an official injury report.

I’d also add a conflict rule

When sources disagree:

Newest Tier 1 > older Tier 1 > Tier 2 > Tier 3 > Tier 4

But recency can occasionally override hierarchy.

Example:

Official injury report at 2 PM: Questionable
Credentialed beat reporter at 6:35 PM: “Player completed warmups and will play without restriction”

That newer Tier 2 report may be more operationally useful than the older official designation.

So the actual logic should be:

Authority × Recency × Specificity

not authority alone.

That gives us a clean Research sourcing model without overengineering it yet.

Agreed. 

Locked.

For Research, we now have both the internal contract and the source model:

Input: ValidatedSlate
Output: ResearchPackage
Seven research buckets: Availability, Recent Role/Form, Matchup/Environment, Market Signals, News/External Context, Field Sentiment, Competitive Context
Source hierarchy: Tier 1 authoritative → Tier 2 trusted reporting/data → Tier 3 specialist analysis → Tier 4 community/sentiment
Conflict logic: authority × recency × specificity
Hard rule: sentiment can inform ownership/leverage narratives, but cannot override factual research
Every finding carries: source purpose, confidence, recency, and source quality
Research can end as: COMPLETE, PARTIAL, or BLOCKED

The handoff is now:

ValidatedSlate + ResearchPackage → Sport Adjustment

We’re ready to define the Sport Adjustment internal data contract next.

Let's do it. While we're defining this it gives us an opportunity to outline the sports specific adjustment rules 

Yes. This is the right point to define both the Sport Adjustment contract and the first-pass sport-specific adjustment rules.

Sport Adjustment — Internal Data Contract
Purpose

Sport Adjustment receives:

ValidatedSlate
+
ResearchPackage

and returns:

A structured set of player- and event-level opportunity adjustments, with confidence and evidence, before fantasy points are calculated.

The key boundary remains:

Research = what is true.
Sport Adjustment = what that changes.
Projection = what that change is worth in DK points.

Input
SPORT_ADJUSTMENT_INPUT

validated_slate
research_package

adjustment_context:
  sport
  league
  contest_format
  lock_time
  minutes_to_lock

That’s enough. Sport Adjustment should not need to go back to raw screenshots or user input.

Core Output

I’d call the output:

AdjustmentPackage

ADJUSTMENT_PACKAGE

slate_id
generated_at

player_adjustments
team_event_adjustments
competitive_context_adjustments

material_deltas
confidence_summary

unresolved_adjustments
watch_dependencies

adjustment_status

The heart of it is player_adjustments.

Player Adjustment Contract

Each viable player gets a record like:

PLAYER_ADJUSTMENT

player_id
player_name

baseline_context

adjustments:
  - adjustment_type
  - direction
  - magnitude
  - rationale
  - evidence_refs
  - confidence

competitive_context:
  impact
  rationale
  confidence

net_opportunity_direction:
  materially_up
  slightly_up
  neutral
  slightly_down
  materially_down

role_certainty:
  high
  medium
  low

key_deltas

projection_notes

A WNBA example:

PLAYER_ADJUSTMENT

Player:
Olivia Nelson-Ododa

Baseline:
Normal reserve/secondary frontcourt role

Adjustments:

1.
Type:
Expected Minutes

Direction:
UP

Magnitude:
Material

Rationale:
Two frontcourt players unavailable

Confidence:
High

2.
Type:
Rebounding Opportunity

Direction:
UP

Magnitude:
Material

Rationale:
More center minutes and fewer competing rebounders

Confidence:
High

3.
Type:
Usage

Direction:
Slightly UP

Magnitude:
Moderate

Rationale:
Expanded offensive role in recent games

Confidence:
Medium

Competitive Context:
Neutral

Net Opportunity:
MATERIALLY UP

Role Certainty:
High

Still no:

31.8 DK points.

That belongs in Projection.

Adjustment Types

I’d normalize adjustment types instead of letting every sport invent free-form labels.

Core shared types:

minutes_or_playing_time
usage_or_volume
starting_role
opportunity_share
scoring_opportunity
assist_creation
rebounding_opportunity
defensive_stat_opportunity
matchup_quality
pace_or_possession_environment
workload
rest_fatigue
injury_limitation
role_certainty
weather_environment
venue_course_park
competitive_context
late_game_role

Then each sport can add its own specific types.

Magnitude

Keep magnitude simple:

NONE
SMALL
MODERATE
MATERIAL
MAJOR

And direction:

UP
DOWN
NEUTRAL

This gives Projection something structured to consume later.

Material Deltas

Sport Adjustment should explicitly identify the players whose current situation differs most from baseline.

MATERIAL_DELTAS

player_id
delta_type
baseline_state
current_state
direction
confidence

Example:

Player:
Lexie Hull

Delta:
Expected role

Baseline:
Bench / variable minutes

Current:
Expected starter

Direction:
UP

Confidence:
High

This becomes extremely useful because these are often where DK pricing is slowest to react.

Competitive Context

I’d make this explicit at both team and player level.

COMPETITIVE_CONTEXT_ADJUSTMENT

subject_id

situation:
  playoff_push
  seeding
  elimination
  clinched
  qualification_cut
  advancement
  rest_risk
  meaningless_game

evidence_of_behavior_change:
  true
  false
  unknown

affected_variables:
  minutes
  workload
  rotation_depth
  aggressiveness
  bullpen_usage
  etc.

impact:
  up
  neutral
  down

confidence

Again:

Must-win alone = no automatic adjustment.

There must be credible behavioral evidence.

Watch Dependencies

This is important because some adjustments are conditional.

WATCH_DEPENDENCY

subject:
Carrington workload

current_adjustment:
Minutes DOWN uncertainty remains

trigger:
Official unrestricted workload confirmation

if_triggered:
Recalculate Carrington, Jaquez, Cloud

importance:
High

That feeds the Learning Loop later.

Sport-Specific Adjustment Rules

This is where the sub-agents start becoming real.

I’d define a common rule framework first:

Each sport-specific agent asks: Which inputs most directly change opportunity, efficiency, or fantasy-scoring access in this sport?

Then apply sport-specific rules.

WNBA / NBA Adjustment Rules

This should probably be the most minutes-sensitive agent.

Primary adjustment order:

1. Minutes

Highest priority.

Adjust for:

starter changes
injuries
rotation shortening
foul-risk role
back-to-back
return from injury
blowout risk
playoff urgency

Rule:

A meaningful change in expected minutes should usually outweigh small recent-form differences.

2. Usage

Adjust for:

high-usage teammate out
ball-handler absence
starting lineup change
bench-to-starter transition
recent role change
3. Assist / creation role

Especially important for guards.

Adjust for:

primary ball-handler unavailable
secondary creator promoted
lineup composition
4. Rebounding opportunity

Adjust for:

missing bigs
opponent shot profile
smaller/larger lineup
positional role change
5. Stocks

Steals + blocks.

Adjust for:

increased minutes
matchup turnover rate
rim-protection role
defensive matchup assignment
6. Pace

Adjust opportunity upward/downward based on possessions.

7. Matchup

Use carefully:

defensive efficiency
positional matchup
rim protection
opponent rebounding
turnover tendency
8. Rest / fatigue

Especially:

back-to-back
3-in-4
travel
heavy prior-game minutes
9. Competitive context

Adjust only when it changes:

rotation depth
star minutes
late-game workload
rest behavior
MLB Adjustment Rules

MLB should be much more matchup- and opportunity-driven.

1. Batting order

One of the biggest inputs.

Adjust for:

leadoff/top-5 role
move up/down order
confirmed lineup
platoon bench risk
2. Handedness

Pitcher vs hitter split.

Adjust:

wOBA
ISO
K%
BB%
HR rate
platoon advantage
3. Pitch-type matchup

Adjust based on:

pitcher usage mix
hitter performance vs those pitch types
4. Quality of contact

Recent/season:

barrel %
hard-hit %
xSLG
xwOBA
5. Starting pitcher quality

Adjust hitters based on:

K%
BB%
HR/9
xERA/xFIP
handedness splits
expected pitch count
6. Bullpen quality / availability

Especially important in Showdown.

Adjust for:

bullpen fatigue
recent workload
injuries
handedness
quality of likely relievers
7. Park / weather

Adjust:

HR environment
wind
temperature
rain
humidity
8. Plate appearance expectation

Top-order hitters get more opportunity.

9. Pitcher workload

For pitchers:

expected innings
pitch count
K opportunity
leash
bullpen context
10. Competitive context

Late season:

bullpen aggressiveness
shortened starter leash
September call-ups
rest
playoff urgency
Golf Adjustment Rules

Golf should be very different.

1. Current strokes-gained profile

Most weight:

tee-to-green
approach
off-the-tee
putting
2. Birdie-or-better rate

Critical for DK scoring.

3. Course fit

Adjust for:

distance
approach ranges
driving accuracy
scrambling
par-5 scoring
green type
4. Tee-time weather wave

Major Showdown input.

Adjust for:

wind differential
rain
temperature
course softening/firming
5. Current leaderboard position

Especially Sunday.

Adjust:

finishing-position equity
aggression
protect-the-lead behavior
chase mode
6. Round-specific performance

Current tournament:

approach trend
putting sustainability
driving
recent round quality
7. Bogey avoidance

Important for floor.

8. Par-5 scoring

Important for ceiling.

9. Competitive context

Examples:

FedExCup cutoff
Tour card
Ryder Cup points
final-round advancement incentive

But again, only adjust if likely to affect behavior.

NFL Adjustment Rules
1. Snap share
2. Route participation
3. Target share
4. Red-zone role
5. Carry share
6. QB efficiency
7. OL/DL matchup
8. Pace / PROE
9. Game script
10. Weather
11. Injuries and role redistribution
12. Competitive context

For showdown:

QB/WR correlation
kicker/defense game scripts
captain role concentration
NHL, if we add it later

I wouldn’t define it deeply yet, but likely:

line assignment
PP unit
TOI
shot volume
goalie matchup
save opportunity
pace
back-to-back
home/away
playoff context
Sport Adjustment Output Status

Same pattern:

COMPLETE
PARTIAL
BLOCKED

COMPLETE
Enough evidence exists to quantify opportunity changes.

PARTIAL
Some key role assumptions remain uncertain.

BLOCKED
A critical sport-specific variable is unknown.

Example:

MLB starting lineup not confirmed and slate locks in 20 minutes.

Handoff to Projection

Projection receives:

ValidatedSlate
+
ResearchPackage
+
AdjustmentPackage

It now knows:

what contest exists
what is true
what changed
how confident we are in those changes

Then Projection can finally answer:

What is this player worth in DraftKings fantasy points?

That gives us a very clean contract.

The biggest thing I’d lock here is that Sport Adjustment is the home of the sport-specific intelligence. Research stays generic. Projection stays quantitative. The sport sub-agents live primarily here.

Agreed. Locked.

Locked.

Sport Adjustment now has:

its internal input/output contract,
standardized adjustment types and confidence,
material-delta handling,
competitive-context handling,
watch dependencies,
and first-pass sport-specific adjustment rules for WNBA/NBA, MLB, Golf, and NFL.

The handoff is:

ValidatedSlate + ResearchPackage + AdjustmentPackage → Projection

We can move to the Projection data contract next.

Let's do it 
Projection — Internal Data Contract
Purpose

Projection receives the validated contest, current research, and sport-specific opportunity adjustments, then converts those inputs into DraftKings fantasy-point distributions for every viable player.

Its job is:

Quantify what each player's current opportunity is worth under this exact DraftKings contest's scoring rules.

Projection still does not build or select lineups.

Input

Projection receives three core objects:

PROJECTION_INPUT

validated_slate
research_package
adjustment_package

projection_context:
  generated_at
  lock_time
  minutes_to_lock
  sport
  league
  contest_format

So by the time Projection starts, it already knows:

exactly which DraftKings contest we're solving,
the scoring rules,
the eligible players and salaries,
what is currently true,
what has changed from baseline,
and how confident we are in those adjustments.
Core Output

I’d call the output:

ProjectionPackage

PROJECTION_PACKAGE

slate_id
generated_at

player_projections

projection_summary
value_summary
uncertainty_summary

watch_dependencies
projection_status

The heart of it is player_projections.

Player Projection Contract

Each viable player gets something like:

PLAYER_PROJECTION

player_id
player_name
team
salary

baseline_projection

adjusted_opportunity

projected_outcomes:
  floor
  median
  ceiling

salary_efficiency:
  median_value
  ceiling_value

projection_confidence

uncertainty_factors

key_projection_drivers

watch_dependencies

For example:

PLAYER_PROJECTION

Player:
Makayla Timpson

Salary:
$6,200

Baseline Projection:
19.2 DK

Adjusted Opportunity:
- Expected minutes materially up
- Starting role
- Defensive-stat opportunity up

Projected Outcomes:
Floor: 15
Median: 24
Ceiling: 34

Salary Efficiency:
Median: 3.87 DK / $1K
Ceiling: 5.48 DK / $1K

Projection Confidence:
Medium-High

Primary Drivers:
- Expected minutes
- Starting role
- Blocks/steals opportunity

Primary Uncertainty:
- Actual closing-lineup role
1. Baseline Projection

The first responsibility is establishing what the player would normally be expected to produce before today's adjustments.

The baseline should be sport-specific, but the contract can remain generic:

baseline_projection:

method
sample_window
baseline_opportunity
baseline_efficiency
baseline_fantasy_points
confidence

For basketball, this might be:

baseline_opportunity:
  expected_minutes: 27

baseline_efficiency:
  dk_points_per_minute: 0.72

baseline_fantasy_points:
  19.4

For MLB:

baseline_opportunity:
  expected_plate_appearances: 4.2

baseline_efficiency:
  expected_dk_per_pa: ...

For Golf:

baseline_opportunity:
  holes_expected: 18

baseline_efficiency:
  scoring_distribution based on current form/course profile

The sport-specific math can differ dramatically. The output contract does not have to.

2. Adjusted Opportunity

Projection consumes the AdjustmentPackage and translates qualitative or structured deltas into actual numerical opportunity assumptions.

Example:

Sport Adjustment says:

Expected Minutes:
UP
Magnitude:
MATERIAL
Confidence:
HIGH

Projection turns that into:

baseline_minutes: 24
adjusted_minutes: 31

This is the critical handoff between the two stages.

I'd store both numbers so we can audit the change later.

adjusted_opportunity:

baseline:
  ...

current:
  ...

delta:
  ...

adjustment_refs:
  [...]

That gives the Learning Loop something concrete to evaluate afterward.

3. Component Projections

I think we should go one level deeper than just producing total fantasy points.

Where practical, Projection should estimate the components that actually generate DraftKings scoring.

For WNBA/NBA:

stat_projection:

points
three_pointers
rebounds
assists
steals
blocks
turnovers

double_double_probability
triple_double_probability

Then the scoring engine applies the exact DraftKings rules from Slate.

That is much stronger than directly saying:

Clark = 44 DK.

Instead:

23.5 points
4.0 threes
5.2 rebounds
9.1 assists
1.3 steals
0.5 blocks
4.1 turnovers
...

Then:

DraftKings Scoring Rules → fantasy projection

This makes the projection auditable.

The same applies to other sports.

MLB
hitter_projection:

plate_appearances
hits
singles
doubles
triples
home_runs
walks
rbi
runs
stolen_bases

Pitcher:

pitcher_projection:

innings
strikeouts
hits_allowed
walks
earned_runs
win_probability
quality_start_probability
Golf
golf_projection:

birdies
eagles
pars
bogeys
double_bogeys
streak_probability
bogey_free_probability
round_score
finishing_position_distribution

The exact components should be sport-specific, but the principle is universal:

Project underlying scoring events first, then convert them through DraftKings scoring.

4. Projection Distribution

This is where I would tighten the earlier floor/median/ceiling concept.

Rather than treating them as arbitrary numbers, they should correspond to defined percentiles.

For example:

projected_outcomes:

floor:
  percentile: 20
  dk_points: 24

median:
  percentile: 50
  dk_points: 34

ceiling:
  percentile: 90
  dk_points: 48

I prefer this because "ceiling" otherwise becomes subjective.

For the lean engine, we could define:

Floor = 20th percentile
Median = 50th percentile
Ceiling = 90th percentile

That gives every sport the same language despite very different underlying distributions.

Later we may want more points:

P10
P25
P50
P75
P90
P95

But we don't need that for V1.

5. Projection Confidence

This should be separate from the range itself.

A player can have a high ceiling and low projection confidence.

I'd use:

projection_confidence:

HIGH
MEDIUM
LOW

Driven primarily by things like:

role certainty,
research completeness,
sample quality,
unresolved injury status,
volatility inherent to the sport,
reliability of the adjustment.

Example:

Clark

Wide fantasy distribution
but high role certainty
therefore projection confidence can still be High.

Bench player returning from injury

unclear minutes
therefore Low confidence.

This distinction matters downstream.

6. Salary Efficiency

I agree with the lean framework we already set:

median_value =
median_dk_points / (salary / 1000)

ceiling_value =
ceiling_dk_points / (salary / 1000)

Example:

Salary:
$6,200

Median:
24

Median Value:
3.87

Ceiling:
34

Ceiling Value:
5.48

But I'd treat these as diagnostic metrics, not automatic ranking scores.

A $2,200 player can have spectacular value-per-$1K and still be a terrible lineup piece if they only project for 10 raw points.

Raw fantasy points and value both matter.

7. Probability-Based Outputs

I think there are two useful probabilities worth including from the beginning.

Probability of hitting value
probability_above_salary_target

For example:

Probability player exceeds 4x salary value.

Probability of reaching ceiling threshold

Something like:

probability_of_5x
probability_of_6x

But I would keep these optional for V1.

The more important eventual metric is:

Probability this player appears in an optimal lineup.

However, that belongs in Optimize, because it depends on all other players and salary combinations.

Projection should remain player-specific.

8. Uncertainty Factors

Every projection should explicitly state what could make it wrong.

uncertainty_factors:

- minutes restriction not confirmed
- small sample under current role
- volatile shooting efficiency
- weather could change

And optionally classify them:

uncertainty:
  role: high
  matchup: low
  environment: medium
  statistical_variance: high

This is particularly useful because different sports have inherently different variance.

MLB hitter projections will naturally carry much wider uncertainty than basketball starters.

9. Watch Dependencies

Projection inherits the watch items from earlier stages but makes the fantasy impact explicit.

Example:

WATCH_DEPENDENCY

Subject:
Carrington workload

Current Projection:
19 DK

Trigger:
Confirmed unrestricted

Potential Effect:
Expected minutes 19 → 26

Affected Projections:
- Carrington
- Jaquez
- Cloud
- Taylor

Requires Reprojection:
True

Now the Learning Loop knows exactly which projections need to be refreshed.

Projection Summary

The package should also contain a slate-level summary so Optimize doesn't need to discover obvious patterns from scratch.

Something like:

PROJECTION_SUMMARY

highest_median:
  [...]

highest_ceiling:
  [...]

best_median_value:
  [...]

best_ceiling_value:
  [...]

highest_confidence:
  [...]

lowest_confidence:
  [...]

largest_positive_adjustments:
  [...]

largest_negative_adjustments:
  [...]

This is descriptive, not recommendation logic.

Projection can say:

Hull has the best salary-adjusted median.

It still cannot say:

Put Hull in the lineup.

Projection Status

Same system as the other stages:

COMPLETE
PARTIAL
BLOCKED
COMPLETE

All materially relevant players can be projected with acceptable evidence.

PARTIAL

Some players contain significant uncertainty, but the slate remains usable.

BLOCKED

A critical unknown prevents responsible projection.

For example:

Starting QB status unknown in a single-game NFL Showdown five minutes before lineup generation.

What Projection Does NOT Do

I’d explicitly prohibit:

lineup generation
Captain selection
stacking decisions
ownership adjustments
duplication calculations
game-script portfolio construction
final player recommendations

Those belong downstream.

Projection can measure each player independently and provide the distribution that Optimize needs.

Full Handoff

So now the internal flow is:

ValidatedSlate
       +
ResearchPackage
       +
AdjustmentPackage
       ↓
    PROJECTION
       ↓
ProjectionPackage

And Optimize receives:

ValidatedSlate
+
ResearchPackage
+
AdjustmentPackage
+
ProjectionPackage

Research and Adjustment stay available because correlation and game-script construction may need context beyond individual fantasy-point projections.

One addition I think we should lock

I would make this a core Projection rule:

No projection is allowed to exist without an explicit opportunity assumption.

Meaning we should never have:

Player X = 31.7 DK

without being able to answer:

Based on how many minutes / plate appearances / innings / holes / snaps / routes / opportunities?

That gives the Learning Loop a much better diagnostic system.

If the player scores 12 instead of 32, we can distinguish:

Opportunity prediction was wrong

from

Opportunity was right, performance variance got us.

That distinction will become extremely important once this agent starts learning from completed contests.

Locked. 

Locked.

Projection now has:

ValidatedSlate + ResearchPackage + AdjustmentPackage as inputs
player-level baseline and adjusted opportunity assumptions
component/stat projections
DraftKings scoring conversion
percentile-based floor / median / ceiling
salary-efficiency metrics
confidence and uncertainty factors
watch dependencies
slate-level projection summary
COMPLETE / PARTIAL / BLOCKED status
and the hard rule that every projection must be traceable back to an explicit opportunity assumption

The next contract to define is Optimize.

Ok, let's do it 
Optimize — Internal Data Contract
Purpose

Optimize receives the fully defined DraftKings slate plus player projections and turns them into legal lineup candidates.

Its job is:

Find the strongest combinations of players for this specific DraftKings contest—not choose which lineup the user ultimately enters.

The distinction matters:

Projection evaluates players.
Optimize evaluates combinations.
Selection chooses the actual entry.

Input

Optimize should receive all four upstream packages:

OPTIMIZE_INPUT

validated_slate
research_package
adjustment_package
projection_package

optimization_context:
  generated_at
  lock_time
  minutes_to_lock

  contest_size
  user_entry_count
  max_entries_allowed

  optimization_modes:
    median
    ceiling
    tournament

I want Research and Adjustment available here even though Projection contains the fantasy numbers.

Why?

Because lineup construction sometimes needs information that doesn't belong inside an individual player's projection:

game-script relationships
teammate correlations
weather-wave relationships
pitcher/hitter conflicts
competitive context
role dependencies
Core Output

I'd call the output:

OptimizerPackage

OPTIMIZER_PACKAGE

slate_id
generated_at

candidate_lineups

optimization_summary
correlation_summary
game_script_summary

field_model
duplication_model

constraints_applied
warnings

optimizer_status

The heart is candidate_lineups.

1. Generate Every Legal Lineup

Optimize first consumes the DraftKings roster rules from ValidatedSlate.

It should not reinvent rules.

Example:

CONSTRAINTS

salary_cap: 50000
roster_size: 6

captain:
  count: 1
  salary_multiplier: 1.5
  fantasy_multiplier: 1.5

utility:
  count: 5

unique_players: true
minimum_teams: 2

Then:

Generate all legal combinations—or intelligently search the space when full enumeration is computationally impractical.

For WNBA Showdown, exhaustive enumeration may be easy.

For a large NFL Classic slate, we'd probably use constrained optimization rather than literally enumerate every permutation.

The output should behave the same either way.

2. Lineup Candidate Contract

Every candidate should have a standardized record.

LINEUP_CANDIDATE

lineup_id

players:
  - player_id
  - roster_slot
  - salary
  - projected_median
  - projected_ceiling

salary:
  used
  remaining

projection:
  floor
  median
  ceiling

correlation:
  score
  relationships

game_script:
  id
  description

field:
  projected_ownership
  leverage_score
  duplication_risk

rankings:
  median_rank
  ceiling_rank
  tournament_rank

candidate_type

risk_flags

Example:

LINEUP_CANDIDATE

Lineup:
CPT Clark
Cardoso
Mitchell
Timpson
Hull
Jaquez

Salary Used:
49,700

Salary Remaining:
300

Projection:
Floor: 124
Median: 182
Ceiling: 243

Candidate Type:
Balanced GPP

Median Rank:
3

Ceiling Rank:
2

Tournament Rank:
1

Still no:

"Enter this lineup."

That remains Selection's job.

3. Lineup Projection

The simplest calculation is:

lineup_median =
sum(player median projections)

with roster multipliers applied where necessary.

Same for:

lineup_floor
lineup_ceiling

But I would not simply sum player ceilings and call that a true lineup ceiling forever.

Why?

Player outcomes are correlated.

Eventually the better method is simulation.

For V1, summed distributions are acceptable.

Later:

Simulate the game/event thousands of times and calculate the actual lineup distribution.

I would design the contract so we can upgrade the calculation later without changing downstream interfaces.

4. Correlation

This is one of Optimize's biggest responsibilities.

Projection treats players mostly individually.

Optimize asks:

Do these players make sense together?

The contract could be:

CORRELATION_RELATIONSHIP

player_a
player_b

relationship:
  positive
  neutral
  negative

strength:
  weak
  moderate
  strong

reason
confidence

Examples:

WNBA

Clark + Mitchell:

positive
reason:
Clark assists can directly create Mitchell scoring
MLB

Batters 2–3–4:

positive
reason:
run/RBI events can score multiple lineup players simultaneously

Pitcher + opposing power stack:

negative
NFL

QB + WR:

strong_positive

RB + opposing passing stack may have game-script implications.

Golf

Same tee-time wave during a significant weather advantage:

positive_environmental

This gives us lineup-level relationships that shouldn't alter individual projections.

5. Game Scripts

This should become a first-class Optimize object.

We already used this intuitively in the lineups we've been building.

Now we formalize it.

GAME_SCRIPT

script_id

description

probability_band:
  high
  medium
  low

supporting_evidence

favored_players
hurt_players

candidate_lineups

WNBA example:

SCRIPT A

Indiana controls a competitive high-scoring game.

Favored:
Clark
Mitchell
Boston

Chicago bring-back:
Cardoso

MLB:

SCRIPT B

Painter struggles early.
STL heart of order drives scoring.
Mathews pitches effectively.

Favored:
Walker
Burleson
Baez
Mathews

Golf:

SCRIPT C

Early wave receives 2-3 mph calmer wind.
Chasing golfers score aggressively.
Leader plays conservatively.

The optimizer can deliberately produce top candidates for different plausible scripts.

That's especially important when the user has multiple bullets later.

6. Field Model

This is where Field Sentiment becomes something usable.

Research gathered:

popular narratives
likely chalk
social attention
DFS analyst consensus

Optimize can turn that into a field model.

For V1, I would keep this relatively simple:

FIELD_MODEL

player_id

ownership_estimate:
  low
  medium
  high
  extreme

captain_ownership_estimate

ownership_confidence

ownership_drivers

If reliable numerical ownership projections are available from approved DFS data sources later, we can replace:

high

with:

27.5%

without changing the architecture.

Important:

Field ownership does NOT change the player's fantasy projection.

It changes the tournament value of the lineup.

7. Leverage

Now we can formalize one of the things we've been doing intuitively.

A player or lineup has leverage when:

Its chance of producing an optimal outcome is stronger than the field's exposure to it.

Conceptually:

leverage =
optimal_probability / ownership

We don't necessarily need exact probabilities in V1.

The contract can support:

LEVERAGE

very_negative
negative
neutral
positive
very_positive

Later, simulation can make it numeric.

At lineup level:

lineup_leverage_score

This is what allows a slightly lower-median lineup to outrank a chalk optimizer lineup in a huge GPP.

8. Duplication Risk

This belongs in Optimize, not Selection.

Optimize should estimate how likely the lineup is to be shared by other entrants.

Inputs might include:

total salary used
popularity of Captain/MVP
number of chalk players
obvious punt combinations
projected ownership
contest size

Output:

duplication_risk:
  low
  medium
  high
  extreme

Eventually:

estimated_duplicates: 14

For example:

A lineup with:

$50,000 exactly
obvious star CPT
top 4 projected players
obvious $2K punt

could have:

duplication_risk: HIGH

While a $49,300 lineup with a less common Captain might be:

duplication_risk: LOW

This is important because first place split 40 ways is not equivalent to first place alone.

9. Contest Objective

Optimize should change its ranking logic using the contest information from Slate.

This is where:

Contest Size + User Entries + Max Entries

start influencing the engine.

Example objective profiles:

Small Field

Prioritize:

median: high weight
ceiling: moderate-high
leverage: moderate
duplication: moderate
Large GPP

Prioritize:

ceiling: very high
leverage: high
duplication avoidance: high
median: moderate
Single Entry

Prioritize:

Strong balance of median + ceiling + realistic first-place path.

20-max / 150-max

Optimize can generate deeper candidate pools across multiple scripts.

I would not hard-code exact weights yet.

That's something we should probably define after the full data-contract pass.

10. Multiple Rankings

This is important enough to preserve from the lean design.

Optimize should never return one unexplained master ranking only.

At minimum:

median_rank
ceiling_rank
tournament_rank

Potentially later:

leverage_rank
duplication_adjusted_rank
optimal_probability_rank

That way Selection can see:

LINEUP A
Median: #1
Ceiling: #8
Tournament: #5

LINEUP B
Median: #4
Ceiling: #1
Tournament: #1

This is much more useful than pretending one lineup is objectively "best."

11. Candidate Types

Optimize should deliberately return a diverse candidate set.

At minimum:

HIGHEST_MEDIAN

HIGHEST_CEILING

BALANCED_GPP

LEVERAGE

ALTERNATE_GAME_SCRIPT

Potentially:

LOW_DUPLICATION

So the optimizer output might look like:

CANDIDATE SET

A
Highest Median

B
Highest Ceiling

C
Best Balanced GPP

D
Best Leverage

E
Best Alternate Game Script

These may occasionally be the same lineup.

That's fine.

But the system shouldn't manufacture differences just to fill categories.

12. Redundancy Detection

This becomes important for the candidate set.

If Lineup A and Lineup B share five of six players and rely on the exact same game outcome, Optimize should recognize:

strategic_similarity: HIGH

Rather than pretending they're materially different.

Something like:

LINEUP_SIMILARITY

player_overlap: 5/6
game_script_overlap: high
projection_correlation: high

strategic_difference:
low

This becomes very valuable for Selection when the user has two or more bullets.

13. Risk Flags

Each candidate should carry risks.

Example:

RISK_FLAGS

- relies on uncertain 12-minute punt
- requires underdog to outperform betting market
- high duplication risk
- negatively correlated pitcher/hitter pairing
- weather-sensitive

Again, Optimize reports the risk.

Selection decides whether to accept it.

14. Optimization Summary

The slate-level package should summarize what the optimizer discovered.

OPTIMIZATION_SUMMARY

highest_median_lineup
highest_ceiling_lineup
best_tournament_lineup

most_common_core_players
highest_leverage_players
most_common_value_players

most_common_game_script

salary_usage_distribution

candidate_count_generated
candidate_count_retained

This helps both Selection and eventual debugging.

15. Warnings

Optimize should explicitly flag when the solution space is fragile.

Example:

WARNING

All top-10 projected lineups require Player X.

Player X has LOW projection confidence due to unresolved workload.

Recommendation:
Learning Loop recheck required before final lock.

That's much better than silently producing ten fragile lineups.

Optimize Status

Same pattern:

COMPLETE
PARTIAL
BLOCKED
COMPLETE

Valid candidate set produced.

PARTIAL

Candidates produced, but ownership/uncertainty or another material input remains weak.

BLOCKED

Cannot construct valid lineups.

Examples:

corrupted player pool
no legal lineup under salary cap
critical projection package unavailable
What Optimize Does NOT Do

This boundary should be explicit.

Optimize does not:

decide how many bullets the user should play
choose the final lineup
present the final recommendation to the user
override projections based on gut feeling
change player research
make late-news decisions itself

It answers:

What are the strongest legal lineup possibilities and what does each one optimize for?

Handoff to Selection

Selection receives:

ValidatedSlate
+
ResearchPackage
+
AdjustmentPackage
+
ProjectionPackage
+
OptimizerPackage

But its primary working object is:

candidate_lineups

So the internal flow is now:

ProjectionPackage
        +
ValidatedSlate
ResearchPackage
AdjustmentPackage
        ↓
     OPTIMIZE
        ↓
OptimizerPackage
        ↓
    SELECTION
One rule I think we should lock here

Optimize should never discard a lineup solely because it isn't the highest median projection.

It should preserve lineups that are materially superior in:

ceiling,
leverage,
duplication,
or alternate game-script coverage.

That principle is exactly what we've been doing manually when the mathematically highest-median lineup wasn't necessarily the lineup we wanted for a one-bullet GPP.

Agreed 

Locked.

Optimize now has its full contract, including:

legal lineup generation
lineup floor / median / ceiling
correlation
game scripts
field model
leverage
duplication risk
contest-objective handling
multiple rankings
candidate types
redundancy detection
risk flags
warnings
COMPLETE / PARTIAL / BLOCKED status

And the key rule is locked:

Optimize preserves strategically valuable lineups even when they are not the highest-median construction.

Next is Selection, including its user-facing UI contract.

Let's do it. We should consider that the user interface would be primarily mobile

Yes. If mobile is the primary UI, Selection needs to be designed as a compact decision surface, not a report.

Selection — Internal Data Contract
Purpose

Selection receives the optimizer candidate set, applies the user’s entry context, chooses the final lineup(s), and packages them for a mobile-first DraftKings workflow.

Optimize finds the best possibilities. Selection decides what to enter and presents it clearly enough that the user can act quickly.

Input

Selection receives:

SELECTION_INPUT

validated_slate
research_package
adjustment_package
projection_package
optimizer_package

selection_context:
  user_entry_count
  contest_size
  max_entries_allowed
  lock_time
  minutes_to_lock

The primary working object is still:

optimizer_package.candidate_lineups

The upstream packages are there for explanation, risk, and watch-item context.

Core Output

I’d call it:

SelectionPackage

SELECTION_PACKAGE

slate_id
generated_at

selected_lineups

selection_summary
portfolio_summary
watch_items
decision_status

ui_payload

The important addition is ui_payload, because Selection is explicitly the user-facing layer.

1. Selected Lineup Contract

Each final lineup gets:

SELECTED_LINEUP

lineup_id
bullet_number

players:
  - roster_slot
  - player_name
  - team
  - salary

salary:
  used
  remaining

projection:
  floor
  median
  ceiling

selection_type:
  single_entry
  highest_median
  ceiling
  balanced_gpp
  leverage
  alternate_script

game_script

why_selected

primary_risk

watch_items

confidence

The user should not need to inspect internal optimizer scores to understand the recommendation.

2. One Bullet Logic

For one entry, Selection should answer:

Which candidate gives this user the strongest realistic path to winning this specific contest?

That means considering:

median
ceiling
contest size
leverage
duplication
lineup fragility
role confidence
game-script plausibility

Not simply:

Candidate #1 by median.

Output:

ONE_BULLET

Selected:
Lineup C

Why:
Best combination of median, ceiling, and lower duplication
for a 1,200-entry single-entry contest.

Primary Risk:
Relies on Player X maintaining expanded minutes.
3. Multi-Bullet Logic

For multiple entries, the goal changes.

Selection should optimize the portfolio, not independently choose the top N lineups.

Example:

BULLET 1
Primary / highest-confidence script

BULLET 2
Alternate realistic game script

BULLET 3
Higher-leverage script

The contract should track:

PORTFOLIO_SUMMARY

total_entries

player_exposure:
  player_id
  lineups_used
  exposure_percentage

game_script_exposure

lineup_overlap

strategic_overlap

portfolio_risk

For two bullets, something as simple as:

Overlap:
2 of 6 players

Strategic Difference:
High

is useful.

4. Selection Reason

I’d force Selection to produce a short, structured reason, not a paragraph of AI explanation.

Something like:

WHY_SELECTED

projection:
Top-3 median

ceiling:
Top-2

leverage:
Positive

duplication:
Medium-Low

role_certainty:
High

contest_fit:
Strong for one-bullet GPP

Then the mobile UI can turn that into a readable summary.

This keeps the reasoning grounded in the engine rather than generating a story after the fact.

5. Primary Risk

Every lineup should have one primary risk surfaced prominently.

Not eight caveats.

Examples:

Cheap player's minutes
Blowout risk
Weather wave
Starting pitcher leash
High duplication
Injury return workload

On mobile:

Risk: Jaquez minutes if Carrington is unrestricted.

That's enough.

Users can expand for details if they want.

6. Watch Items

Selection consumes the watch dependencies from earlier stages and only surfaces the ones that could actually change the selected lineup.

WATCH_ITEM

subject
current_state
trigger
affected_lineup
importance
expected_update_time

Example:

Carrington workload
Importance: HIGH
Could affect: Bullet 1
Recheck: 6:30 PM

This naturally connects Selection to the Learning Loop.

Mobile-First UI

I would design Selection around progressive disclosure.

The first screen should answer only:

What lineup am I entering?

Not show the research dossier.

Primary lineup card

Something like:

IND vs CHI • 7:00 PM
1 Bullet • $1 GPP • 1,200 Entries

FINAL LINEUP

CPT  Caitlin Clark        $18,300
UTIL Kamilla Cardoso      $10,400
UTIL Kelsey Mitchell      $10,200
UTIL Makayla Timpson       $6,200
UTIL Lexie Hull            $2,400
UTIL Gabriela Jaquez       $2,200

$49,700 / $50,000

Median 182   Ceiling 243

[ Copy Lineup ]

That is the core screen.

Everything else should be secondary.

7. Mobile Information Hierarchy

I’d structure the page in this order:

A. Contest header

Very small:

IND–CHI • 7 PM • 1 Bullet • 1,200 entries

B. Final lineup

Largest element on screen.

C. Salary

Simple progress representation:

$49,700 / $50,000

D. Projection snapshot

Only:

Median 182 | Ceiling 243

Maybe Floor available on expand, but I wouldn't clutter the primary card with all three unless it tests well.

E. Why this lineup

Collapsed by default or one short sentence:

Why: Best one-bullet balance of ceiling, correlation and duplication.

F. Risk

⚠ Watch: Carrington workload could change Jaquez's role.

G. Details

Expandable sections:

Player reasons
Game script
Projection details
Research
Sources

That's where deeper users can inspect the engine.

8. Player-Level Mobile Interaction

Each player row should be tappable.

Example:

CPT Caitlin Clark        $18,300
Median 44 • Ceiling 60

Tap it:

CAITLIN CLARK

Why she's here
• Highest raw ceiling
• Elite assist role
• Competitive game environment

Projection
Floor: 31
Median: 44
Ceiling: 60

Key Adjustment
Expected workload: Stable / High confidence

Primary Risk
Back-to-back fatigue

Again, progressive disclosure.

9. Multi-Bullet Mobile UI

For multiple bullets, I would not stack three giant lineups vertically.

Use tabs/cards:

[ Bullet 1 ] [ Bullet 2 ]

and beneath them:

Bullet 2 differs by 4 players and covers an alternate game script.

For example:

BULLET 1
Primary Build
Median 182 • Ceiling 243

BULLET 2
Leverage Build
Median 176 • Ceiling 251

Tap to see each lineup.

This makes the portfolio understandable on a phone.

10. What NOT to show on the primary mobile screen

I would deliberately hide:

full research package
every source
raw correlation matrices
all optimizer candidates
individual percentile tables
source-confidence metadata
long narratives
detailed ownership math

That information should remain accessible under:

“Why this lineup?” or “Analysis”

but not compete with the recommendation.

The user came for:

Tell me what to enter.

The system can be sophisticated without making the UI feel sophisticated.

11. Selection Status

I’d define:

READY
READY_WITH_WATCH
HOLD
REBUILD_REQUIRED
READY

Lineup is final based on current information.

READY_WITH_WATCH

Lineup is usable, but a known pre-lock event needs monitoring.

HOLD

Do not present as final yet because a critical answer is imminent.

Example:

Starting lineup posts in 8 minutes.

REBUILD_REQUIRED

A new event invalidated the selected lineup.

This is more user-friendly here than COMPLETE/PARTIAL/BLOCKED because Selection is action-oriented.

12. UI Payload

The actual internal output for mobile could be intentionally simple:

UI_PAYLOAD

header
selected_lineup_cards

primary_action:
  copy_lineup

secondary_actions:
  view_reasoning
  view_player_details
  view_watch_items

status_banner

last_updated
next_recheck

Later, if technically feasible, copy_lineup could format the roster specifically for fast DraftKings entry.

I would not assume direct DraftKings lineup submission unless we actually have an authorized integration.

13. Explanation Depth

I'd support three layers:

Layer 1 — Decision

Here's your lineup.

Layer 2 — Why

Here's why this construction won.

Layer 3 — Evidence

Here are the research, projections, sources, and optimizer details.

Mobile opens at Layer 1.

That is probably the most important UX principle for Selection.

What Selection Does NOT Do

Selection does not:

gather new research
alter player projections
generate previously unseen lineup combinations
reinterpret DraftKings rules
silently change a lineup after presenting it
submit entries without explicit user action

If it encounters a problem, it sends the engine backward to the appropriate stage.

Handoff to the Learning Loop

Selection outputs:

SelectionPackage
+
selected lineup IDs
+
watch items
+
selection rationale
+
decision status

The Learning Loop then monitors the assumptions that matter specifically to those selected entries.

So the handoff is:

OptimizerPackage
      ↓
   SELECTION
      ↓
SelectionPackage
      ↓
 MOBILE USER
      ↕
LEARNING LOOP

I’d define the Selection stage in one sentence as:

Choose the best DraftKings entry or portfolio for the user's contest context, then present it mobile-first with the lineup first, reasoning second, and evidence on demand.

Shouldn't the the mobile screens have some type of lineup save option. How would the learning loop and measurement work without it

Yes. Save Lineup should be a first-class action in Selection, not an afterthought.

Without a persisted lineup record, the Learning Loop has nothing reliable to evaluate. It would know what the engine recommended, but not necessarily what the user actually intended to play or what version was current after late changes.

I’d separate three states:

Generated — engine produced the lineup
Saved — user chose to keep/track it
Entered — user confirms they actually submitted it to DraftKings

That gives us a much cleaner measurement chain.

So the mobile card should probably have actions like:

Save Lineup
Copy Lineup
Mark as Entered

And once saved, we persist a SavedLineup object:

SAVED_LINEUP

saved_lineup_id
slate_id
lineup_id

status:
  saved
  entered
  withdrawn

saved_at
entered_at

bullet_number

players
salary_used

projection_at_save:
  floor
  median
  ceiling

selection_type
game_script
selection_rationale

risk_flags
watch_items

engine_version
research_version
projection_version
optimizer_version

The versioning fields matter a lot.

Suppose we recommend Lineup A at 4:30 PM, then an injury changes at 6:40 and the Learning Loop rebuilds it into Lineup B.

We need to know:

Which version did the user actually save/enter?

Otherwise post-contest analysis becomes garbage.

Then the Learning Loop becomes much more concrete

For every entered lineup, after the contest it can compare:

Projected vs Actual

projected median
projected ceiling
actual DK score

Player-level

projected opportunity
actual opportunity
projected DK
actual DK

Lineup-level

expected lineup rank / characteristics
actual score
actual contest finish, if available
whether the intended game script occurred

Decision-level

Was this the optimizer's highest median?
Highest ceiling?
Selection's preferred one-bullet build?
Did a late adjustment improve or hurt it?

That produces a real outcome record:

LINEUP_RESULT

saved_lineup_id

actual_dk_points
contest_finish
percentile_finish
cash_result

players:
  projected_dk
  actual_dk
  projection_error

game_script:
  expected
  actual
  matched: true/false

diagnostics:
  research_error
  adjustment_error
  projection_error
  optimization_error
  selection_error

And I think there's an important distinction here:

Saving enables learning. Entering enables performance measurement.

If I save three exploratory lineups but only enter one, the system can still study all three hypothetically, but only the entered lineup should count toward metrics like:

win rate
cash rate
average contest percentile
ROI
average projection error on played lineups
Mobile-wise, I’d change the Selection card to something like
FINAL LINEUP

CPT  Caitlin Clark        $18,300
UTIL Kamilla Cardoso      $10,400
UTIL Kelsey Mitchell      $10,200
UTIL Makayla Timpson       $6,200
UTIL Lexie Hull            $2,400
UTIL Gabriela Jaquez       $2,200

$49,700 / $50,000
Median 182 • Ceiling 243

[ Save Lineup ]
[ Copy for DraftKings ]

After saving:
[ Mark as Entered ]

And saved lineups should live in a simple My Lineups area, grouped by slate:

IND vs CHI — Aug 23
Bullet 1 — Entered
Bullet 2 — Saved only

Then the Learning Loop knows exactly what to monitor before lock and exactly what to grade afterward.

So yes, I would update Selection's responsibilities to include:

Choose → Present → Save → Track Entry State

And the Learning Loop should operate primarily against SavedLineup / EnteredLineup records, not against transient generated recommendations.

That closes a real hole in the architecture.

I think having a saved and entered option is Overkill. It's Generated and Lineup Entered.

Agreed. Saved is unnecessary state.

The cleaner model is:

Generated — the engine produced the lineup.
Lineup Entered — the user confirms this is the lineup they actually submitted to DraftKings.

That’s enough for the Learning Loop.

So Selection should persist every generated lineup as a recommendation record, but only lineups explicitly marked Entered become part of the user’s actual performance history.

The state model becomes:

LINEUP_STATUS

GENERATED
ENTERED

And the entered-lineup record can be very lean:

ENTERED_LINEUP

lineup_id
slate_id
bullet_number

entered_at

players
salary_used

projection_at_entry:
  floor
  median
  ceiling

selection_type
game_script
primary_risk

research_version
adjustment_version
projection_version
optimizer_version

That gives the Learning Loop everything it needs.

Before the contest, it knows:

This is an active lineup that matters.

After the contest, it can attach:

RESULT

actual_dk_points
contest_finish
percentile_finish
payout

player_actuals
projection_errors

game_script_result
diagnostics

And the mobile UI becomes simpler too:

FINAL LINEUP

CPT  Caitlin Clark
UTIL Kamilla Cardoso
UTIL Kelsey Mitchell
...

$49,700 / $50,000
Median 182 • Ceiling 243

[ Copy Lineup ]
[ Lineup Entered ]

Once tapped:

✓ Lineup Entered

For multiple bullets, each generated lineup has its own Entered state.

This also creates a clean measurement rule:

Generated lineups can be analyzed as recommendations. Entered lineups count toward actual user performance.

I’d lock Generated → Entered as the only lineup lifecycle for V1.

Locked. Let's move on

Next is the Learning Loop internal data contract.

This is the stage that closes the system, because it monitors entered lineups, reacts to late-breaking changes, and measures whether the engine’s assumptions were right after the contest.

Learning Loop — Internal Data Contract
Purpose

Monitor active entered lineups before lock, detect material changes, trigger targeted reruns, and measure post-contest performance so the engine can improve over time.

The Learning Loop works on Entered Lineups, not just generated recommendations.

Input
LEARNING_LOOP_INPUT

validated_slate
research_package
adjustment_package
projection_package
optimizer_package
selection_package

entered_lineups

learning_context:
  current_timestamp
  lock_time
  minutes_to_lock
  event_status

The important new object is:

ENTERED_LINEUP

lineup_id
slate_id
bullet_number
entered_at

players
salary_used

projection_at_entry:
  floor
  median
  ceiling

selection_type
game_script
primary_risk

research_version
adjustment_version
projection_version
optimizer_version

That freezes the exact state of the engine when the user marked the lineup entered.

1. Pre-Lock Monitoring

The Learning Loop inherits the watch items created throughout the engine.

WATCH_ITEM

watch_id
subject
importance
expected_update_time

current_state
trigger_condition

affected_players
affected_lineups

source_requirement

Example:

Subject:
Carrington workload

Importance:
HIGH

Current State:
Active, workload unclear

Trigger:
Confirmed unrestricted OR confirmed minutes limit

Affected Lineup:
Bullet 1

Affected Players:
Carrington
Jaquez
Cloud

The Learning Loop should not re-research the entire slate every minute. It monitors specific unresolved assumptions.

2. Change Event

When new information arrives:

CHANGE_EVENT

event_id
detected_at

type:
  injury
  lineup
  starter
  workload
  weather
  market
  withdrawal
  role
  other

subject

previous_state
new_state

source
source_quality
confidence

materiality:
  immaterial
  minor
  material
  critical

The key field is materiality.

We do not want every betting-line tick triggering a rebuild.

3. Impact Mapping

Once a material change is detected, the Learning Loop determines where the engine needs to resume.

IMPACT_MAP

change_event_id

affected_stage:
  research
  sport_adjustment
  projection
  optimize
  selection

affected_players
affected_lineups

rerun_from_stage

Example:

Change:
Player ruled OUT

Rerun From:
Research

Then:
Research
→ Sport Adjustment
→ Projection
→ Optimize
→ Selection

But:

Change:
Contest field ownership projection shifts

Rerun From:
Optimize

No reason to redo player research.

That targeted rerun behavior is important.

4. Pre-Lock Decision

After the rerun, the system compares the entered lineup with the newly selected lineup.

Output:

PRELOCK_DECISION

lineup_id

status:
  KEEP
  ADJUST
  REBUILD

reason

material_difference

replacement_lineup_id

I would define them clearly:

KEEP
New information does not materially change the recommendation.

ADJUST
A limited lineup change improves the entry while preserving its core thesis.

REBUILD
The original game script or lineup construction is no longer valid.

Because the user has already marked the lineup Entered, this should surface prominently in the mobile UI.

Example:

Lineup update recommended

Player X ruled out. Your current lineup is no longer the preferred build.

REBUILD

The system should never silently change an entered lineup.

5. Lock Snapshot

At lock, freeze the final state:

LOCK_SNAPSHOT

lineup_id
locked_at

final_players
final_salary

final_projection:
  floor
  median
  ceiling

final_game_script
final_risk_flags

research_version
adjustment_version
projection_version
optimizer_version
selection_version

This is critical for measurement.

Otherwise we might compare actual results against a projection that was updated after the contest began.

6. Post-Contest Data

Once the event finishes:

CONTEST_RESULT

slate_id
completed_at

player_results:
  player_id
  actual_opportunity
  actual_stats
  actual_dk_points

entered_lineups:
  lineup_id
  actual_dk_points

If DraftKings contest-result data is available, also:

contest_finish
percentile_finish
payout
winning_score
cash_line

If those fields are unavailable, the system can still learn from player and lineup performance.

7. Player-Level Measurement

This should be the foundation of learning.

PLAYER_MEASUREMENT

player_id

projected_opportunity
actual_opportunity

projected_dk:
  floor
  median
  ceiling

actual_dk

projection_error:
  actual_minus_median

within_expected_range:
  true
  false

Example:

Expected Minutes:
31

Actual Minutes:
19

Expected DK:
24

Actual DK:
11

Primary Error:
Opportunity projection

That is far more informative than:

Player busted.

8. Error Attribution

This is where our stage separation pays off.

ERROR_DIAGNOSIS

subject_id

error_stage:
  research
  sport_adjustment
  projection
  optimize
  selection
  variance

severity

evidence

lesson_candidate

Examples:

Research error

We missed a credible injury update.

Sport Adjustment error

We knew the player was returning from injury but incorrectly assumed a full workload.

Projection error

Minutes were correct but fantasy efficiency was consistently overestimated.

Optimize error

Player projections were strong but lineup correlation logic was poor.

Selection error

Optimizer surfaced the winning game script, but Selection chose a weaker candidate for one bullet.

Variance

Opportunity and projection were reasonable; player simply shot 2-for-14.

Variance must be a valid outcome.

Otherwise the system will overfit every bad result.

9. Lineup-Level Measurement

For each entered lineup:

LINEUP_MEASUREMENT

lineup_id

projected:
  floor
  median
  ceiling

actual_dk_points

relative_to_projection:
  below_floor
  floor_to_median
  median_to_ceiling
  above_ceiling

game_script:
  expected
  observed
  match_score

risk_outcome:
  primary_risk_triggered

If contest data is available:

finish_position
finish_percentile
cash_result
payout
roi
10. Engine-Level Metrics

Over time, the Learning Loop should maintain performance by stage and sport.

For example:

ENGINE_METRICS

sport
contest_format

projection_metrics:
  mean_absolute_error
  median_absolute_error
  percentage_within_floor_ceiling

opportunity_metrics:
  minutes_mae
  pa_mae
  innings_mae
  etc.

selection_metrics:
  average_finish_percentile
  cash_rate
  top_10_percent_rate

contest_metrics:
  roi
  average_payout

I would be careful with ROI early because small samples can be extremely noisy.

The more useful early metrics are probably:

projection error
opportunity prediction error
percentile finish
whether the intended game script occurred
11. Lessons

The Learning Loop should not directly rewrite its own rules after one contest.

Instead, it creates:

LESSON_CANDIDATE

lesson_id
sport
stage

observation
sample_count
confidence

proposed_change

Example:

Observation:
WNBA players returning from injury with no explicit workload guidance
have exceeded our projected minutes only 22% of the time.

Sample Count:
18

Proposed Change:
Increase uncertainty and reduce expected minutes
for unrestricted-but-unconfirmed returnees.

Confidence:
Medium

This is much safer than:

Carrington played 18 minutes once, therefore always downgrade returning players.

12. Learning Threshold

I would explicitly require lessons to accumulate evidence before they alter the model.

Something like:

lesson_status:
  observed
  accumulating
  validated
  rejected

Only validated lessons modify sport-adjustment or projection rules.

That prevents overfitting.

13. Versioning

Once a validated lesson changes the model:

MODEL_UPDATE

previous_version
new_version

affected_stage
affected_sport

change_summary
evidence_count
effective_date

Now future contests can be traced to the exact decision framework used.

14. Mobile UI

The Learning Loop has two very different mobile states.

Before lock

Keep it extremely simple:

Lineup status

✓ No changes detected

or

⚠ Update recommended

Then:

KEEP / ADJUST / REBUILD

with one-sentence reasoning.

After contest

Something like:

BULLET 1 RESULT

Projected Median   182
Actual              196

Finish              Top 8%

WHAT WENT RIGHT
✓ Clark workload
✓ Cardoso rebound projection
✓ Game stayed competitive

WHAT MISSED
• Hull minutes -5 vs projection

ENGINE DIAGNOSIS
Projection mostly accurate
No structural adjustment required

Then deeper analysis can be expandable.

15. Learning Loop Status

I’d use lifecycle-oriented statuses:

MONITORING
UPDATE_REQUIRED
LOCKED
RESULTS_PENDING
MEASURED
LEARNING_REVIEW
COMPLETE

That fits this stage better than COMPLETE/PARTIAL/BLOCKED.

Full closed loop

We now have:

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
  ├── Pre-lock monitoring
  ├── KEEP / ADJUST / REBUILD
  ├── Lock snapshot
  ├── Post-contest measurement
  ├── Error attribution
  └── Validated lessons
          ↓
     Future engine rules

The principle I’d lock for Learning is:

The engine learns from whether its assumptions were correct—not merely whether the lineup won or lost.

That keeps the system from confusing normal sports variance with bad decision-making.

Agreed. Locked 

Locked.

The Learning Loop contract is now defined with:

pre-lock monitoring
material change detection
impact mapping
targeted reruns
KEEP / ADJUST / REBUILD
lock snapshots
post-contest measurement
player- and lineup-level diagnostics
error attribution by engine stage
variance as a valid explanation
lesson candidates
evidence thresholds before changing rules
model/version updates
mobile pre-lock and post-contest UI states

And the core principle is locked:

The engine learns from whether its assumptions were correct, not simply whether the lineup won or lost.

At this point, we have the full internal data contract across the entire engine.

Agreed 

Great. We now have the full engine flow and contracts locked:

Slate → Research → Sport Adjustment → Projection → Optimize → Selection → Learning Loop

with DraftKings-only sourcing at the Slate layer, sport-specific adjustment logic, mobile-first Selection, and entered-lineup tracking feeding the Learning Loop.

The architecture is coherent enough now that the next useful move is to either consolidate everything into one system specification or start defining the actual agent/sub-agent boundaries and prompts against this engine.

Let's start defining the actual agent/sub-agent boundaries and prompts

Yes. Now that the system definition and data contracts are locked, I would resist creating agents for every little activity. We only need an agent where there is a real reasoning boundary.

The clean architecture is:

Sports Agent / Orchestrator
→ Slate Agent
→ Research Agent
→ Sport Adjustment Agent
 → WNBA/NBA Specialist
 → MLB Specialist
 → Golf Specialist
 → NFL Specialist
→ Projection Agent
→ Optimize Agent
→ Selection Agent
→ Learning Loop Agent

The important distinction is that the sport specialists live inside Sport Adjustment. We do not need a separate end-to-end “WNBA Agent” that also researches, projects, optimizes, etc. That would duplicate the engine and make behavior inconsistent across sports.

1. Sports Agent / Orchestrator
Boundary

The Orchestrator owns workflow state, not domain analysis.

It should:

identify where the request is in the engine
call stages in order
pass validated contracts between stages
prevent stages from crossing boundaries
route Sport Adjustment to the correct specialist
stop on BLOCKED states
initiate targeted reruns from the Learning Loop
return Selection output to the user

It should not:

research players itself
modify projections
build lineups
choose players
override specialist conclusions because of “gut feel”
System prompt
You are the Sports Agent Orchestrator for a DraftKings-only DFS decision engine.

Your responsibility is to coordinate the engine:

Slate
→ Research
→ Sport Adjustment
→ Projection
→ Optimize
→ Selection
→ Learning Loop

You do not perform the specialist reasoning owned by those stages.

Your responsibilities are:

1. Maintain workflow state.
2. Ensure each stage receives only the required validated inputs.
3. Validate that each stage returns the required data contract.
4. Route Sport Adjustment to the correct sport specialist.
5. Stop processing when a required stage returns BLOCKED.
6. Preserve warnings, uncertainty, watch dependencies, and source references across stage boundaries.
7. Route Learning Loop change events back to the earliest affected stage instead of rerunning the entire engine unnecessarily.
8. Never silently alter an Entered lineup.
9. Present only Selection's user-facing output as the lineup recommendation.
10. Preserve engine-version and package-version lineage for later measurement.

Do not:
- invent missing DraftKings contest data,
- conduct player research,
- create projections,
- generate your own lineup,
- override downstream agents without a contract or validation failure.

A recommendation is only valid when the required stages have completed successfully.

That agent should be boring. That's a feature.

2. Slate Agent
Boundary

Owns:

What exact DraftKings contest are we solving?

Inputs:

DraftKings contest/API/RSS data, or
user-supplied DraftKings screenshots

Outputs:

ValidatedSlate

It does not access Reddit, RotoWire, Vegas lines, injuries, etc.

Prompt
You are the Slate Agent for a DraftKings-only DFS engine.

Your only job is to convert raw DraftKings contest information into a validated and normalized ValidatedSlate.

You may use:
1. DraftKings contest/API/RSS data.
2. DraftKings screenshots supplied by the user.

Extract and validate:

- sport
- league
- event
- contest format
- lock time
- contest size
- user entry count
- maximum entries allowed
- salary cap
- roster construction rules
- scoring rules
- eligible player pool
- player salaries
- roster-slot eligibility

Normalize roster and scoring rules into structured fields.

Validate:
- correct sport and event
- correct contest
- player-pool integrity
- salary integrity
- roster-rule completeness
- scoring-rule completeness
- lock time
- entry constraints

Return one of:
VALID
WARNING
BLOCKED

Never:
- evaluate players,
- research injuries,
- interpret matchup quality,
- calculate projections,
- recommend lineups,
- substitute non-DraftKings salary or contest information.

Output only a ValidatedSlate and its validation metadata.
3. Research Agent
Boundary

Owns:

What is true right now?

It researches the seven locked buckets:

Availability
Recent Role / Form
Matchup / Environment
Market Signals
News / External Context
Field Sentiment
Competitive Context

It does not translate those facts into fantasy adjustments.

Prompt
You are the Research Agent for a DraftKings DFS decision engine.

Input:
ValidatedSlate

Your task is to establish the current evidence relevant to the slate.

Research exactly these seven categories:

1. Availability
2. Recent Role / Form
3. Matchup / Environment
4. Market Signals
5. News / External Context
6. Field Sentiment
7. Competitive Context

For every material finding record:
- subject/player/team/event
- finding
- source
- source tier
- source purpose
- published/retrieved timestamp
- recency
- confidence
- conflicts
- unresolved unknowns

Source hierarchy:

Tier 1:
Official league/team/event/statistics sources, government weather sources, actual sportsbook markets.

Tier 2:
Credentialed reporters and trusted reporting/data providers.

Tier 3:
Specialist analysis and DFS content.

Tier 4:
Reddit, social communities, forums, and unverified commentary.

Use Tier 4 primarily for field sentiment and narrative detection.

Never treat community sentiment as authoritative factual evidence.

When sources conflict, evaluate:
authority × recency × specificity.

Competitive context must include relevant playoff, seeding, elimination, advancement, qualification, or rest situations.

Do not assume a "must-win" situation changes player behavior unless evidence supports a behavioral change.

Do not:
- adjust player projections,
- label players as good/bad DFS plays,
- create fantasy-point estimates,
- build lineups.

Return a ResearchPackage with status:
COMPLETE
PARTIAL
BLOCKED
4. Sport Adjustment Agent

This is where I would actually introduce the sub-agent structure.

The parent Sport Adjustment Agent acts as a router and contract enforcer.

Parent boundary

It receives:

ValidatedSlate + ResearchPackage

and chooses exactly one sport specialist.

Parent prompt
You are the Sport Adjustment Agent.

Your task is to translate researched evidence into changes in player opportunity and expected behavior.

You do not calculate final DraftKings fantasy-point projections.

First identify the sport from ValidatedSlate and route the analysis to the appropriate sport specialist.

Supported specialists:
- Basketball Specialist: WNBA / NBA
- MLB Specialist
- Golf Specialist
- NFL Specialist

For each player, produce structured adjustments containing:
- adjustment type
- direction
- magnitude
- rationale
- evidence references
- confidence

Allowed directions:
UP
DOWN
NEUTRAL

Allowed magnitudes:
NONE
SMALL
MODERATE
MATERIAL
MAJOR

Also produce:
- competitive-context adjustment
- net opportunity direction
- role certainty
- material deltas
- unresolved adjustments
- watch dependencies

A competitive situation alone does not justify an adjustment. Require credible evidence that it changes workload, role, aggression, rotation, strategy, or rest behavior.

Return an AdjustmentPackage.

Never:
- assign final DK fantasy points,
- optimize salaries,
- construct lineups,
- use unsupported narrative boosts.
5. Basketball Specialist — WNBA/NBA

This is where the sport intelligence actually lives.

You are the Basketball Sport Adjustment Specialist for WNBA and NBA DraftKings contests.

Input:
ValidatedSlate
ResearchPackage

Your job is to translate evidence into opportunity adjustments.

Evaluate in this priority order:

1. Expected minutes
2. Starting/closing role
3. Usage
4. Ball-handling and assist creation
5. Rebounding opportunity
6. Steal/block opportunity
7. Pace and possession environment
8. Matchup characteristics
9. Rest, travel, back-to-back and recent workload
10. Competitive context

Minutes are the highest-priority opportunity variable.

When injuries occur, identify:
- minutes redistribution
- usage redistribution
- creation redistribution
- rebounding redistribution
- closing-lineup changes

Distinguish:
ACTIVE
from
ACTIVE WITH NORMAL WORKLOAD.

Do not assume an active player returning from injury is unrestricted without evidence.

Use season averages only as a baseline. Give greater weight to current-role samples when a structural role change explains the difference.

Return adjustments only.
Do not calculate final DK fantasy-point projections.

That prompt captures most of what we learned from ONO, Rivers, Timpson, Carrington, etc.

6. MLB Specialist
You are the MLB Sport Adjustment Specialist for DraftKings contests.

Translate current evidence into opportunity and matchup adjustments.

Evaluate:

1. Confirmed batting order
2. Expected plate appearances
3. Platoon/handedness matchup
4. Starting-pitcher quality
5. Pitch-type matchup
6. Hitter contact-quality profile
7. Strikeout and walk environment
8. Home-run environment
9. Bullpen quality and availability
10. Starting-pitcher workload/leash
11. Park factors
12. Weather
13. Competitive context

For hitters, prioritize:
- batting-order position,
- PA expectation,
- platoon advantage,
- ISO/wOBA/K% characteristics,
- barrel and hard-hit profile.

For pitchers, prioritize:
- expected innings,
- pitch count,
- strikeout opportunity,
- opponent K profile,
- run-prevention environment,
- managerial leash.

Bullpen fatigue must be treated as a late-game hitter opportunity adjustment, not as a generic narrative.

Do not chase recent home runs solely because they occurred recently. Use recent results only when supported by role or underlying contact-quality evidence.

Return structured opportunity adjustments only.
7. Golf Specialist
You are the Golf Sport Adjustment Specialist for DraftKings contests.

Translate tournament and course evidence into round-specific opportunity adjustments.

Evaluate:

1. Current strokes-gained profile
2. Tee-to-green
3. Approach
4. Off-the-tee
5. Putting
6. Birdie-or-better rate
7. Bogey avoidance
8. Par-5 scoring
9. Course fit
10. Tee-time weather wave
11. Course-condition changes
12. Current leaderboard position
13. Round-specific tournament form
14. Finishing-position implications when applicable
15. Competitive/qualification context

For Showdown, prioritize today's scoring opportunity over generic season ranking.

For final rounds, separately evaluate:
- chase aggression,
- protect-the-lead behavior,
- finishing-position equity,
- leaderboard movement potential.

Weather adjustments must be tied to the golfer's actual playing window rather than daily-average conditions.

Do not convert these adjustments into final DK fantasy points.
8. Projection Agent
Boundary

Owns:

What is the adjusted opportunity worth under this exact DraftKings scoring system?

This should be more mathematical and less narrative.

You are the Projection Agent for a DraftKings DFS engine.

Inputs:
ValidatedSlate
ResearchPackage
AdjustmentPackage

For every viable player:

1. Establish an explicit baseline opportunity assumption.
2. Apply the AdjustmentPackage.
3. Produce an adjusted opportunity assumption.
4. Project the underlying scoring components relevant to the sport.
5. Apply the exact DraftKings scoring rules from ValidatedSlate.
6. Produce a fantasy-point distribution.

Required outputs:
- baseline opportunity
- adjusted opportunity
- opportunity delta
- component/stat projections
- floor: P20
- median: P50
- ceiling: P90
- median salary value
- ceiling salary value
- projection confidence
- uncertainty factors
- watch dependencies

Hard rule:
No fantasy projection may exist without an explicit opportunity assumption.

Do not:
- generate lineups,
- choose Captain/MVP slots,
- apply ownership to fantasy production,
- recommend players.

Return a ProjectionPackage.
9. Optimize Agent
Boundary

Owns combinations, not final selection.

You are the Optimize Agent for a DraftKings DFS engine.

Inputs:
ValidatedSlate
ResearchPackage
AdjustmentPackage
ProjectionPackage

Generate legal DraftKings lineups using the exact roster and salary constraints defined in ValidatedSlate.

For every viable lineup evaluate:

- salary used and remaining
- floor
- median
- ceiling
- player correlations
- game-script coherence
- field ownership estimate
- leverage
- duplication risk
- strategic similarity to other candidates
- risk flags

Maintain separate rankings for:
- median
- ceiling
- tournament value

Generate candidate categories when genuinely distinct:
- Highest Median
- Highest Ceiling
- Balanced GPP
- Leverage
- Alternate Game Script
- Low Duplication, when useful

Do not discard a strategically valuable lineup solely because it is not the highest-median lineup.

Do not fabricate differentiation between nearly identical lineups.

Do not choose which lineup the user should enter.

Return an OptimizerPackage containing the candidate set.
10. Selection Agent

This one is both decision agent and mobile UI agent.

You are the Selection Agent and mobile presentation layer for a DraftKings DFS engine.

Inputs:
ValidatedSlate
ResearchPackage
AdjustmentPackage
ProjectionPackage
OptimizerPackage

Select the final lineup or lineup portfolio based on:
- user entry count
- contest size
- maximum entries
- projection
- ceiling
- leverage
- duplication risk
- game-script plausibility
- role certainty

For one bullet:
Choose the strongest realistic path to winning the user's specific contest, not automatically the highest-median lineup.

For multiple bullets:
Optimize the portfolio. Each additional lineup should represent meaningful strategic diversification rather than a trivial player swap.

Output:
- final lineup(s)
- salary used
- median and ceiling
- selection type
- concise reason
- game-script thesis
- one primary risk
- material watch items
- lineup overlap/exposure for multiple bullets

The interface is mobile-first.

Use progressive disclosure:

Layer 1:
Final lineup and action.

Layer 2:
Why this lineup and primary risk.

Layer 3:
Player reasoning, research, projections, and sources.

Lineup lifecycle has exactly two states:
GENERATED
ENTERED

Provide a Lineup Entered action so the user can explicitly mark the DraftKings lineup they actually submitted.

Never silently modify an Entered lineup.
11. Learning Loop Agent

This should be a persistent evaluator, not another prediction agent.

You are the Learning Loop Agent for a DraftKings DFS engine.

Your responsibilities are:

PRE-LOCK
1. Monitor material watch dependencies for Entered lineups.
2. Detect meaningful changes.
3. Determine the earliest engine stage affected.
4. Trigger a targeted rerun.
5. Compare the new Selection against the Entered lineup.
6. Return:
   KEEP
   ADJUST
   REBUILD

Never silently modify an Entered lineup.

AT LOCK
Create a Lock Snapshot containing the final lineup and exact versions of all engine packages used.

POST-CONTEST
Measure:
- projected opportunity vs actual opportunity
- projected DK distribution vs actual DK points
- lineup projection vs actual lineup score
- expected game script vs observed game script
- contest finish/payout when available

Diagnose errors as:
- Research
- Sport Adjustment
- Projection
- Optimize
- Selection
- Variance

Variance is a valid diagnosis.

Do not rewrite engine rules because of one bad outcome.

Create Lesson Candidates and accumulate evidence across contests.

Lesson states:
OBSERVED
ACCUMULATING
VALIDATED
REJECTED

Only validated lessons may modify future sport-adjustment or projection rules.

The purpose of learning is to improve the correctness of assumptions, not merely maximize retrospective lineup results.
The agent boundary map

I’d lock this shape:

                  SPORTS AGENT
                  Orchestrator
                       │
                       ▼
                  SLATE AGENT
                       │
                ValidatedSlate
                       ▼
                 RESEARCH AGENT
                       │
                ResearchPackage
                       ▼
             SPORT ADJUSTMENT AGENT
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
  Basketball         MLB            Golf
  Specialist      Specialist      Specialist
        │              │              │
        └──────────────┼──────────────┘
                       │
                AdjustmentPackage
                       ▼
                PROJECTION AGENT
                       │
                ProjectionPackage
                       ▼
                 OPTIMIZE AGENT
                       │
                OptimizerPackage
                       ▼
                SELECTION AGENT
                       │
                 Mobile UI
                       │
               GENERATED → ENTERED
                       │
                       ▼
                LEARNING LOOP
                       │
              targeted feedback
                       └──────────────► upstream
One architectural decision I would lock now

I would not create separate Research, Projection, Optimize, or Selection agents for every sport.

That leads to:

WNBA optimizer logic
MLB optimizer logic
Golf optimizer logic
NFL optimizer logic

and eventually four slightly different systems.

Instead, the sport-specific intelligence is concentrated inside Sport Adjustment, while shared stages remain shared.

That gives us:

One engine. Multiple sport brains.

And that is much closer to what we've actually designed.

Does the Slate agent need to actually be AI? Isn't this just data ingesting and structuring to the defined contract?

Correct. Slate probably should not be an AI agent at all.

What we've defined for Slate is mostly deterministic:

ingest DraftKings contest data/API/RSS or user screenshots
extract fields
normalize them into the ValidatedSlate contract
validate required fields
flag missing/inconsistent data
return VALID / WARNING / BLOCKED

That is better implemented as a service/module, not an LLM agent.

The only place AI might be useful is as a fallback for screenshot parsing when the input is unstructured. Even then, I would treat AI as an extraction helper, not as the Slate decision-maker.

So I’d revise the architecture:

Slate = deterministic ingestion + validation service

not:

Slate Agent

Conceptually:

DraftKings API / RSS / Contest Data
              │
              ├──────────────┐
              │              │
              ▼              ▼
       Structured Parser   Screenshot Parser
              │              │
              └──────┬───────┘
                     ▼
              Slate Normalizer
                     │
                     ▼
              Validation Engine
                     │
                     ▼
               ValidatedSlate

The rules should mostly be code:

if scoring_rules missing:
    BLOCKED

if user_entries > max_entries:
    BLOCKED

if salary_cap missing:
    BLOCKED

if player IDs duplicated:
    BLOCKED

if contest_size missing:
    WARNING or BLOCKED depending on requirement

No reasoning model is needed for that.

I’d actually broaden this principle across the architecture:

Use AI only where judgment is required. Use deterministic software where the answer should always be the same given the same input.

That gives us a cleaner split:

Slate → software/service
Research → AI + retrieval
Sport Adjustment → AI/specialist reasoning
Projection → probably primarily quantitative/model code, with AI consuming the adjustment contract rather than inventing numbers
Optimize → deterministic optimization/simulation code
Selection → AI reasoning + UI formatting
Learning Loop → mixture of deterministic measurement + AI diagnosis

So the system may ultimately have far fewer actual agents than stages.

That is probably the right architecture.

Agreed.  

Locked. Slate is a deterministic ingestion/normalization/validation service, not an AI agent.

That gives us a useful architecture rule for the rest of the system:

AI for judgment. Deterministic software for parsing, validation, math, optimization, and measurement where possible.

So as we continue defining boundaries, we should evaluate each stage against that rule instead of assuming every stage needs its own agent.

Agreed. So Slate is locked. Let's move to research 

Research is the first stage that really does need AI, but I would still avoid making it “one giant research agent that does everything.”

The better boundary is:

Research = AI-driven evidence gathering and synthesis, backed by deterministic source handling, recency checks, and conflict resolution rules.

I’d structure it as one Research Agent with a handful of internal research functions/workers, not seven separate autonomous agents.

What should be deterministic vs AI

Deterministic/software pieces:

source allowlist / tiering
timestamp normalization
recency calculation
duplicate-source removal
source metadata
conflict detection
required-bucket completeness checks
COMPLETE / PARTIAL / BLOCKED status
structured output validation against ResearchPackage

AI reasoning pieces:

deciding what to search for based on the slate
identifying which findings are materially relevant
synthesizing multiple sources
resolving ambiguous/conflicting evidence using authority × recency × specificity
distinguishing fact from interpretation
identifying unknowns and watch items
summarizing competitive context without over-weighting narrative
reading field sentiment and extracting dominant ownership narratives

So internally:

ValidatedSlate
      ↓
Research Planner
      ↓
Search / Retrieval
      ↓
Evidence Normalizer
      ↓
Research Agent
      ↓
Conflict + Relevance Review
      ↓
ResearchPackage

The Research Planner can be AI, but constrained.

Its job is not to answer the slate. It creates the research plan for the seven locked buckets:

Availability
Recent Role / Form
Matchup / Environment
Market Signals
News / External Context
Field Sentiment
Competitive Context

For a WNBA slate, for example, the plan might generate queries around:

official injury report
expected starters
last 5 minutes and usage
back-to-back / travel
spread and total movement
player props
coach workload comments
playoff standings / seeding implications
Reddit/DFS discussion

For MLB, that plan is totally different even though the ResearchPackage contract is the same.

That’s an important distinction: the Research Agent can be shared across sports, but its search plan is sport-aware.

I would not yet create a “WNBA Research Agent” and “MLB Research Agent.” The Sport Adjustment specialists already own the deeper sport-specific interpretation. Research should remain primarily an evidence collector.

Proposed Research Agent prompt

Something like:

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

First create a sport-aware research plan identifying the most important questions that must be answered for each bucket.

Then gather and synthesize evidence.

For every material finding include:
- subject
- finding
- research bucket
- source
- source tier
- source purpose
- published/retrieved timestamp
- recency
- confidence
- conflicts
- unresolved unknowns

Source tiers:
Tier 1: official league/team/event/statistics sources, government weather, actual sportsbook markets
Tier 2: credentialed reporters and trusted reporting/data providers
Tier 3: specialist analysis and DFS content
Tier 4: Reddit, social communities, forums, unverified commentary

Use Tier 4 primarily for field sentiment and narrative detection.

Never treat field sentiment as factual player evidence.

When sources conflict, evaluate:
authority × recency × specificity.

Competitive context must capture playoff, seeding, elimination, advancement, qualification, rest, or similar situations when relevant.

Do not infer that competitive urgency changes player behavior unless there is evidence of workload, rotation, strategy, or rest changes.

Identify:
- conflicts
- unknowns
- watch items likely to change before lock

Do not:
- calculate fantasy projections
- modify player opportunity
- rank DFS plays
- generate lineups

Return only a ResearchPackage with status:
COMPLETE
PARTIAL
BLOCKED
One thing I would add now: a Research Plan object

Before searching, it should output internally:

RESEARCH_PLAN

slate_id
generated_at

questions:
  - bucket
  - question
  - priority
  - preferred_source_type
  - freshness_requirement

For example:

Bucket:
Availability

Question:
Is Player X active, and is there evidence of a workload restriction?

Priority:
CRITICAL

Preferred Sources:
Official team / league
Credentialed beat reporter

Freshness:
Must be current today

That prevents aimless web searching.

It also gives the Learning Loop something reusable: when the slate needs a late recheck, it knows exactly which research questions to rerun.

Research should also have a stopping rule

This matters for cost and latency.

The agent should not keep searching forever trying to make everything perfect.

For each question:

stop when a sufficiently authoritative and current answer exists
continue if sources conflict
continue if the answer is materially incomplete
downgrade confidence if no better evidence exists

Example:

Official team says player is OUT.

Research stops. It does not need 12 articles confirming it.

Conversely:

Official report says Questionable, beat reporter says expected to play, no workload confirmation.

Research continues until either:

a stronger update appears, or
time/freshness threshold is reached

Then it returns the uncertainty honestly.

Where AI is genuinely adding value here

The value is not web search itself.

The value is deciding:

Which facts matter to this slate?

and:

What do these competing sources actually establish?

That's exactly the kind of task I would give an LLM.

So I’d classify Research as:

AI Agent: yes
Autonomous sub-agents: probably no
Tool/retrieval heavy: yes
Deterministic guardrails: heavily
Shared across sports: yes
Sport-aware planning: yes

That feels like the right boundary for Research before we move to Sport Adjustment.

Locked. Let's move to a Sports Adjustments 

Sports Adjustment is the stage where I would use sport-specific AI specialists, because this is the first place the system has to interpret evidence through the logic of the sport.

The clean boundary is:

Research tells us what is true. Sports Adjustment tells us what those facts mean for player opportunity.

Unlike Slate, this is not deterministic enough to be just software. And unlike Research, I would not keep this as one generic agent, because the reasoning differs too much by sport.

So I’d structure it as:

Sports Adjustment Router
→ Basketball Specialist
→ MLB Specialist
→ Golf Specialist
→ NFL Specialist

The router itself should be deterministic or extremely thin: read sport from ValidatedSlate, send the same ValidatedSlate + ResearchPackage to the correct specialist, validate the returned AdjustmentPackage.

What stays deterministic

Software should handle:

routing to the correct specialist
schema validation
allowed adjustment types
allowed direction values
magnitude enums
confidence enums
checking that every adjustment cites evidence from ResearchPackage
detecting unsupported player IDs
COMPLETE / PARTIAL / BLOCKED validation

The specialist AI handles:

interpreting role changes
deciding which research findings are actually material
identifying redistribution effects
assessing whether competitive context changes behavior
comparing current state to baseline
assigning adjustment direction/magnitude/confidence

That gives us:

ValidatedSlate
      +
ResearchPackage
      ↓
Sport Router
      ↓
Sport Specialist
      ↓
Adjustment Validator
      ↓
AdjustmentPackage
Shared specialist contract

Every sport specialist should receive the same inputs and return the same top-level structure.

Its core prompt should be something like:

You are the Sport Adjustment Specialist for a DraftKings DFS decision engine.

You receive:
- ValidatedSlate
- ResearchPackage

Your job is to translate current evidence into changes in player opportunity and expected behavior.

You do NOT calculate DraftKings fantasy-point projections.

For every materially relevant player:

1. Establish the player's baseline role/opportunity.
2. Identify evidence that changes that baseline.
3. Create structured adjustments.
4. Evaluate competitive context.
5. Identify material deltas.
6. Assign role certainty.
7. Identify unresolved dependencies.

Every adjustment must include:
- adjustment_type
- direction: UP / DOWN / NEUTRAL
- magnitude: NONE / SMALL / MODERATE / MATERIAL / MAJOR
- rationale
- evidence references from ResearchPackage
- confidence: HIGH / MEDIUM / LOW

Return:
- player adjustments
- team/event adjustments when necessary
- competitive-context adjustments
- material deltas
- unresolved adjustments
- watch dependencies
- adjustment status

Never:
- invent evidence,
- change DraftKings scoring rules,
- calculate final fantasy points,
- optimize salaries,
- construct lineups.

Competitive urgency is not itself an adjustment.
Only adjust when there is credible evidence that it changes workload, role, rotation, strategy, aggression, or rest behavior.

Then each specialist gets a much tighter sport-specific prompt.

Basketball Specialist — WNBA/NBA

This is fundamentally an opportunity redistribution agent.

Its priority order should be:

Expected minutes
Starting and closing role
Usage
Ball-handling / assist creation
Rebounding opportunity
Steal/block opportunity
Pace
Matchup
Rest/fatigue
Competitive context

The prompt:

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

When a player returns from injury, distinguish:
ACTIVE
from
NORMAL WORKLOAD.

Do not infer unrestricted minutes without evidence.

Prefer current-role samples over season averages when there is a structural reason for the role change.

Treat recent shooting results cautiously unless supported by a role or opportunity change.

Competitive context may adjust:
- rotation depth
- star minutes
- closing-role certainty
- rest risk

but only when supported by evidence.

Return adjustments only. Do not calculate DraftKings fantasy points.

This is where the Carrington example gets handled correctly:

Carrington active does not automatically mean Jaquez dead. The specialist has to interpret expected workload and redistribution.

MLB Specialist

MLB should be much more matchup and opportunity-event oriented.

Priority:

Confirmed batting order
Plate appearances
Handedness
Starting-pitcher quality
Pitch-type matchup
Contact quality
K/BB environment
HR environment
Bullpen quality/availability
Pitcher workload/leash
Park/weather
Competitive context

Prompt:

You are the MLB Sport Adjustment Specialist for DraftKings contests.

Translate current evidence into hitter and pitcher opportunity adjustments.

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

Do not boost a hitter merely because they recently homered.
Recent results matter only when supported by role, contact quality, or matchup evidence.

Bullpen fatigue should be represented as a late-game offensive opportunity adjustment.

Competitive context may affect:
- bullpen usage
- pitcher leash
- rest
- lineup selection
- September roster behavior

Return opportunity and matchup adjustments only.
Golf Specialist

Golf needs to think in terms of round-scoring conditions, not usage.

Priority:

Strokes gained
Tee-to-green
Approach
Off-the-tee
Putting
Birdie-or-better
Bogey avoidance
Par-5 scoring
Course fit
Tee-time weather
Course-condition changes
Leaderboard position
Round-specific form
finishing-position implications
competitive context

Prompt:

You are the Golf Sport Adjustment Specialist for DraftKings contests.

Translate tournament, course, leaderboard, and weather evidence into round-specific player adjustments.

Evaluate:
1. Current strokes-gained profile
2. Tee-to-green
3. Approach
4. Off-the-tee
5. Putting
6. Birdie-or-better rate
7. Bogey avoidance
8. Par-5 scoring
9. Course fit
10. Tee-time weather wave
11. Course-condition changes
12. Current leaderboard position
13. Round-specific tournament performance
14. Finishing-position equity when the DraftKings contest awards it
15. Competitive/qualification context

For Showdown, prioritize today's round opportunity over generic season ranking.

For final rounds separately evaluate:
- chase aggression
- protect-the-lead behavior
- leaderboard movement potential
- finishing-position equity

Weather must be tied to the golfer's actual playing window.

Do not assume a player is advantaged simply because they are highly ranked globally.

Return adjustments only, not DraftKings projections.
NFL Specialist

NFL is another opportunity redistribution model, but the opportunity units are different.

Priority:

Snaps
Routes
Targets
Carries
Red-zone work
QB role/efficiency
OL/DL matchup
Pace
Pass rate / game script
Weather
injuries/role redistribution
competitive context

Prompt:

You are the NFL Sport Adjustment Specialist for DraftKings contests.

Translate current evidence into changes in fantasy opportunity.

Evaluate:
1. Snap share
2. Route participation
3. Target share
4. Carry share
5. Red-zone and goal-line role
6. Quarterback efficiency and role
7. Offensive-line / defensive-line matchup
8. Pace
9. Expected pass/run game script
10. Weather
11. Injury-driven role redistribution
12. Competitive context

When a player is unavailable, explicitly determine where snaps, routes, targets, carries, and red-zone opportunities are likely to move.

Do not assume backup players inherit a missing starter's entire workload.

For Showdown, identify role relationships that may matter later for correlation, but do not construct lineups here.

Return opportunity adjustments only.
One important architecture decision

I would not allow the Sports Adjustment specialists to search the web independently by default.

They should primarily reason from ResearchPackage.

Otherwise we create two competing research systems:

Research Agent found X
Basketball Specialist searched separately and found Y

and now our data lineage becomes messy.

If the specialist encounters a missing piece it considers necessary, it should return something like:

RESEARCH_GAP

Question:
Is Carrington expected to have a minutes restriction?

Importance:
HIGH

Reason:
Cannot confidently determine role redistribution without it.

Then the Orchestrator sends that question back to Research.

That gives us a clean loop:

Research → Interpretation → research gap → Research

rather than letting every specialist wander the web.

I think that rule is worth locking:

Sports Adjustment reasons from the ResearchPackage; it does not independently create a second evidence base.

That keeps the system auditable and prevents agent drift.

Agreed 

Locked.

For Sports Adjustment:

It is an AI reasoning stage with sport-specific specialists.
Routing and schema validation are deterministic.
Specialists reason from ValidatedSlate + ResearchPackage.
They do not independently browse/search by default.
If evidence is missing, they emit a structured RESEARCH_GAP back to Research.
They return only opportunity/behavior adjustments, not DK fantasy projections or lineups.
Shared adjustment contract stays consistent across WNBA/NBA, MLB, Golf, and NFL.

Next stage to classify is Projection: whether it should actually be an AI agent, a quantitative service, or a hybrid.

Let's move to Projection 

For Projection, I would not make it a pure AI agent.

This stage is mostly math, statistical modeling, and deterministic scoring. AI can help interpret the AdjustmentPackage, but the actual projection engine should be a quantitative service with sport-specific models.

So I’d classify it as:

Projection = Hybrid

deterministic/statistical core
thin AI translation layer only where structured adjustments need to become model inputs

The boundary is:

Sports Adjustment says what changed. Projection quantifies the change into a DraftKings fantasy distribution.

A clean architecture would be:

ValidatedSlate
      +
AdjustmentPackage
      +
ResearchPackage
      ↓
Projection Input Mapper
      ↓
Sport Projection Model
      ↓
DK Scoring Engine
      ↓
Distribution + Value Metrics
      ↓
ProjectionPackage
What should be deterministic

The following should be code/model-driven:

baseline calculation
opportunity assumptions
sport-specific statistical formulas
simulation
percentile calculation
DraftKings scoring conversion
salary-efficiency calculations
confidence calculations where rule-based
output schema validation

Given the same inputs and model version, Projection should return the same result.

That reproducibility is important for the Learning Loop.

Where AI can help

The thin translation layer can handle cases where Sport Adjustment returns something like:

Minutes: MATERIAL UP
Usage: MODERATE UP
Role certainty: HIGH

and the model needs explicit numerical inputs.

But even here, I would gradually remove AI discretion.

Ideally, the adjustment rules eventually contain mappings such as:

baseline_minutes: 24

adjustment:
expected_minutes
direction: UP
magnitude: MATERIAL

mapped_minutes_range:
29–32

Then Projection doesn't need an LLM deciding whether “material” means +4 or +10 minutes.

The more we learn, the more deterministic this interface should become.

Projection should have sport-specific models

Unlike Research, I would not use one universal projection formula.

We should have:

Basketball Projection Model
MLB Projection Model
Golf Projection Model
NFL Projection Model

They all return the same ProjectionPackage, but internally they operate very differently.

Basketball Projection Model

The foundation should be:

Expected minutes × expected fantasy production per minute

but ideally built from stat components rather than just DK/min.

Inputs might include:

expected_minutes
usage_rate
assist_rate
rebound_rate
steal_rate
block_rate
turnover_rate
three_point_rate
pace
matchup_adjustments

Then project:

points
3PM
rebounds
assists
steals
blocks
turnovers
DD probability
TD probability

and run those through the exact DraftKings scoring rules from ValidatedSlate.

The Basketball model should produce a distribution, not one score.

For example:

P20: 27.4
P50: 39.1
P90: 54.7
MLB Projection Model

This likely needs two separate internal models:

Hitter model

Start with:

expected_plate_appearances

then estimate per-PA outcome probabilities:

out
single
double
triple
HR
walk/HBP
stolen-base opportunity
run probability
RBI probability

based on:

hitter skill
pitcher handedness
pitcher skill
pitch mix
bullpen
park
weather

Then simulate the hitter's expected game outcomes.

Pitcher model

Inputs:

expected_pitch_count
expected_innings
K rate
BB rate
HR rate
run prevention
opponent profile
win probability
quality start probability

Again: simulate outcomes, then apply DraftKings scoring.

MLB needs heavier simulation because the distributions are much less stable than basketball.

Golf Projection Model

Golf is naturally simulation-heavy.

Inputs:

strokes gained components
birdie rate
bogey rate
eagle probability
par-5 scoring
course fit
tee-time weather
current-round conditions
leaderboard/finish-position inputs when the contest scores them

Then simulate an 18-hole round.

Output:

birdies
eagles
pars
bogeys
double bogeys
streak bonuses
bogey-free probability
finishing position distribution
DK points distribution

For Round 4, finishing-position equity becomes part of the simulation.

NFL Projection Model

Inputs:

snaps
routes
targets
carries
red-zone usage
catch rate
yards per target
yards per carry
TD probability
QB efficiency
game environment

Then project scoring components and simulate.

Again, the shared output is:

floor
median
ceiling

even though the model underneath is different.

I would make simulation a core Projection capability

This is the major upgrade from the manual work we did earlier.

Rather than manually saying:

Clark median 44, ceiling 60

we simulate, say, 10,000 plausible performances based on expected opportunity and efficiency.

Then derive:

floor = P20
median = P50
ceiling = P90

That gives Optimize much better inputs.

It also eventually lets us estimate correlations more accurately.

Important: simulation belongs partly here and partly in Optimize

Projection simulates player outcomes.

Optimize may later run joint slate/game simulations to determine:

optimal lineup frequency
Captain optimal frequency
lineup ceiling
ownership leverage

Those are different jobs.

Projection Input Mapper

I think this small service is important.

Sport Adjustment may output:

usage:
UP / MODERATE

minutes:
UP / MATERIAL

The projection model wants:

minutes: 33.5
usage_rate: 27.2%

So there needs to be a translation layer.

Initially, it can use rule tables plus model logic.

Example:

CURRENT ROLE DATA:
last 5 starter minutes = 32.8

ADJUSTMENT:
Minutes MATERIAL UP

MODEL INPUT:
expected minutes = 33.0
range = 30–36

Crucially, it shouldn't just use:

+20% because MATERIAL.

It should look at the player's actual historical role data.

Confidence should also be quantitative where possible

Rather than AI saying:

Confidence = Medium

we can calculate it from factors such as:

opportunity uncertainty
sample size
injury uncertainty
model fit
research completeness
sport variance

Then map the result:

0.80–1.00 → HIGH
0.55–0.79 → MEDIUM
<0.55 → LOW

Exact thresholds can come later.

Projection should be versioned heavily

Every projection should carry:

projection_model:
  sport
  model_version

simulation:
  runs
  random_seed

input_versions:
  slate_version
  research_version
  adjustment_version

That matters enormously for learning.

If our basketball model improves from v1.4 to v1.5, we need to know which historical projections came from which model.

Proposed Projection system instruction

If we still use an AI component inside the stage, I would keep its prompt narrow:

You are the Projection Input Interpreter for a DraftKings DFS engine.

You do not create final projections independently.

Inputs:
ValidatedSlate
ResearchPackage
AdjustmentPackage

Your responsibility is to translate structured sport adjustments into explicit quantitative model assumptions when deterministic mappings are insufficient.

For every interpreted assumption:
- identify the baseline
- identify the adjustment
- produce the numerical assumption or range
- cite the adjustment/evidence used
- assign uncertainty

Do not:
- invent unsupported opportunities
- directly assign DraftKings fantasy points
- build lineups
- rank players

All fantasy projections are produced by the sport-specific quantitative projection model.

So the “AI” inside Projection is really an input interpreter, not the projection engine itself.

My recommendation

I’d lock Projection as:

AI Agent? Not primarily.
Quantitative service? Yes.
Sport-specific models? Yes.
Simulation? Yes.
Thin AI interpretation layer? Initially, yes.
Goal over time? Make more of the adjustment→model mapping deterministic as the Learning Loop accumulates evidence.

That keeps us from building a system where an LLM simply looks at statistics and announces:

“I project 37.8 DK points.”

That would be exactly the kind of untraceable AI slop we've been avoiding.

Agreed 

Locked.

Projection is now a hybrid quantitative service, not primarily an AI agent:

sport-specific statistical models
simulation-based floor / median / ceiling
deterministic DraftKings scoring conversion
explicit opportunity assumptions
versioned inputs/models
a thin AI interpretation layer only when structured adjustments cannot yet map cleanly into numeric model inputs

And the long-term direction is to make more of that adjustment-to-model mapping deterministic as the Learning Loop gives us evidence.

Next up is Optimize.

Let's go!

For Optimize, I would make the same call we made with Slate and Projection:

Optimize should not be an AI agent. It should be a deterministic optimization/simulation service.

This stage is math, constraints, ranking, and portfolio construction. Given the same ValidatedSlate + ProjectionPackage + field assumptions + optimization settings, it should return the same candidate set.

That reproducibility is exactly what we want.

Optimize architecture
ValidatedSlate
     +
ProjectionPackage
     +
AdjustmentPackage
     +
ResearchPackage
     ↓
Constraint Builder
     ↓
Lineup Generator
     ↓
Joint Simulation / Correlation Engine
     ↓
Field + Duplication Model
     ↓
Objective Scoring
     ↓
Candidate Ranker
     ↓
OptimizerPackage

No LLM needs to sit in the middle deciding whether one lineup "feels better."

1. Constraint Builder

This reads only the DraftKings rules from ValidatedSlate and converts them into hard optimization constraints:

salary cap
roster size
positions
CPT / FLEX mechanics
team requirements
unique players
sport-specific DraftKings restrictions

These are absolute.

If a lineup violates one, it never enters the candidate pool.

2. Lineup Generator

For small spaces like WNBA Showdown, I would exhaustively enumerate every legal lineup.

For larger slates like NFL Classic, use an optimization algorithm such as:

mixed-integer programming
branch-and-bound
constraint programming

The implementation method can differ, but the output should always be a pool of legal lineup IDs.

3. Joint Simulation

This is where Optimize becomes significantly better than just adding six player medians together.

Projection has already produced player-level distributions.

Optimize should simulate the slate jointly, preserving correlations.

For example, in WNBA:

Clark high-assist game increases the probability Mitchell scores well.

In MLB:

Walker HR can simultaneously create Walker points, RBI, and runs for hitters ahead of him.

In NFL:

QB touchdown to WR scores both players simultaneously.

Golf can share environmental effects like a weather wave.

So rather than:

Lineup ceiling =
sum(player P90)

we eventually want:

For each simulated slate:
    generate correlated player results
    score every legal lineup
    identify optimal lineup

Repeat thousands of times.

That gives us much stronger metrics.

Optimizer outputs from simulation

For every lineup, I would eventually calculate:

average DK score
median DK score
P90
probability of exceeding target score
optimal lineup frequency
top-1% lineup frequency
expected finish percentile
Captain optimal frequency where applicable

That last one directly solves problems like our earlier:

Hull CPT technically had a slightly higher median, but is Clark more likely to actually be optimal Captain?

We could answer it quantitatively.

4. Field Model

Optimize needs an estimate of what everyone else is likely to play.

This can come from:

published DFS ownership projections
Research field sentiment
historical ownership patterns
salary/optimizer behavior
obvious chalk/value combinations

I would keep the field model outside the player fantasy projection.

For each player:

projected_ownership
captain_ownership
ownership_confidence

If we don't have reliable numerical ownership, we can start with buckets:

LOW
MEDIUM
HIGH
EXTREME

But the system should be built to accept real percentages when available.

5. Duplication Model

This should also be code-driven.

Potential inputs:

player ownership
CPT ownership
salary used
obvious value plays
lineup structure
contest size
historical duplication patterns

Then estimate something like:

expected_duplicates
duplication_probability

Even a rough model is useful.

A lineup with a 1.8% chance of winning outright but likely 25 duplicates may have worse tournament value than a lineup with a 1.5% chance and likely two duplicates.

6. Contest objective

Optimize should not have one universal score.

It gets contest context from Slate and uses an objective profile.

For example:

Small-field single entry

median weight: high
ceiling: high
optimal frequency: high
leverage: moderate
duplication penalty: moderate

Large-field GPP

ceiling: very high
optimal frequency: very high
leverage: high
duplication penalty: high
median: lower weight

20-max

individual lineup score matters
but portfolio coverage also matters

I agree with our earlier decision not to lock exact weights yet.

Those should become tunable configuration.

7. Candidate Ranker

The optimizer should preserve multiple rankings.

At minimum:

median_rank
ceiling_rank
optimal_frequency_rank
tournament_rank
duplication_adjusted_rank

And candidate labels:

Highest Median
Highest Ceiling
Best Tournament EV
Best Leverage
Lowest Duplication
Alternate Game Script

If one lineup owns three categories, that's fine. We shouldn't invent fake alternatives.

8. Game-script classification

I would actually make this partly deterministic too.

The optimizer can cluster candidate lineups by their exposure patterns and correlations.

Examples:

WNBA:

IND-heavy competitive shootout
CHI upset
stars-and-scrubs value eruption

MLB:

STL stack / Painter failure
PHI stack
pitcher-dominant game

Golf:

leaderboard chalk
early-weather wave
move-up Sunday build

An AI could help label these clusters in human-readable language later, but the clustering itself can be numerical.

That distinction is useful:

Software determines that two lineups represent materially different distributions. Selection can use AI to explain what that difference means.

9. Redundancy / similarity

Also deterministic.

For every pair of candidates:

player overlap %
CPT overlap
team exposure overlap
simulated score correlation
game-script similarity

Then:

strategic_similarity:
LOW / MEDIUM / HIGH

This is especially useful for Selection when the user has two bullets.

10. Risk flags

Most should be rule-generated.

Examples:

HIGH_ROLE_UNCERTAINTY
HIGH_DUPLICATION
NEGATIVE_CORRELATION
LOW_PROJECTION_CONFIDENCE
WEATHER_DEPENDENT
LOW_MINUTES_PUNT

No need for an LLM to invent those.

Does Optimize need AI anywhere?

Very little.

I see two optional uses:

Game-script labels
Take a mathematically identified cluster and turn it into:

"Chicago upset / Cardoso interior game"

instead of cluster_03.

Explanation summaries
Help Selection understand why a candidate ranked well.

But I would actually put both in Selection, not Optimize.

So Optimize itself can remain clean.

Optimize system type

I'd lock it as:

AI Agent? No.
Deterministic service? Yes.
Statistical simulation? Yes.
Optimization algorithms? Yes.
Ownership model? Yes.
Duplication model? Yes.
Portfolio-aware? Eventually, yes.
LLM required? No.

And its contract stays:

ValidatedSlate
+
ResearchPackage
+
AdjustmentPackage
+
ProjectionPackage
        ↓
     OPTIMIZE
        ↓
OptimizerPackage

The core principle I’d lock:

Optimize should produce evidence about which lineups are strong. It should never narratively choose one because it “likes” the construction.

That decision still belongs to Selection.

I agree here. Let's lock it in 

Locked.

Optimize is now defined as a deterministic optimization/simulation service:

no AI agent
DraftKings constraint enforcement
legal lineup generation
joint slate simulation and correlation
ownership/field modeling
duplication modeling
contest-objective scoring
multiple rankings
game-script clustering
redundancy detection
rule-based risk flags

Any human-readable explanation of why a lineup won the optimizer happens downstream in Selection.

Next up: Selection.

Let's move to Selection 

Selection is the stage that does need AI, because this is where we move from mathematically strong candidates to an actual recommendation for the user.

The clean boundary is:

Optimize tells us which lineups are mathematically strong. Selection decides which lineup or portfolio best fits the user’s contest context, then explains it in a mobile-first way.

I’d make Selection a true decision + presentation agent.

Selection architecture
ValidatedSlate
    +
ResearchPackage
    +
AdjustmentPackage
    +
ProjectionPackage
    +
OptimizerPackage
        ↓
Selection Agent
        ↓
SelectionPackage
        ↓
Mobile UI
        ↓
GENERATED → ENTERED
What should remain deterministic

Some parts should still be software-driven:

number of user entries
contest size
max entries allowed
salary totals
projection/ceiling ranks
ownership/leverage metrics
duplication risk
lineup overlap
exposure calculations
whether a lineup is legal
whether a lineup was marked ENTERED

The AI should not recalculate or override those.

What AI should own

This is where judgment is useful:

choosing between multiple optimizer candidates
balancing median vs ceiling for the contest type
deciding whether a leverage lineup is too fragile for one bullet
deciding whether two bullets are strategically distinct enough
interpreting game-script clusters
choosing the right portfolio across multiple entries
explaining the recommendation in plain language
surfacing the one or two risks the user actually needs to care about

So Selection should reason over optimizer evidence, not invent a new lineup.

Hard boundary

I would lock this:

Selection may only choose from lineups already present in OptimizerPackage.

It cannot say:

“I actually like this other six-player combination better.”

If it wants something different, it sends a structured request back to Optimize.

That prevents the LLM from undoing deterministic optimization.

For example:

OPTIMIZER_GAP

Need:
Lower-duplication candidate with Clark CPT

Reason:
Existing Clark CPT candidates all have EXTREME duplication risk

Action:
Request additional optimization pass

Then Optimize returns additional valid candidates.

That’s much cleaner.

Selection Agent prompt
You are the Selection Agent for a DraftKings-only DFS decision engine.

Inputs:
- ValidatedSlate
- ResearchPackage
- AdjustmentPackage
- ProjectionPackage
- OptimizerPackage

Your job is to choose the final lineup or lineup portfolio from the candidate lineups produced by Optimize and present the recommendation to the user.

You may NOT create a lineup that does not exist in OptimizerPackage.

For each decision, consider:
- contest size
- user entry count
- maximum entries allowed
- lineup median
- lineup ceiling
- optimal-lineup frequency
- tournament rank
- leverage
- duplication risk
- correlation
- game-script plausibility
- projection confidence
- role certainty
- unresolved watch items

For ONE entry:
Choose the lineup with the strongest realistic path to winning the specific contest.
Do not automatically choose highest median.
Avoid unnecessary fragility when projection differences are small.

For MULTIPLE entries:
Select a portfolio, not simply the top N ranked lineups.
Prefer materially different game scripts or leverage profiles.
Avoid redundant lineups unless their mathematical advantage clearly justifies the overlap.

Never:
- modify player projections,
- invent ownership numbers,
- create a new lineup,
- alter DraftKings rules,
- ignore unresolved critical watch items,
- silently change an ENTERED lineup.

If the optimizer candidate set is insufficient, return an OPTIMIZER_GAP request instead of improvising.
Selection outputs

The SelectionPackage we defined still works well:

SELECTION_PACKAGE

slate_id
generated_at

selected_lineups
selection_summary
portfolio_summary
watch_items
decision_status
ui_payload

Each selected lineup should include:

SELECTED_LINEUP

lineup_id
bullet_number

players
salary_used
salary_remaining

projection:
  floor
  median
  ceiling

optimizer_metrics:
  median_rank
  ceiling_rank
  tournament_rank
  optimal_frequency
  leverage
  duplication_risk

selection_type
game_script
why_selected
primary_risk
watch_items
confidence

Notice that Selection inherits those metrics. It doesn’t calculate them.

One-bullet decision rule

We should avoid a simplistic weighted formula here.

For one bullet, I’d instruct the agent to evaluate candidates in this order:

Is the lineup viable for first place?
Is the game script reasonably likely?
Is its ceiling strong enough for the contest size?
How much median projection are we sacrificing?
Is the leverage gain worth that sacrifice?
Is duplication acceptable?
Does it rely on low-confidence assumptions?

This captures what we did manually with Clark CPT vs Hull CPT.

The question wasn’t:

Which projection is 0.8 points higher?

It was:

Is that tiny median advantage worth multiplying the wrong player's outcome in a one-bullet tournament?

That’s Selection reasoning.

Multi-bullet selection

For multiple bullets, I’d give Selection an explicit portfolio objective.

For example, two bullets:

Bullet 1

Best overall contest-fit candidate.

Bullet 2

Best materially different candidate that protects against a plausible failure mode of Bullet 1.

That’s a much stronger rule than:

take tournament rank #1 and #2.

Selection should look at strategic_similarity.

Example:

Bullet 1
IND-controlled high-total script

Bullet 2
CHI upset / Cardoso-Cloud script

Player overlap: 2/6
Simulated score correlation: 0.41
Strategic similarity: LOW

That is real diversification.

User-facing explanation

Selection should generate very little prose by default.

For each lineup:

Why this one: Top-3 ceiling, positive leverage, lower duplication than the median leader.

Game script: Indiana controls a competitive high-scoring game.

Risk: Cheap-player minutes.

That’s enough on the first screen.

The underlying engine can be extremely sophisticated without forcing the user to read a research report.

Mobile-first UI

I’d keep the primary card very close to what we already designed:

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
correlation, and duplication.

Risk:
Jaquez minutes.

[ Copy Lineup ]
[ Lineup Entered ]

Then expandable:

Why this lineup
Player details
Game script
Watch items
Full analysis

Generated → Entered

We already locked the lifecycle:

GENERATED
ENTERED

Selection owns the transition presentation, but the actual state update should be deterministic application logic.

The AI doesn't decide whether a lineup is entered.

The user explicitly taps Lineup Entered.

That action stores:

lineup ID
timestamp
current projection snapshot
current engine versions
game script
risk flags
watch dependencies

That record feeds the Learning Loop.

Decision statuses

I’d retain:

READY
READY_WITH_WATCH
HOLD
REBUILD_REQUIRED

But I’d clarify ownership.

Selection can issue:

READY
Recommendation is usable now.

READY_WITH_WATCH
Recommendation is usable, but a known item may change it.

HOLD
Critical information is expected imminently and current selection is too unstable.

REBUILD_REQUIRED is more naturally triggered by the Learning Loop after new information arrives, but Selection can render that state in the UI.

Does Selection need sport-specific sub-agents?

I don't think so.

This is important.

The sport-specific reasoning already happened in Sport Adjustment. Projection and Optimize normalized the outputs.

By Selection, the decisions are largely universal:

median vs ceiling
leverage
duplication
contest size
portfolio diversification
risk confidence

So:

WNBA Selection Agent
MLB Selection Agent
Golf Selection Agent

would be unnecessary duplication.

One shared Selection Agent is cleaner.

Classification

I’d lock Selection as:

AI Agent? Yes.
Sport-specific? No.
Creates lineups? No.
Selects optimizer candidates? Yes.
Owns portfolio judgment? Yes.
Owns user-facing explanation? Yes.
Mobile-first? Yes.
Can change an entered lineup? Never silently.
Can request more optimizer candidates? Yes, through OPTIMIZER_GAP.

The core principle is:

Selection is allowed to exercise judgment over mathematically valid choices. It is not allowed to replace the math.

We need to define the tone here to be friendly but knowledgeable sports expert 

Yes. I’d make that an explicit Selection voice contract, because this is the stage the user actually experiences.

The tone should be:

Friendly, confident, knowledgeable sports expert — concise, grounded, and never hypey.

I’d define it with a few rules:

Sound like a sharp sports analyst, not a quant dashboard.
Explain the why in plain English.
Be confident when the evidence is strong, but acknowledge uncertainty when it matters.
No fake certainty, no “lock of the century,” no over-the-top gambling language.
Use sports language naturally, but don’t drown the user in jargon.
Keep mobile responses tight: lineup first, reasoning second.
When something is risky, say exactly what the risk is.
When a lineup is contrarian, explain the game script that makes it work.

I’d add this directly to the Selection prompt:

VOICE AND TONE

You are a friendly, knowledgeable sports expert.

Speak like someone who understands the sport, DFS strategy, and the specific slate deeply.

Your tone should be:
- conversational
- confident but not overconfident
- concise
- analytical
- practical
- easy to follow on mobile

Explain decisions in plain English.

Prefer:
"Clark has the strongest one-bullet Captain ceiling because her scoring and assist paths both remain live in a competitive game."

Avoid:
"Clark is an absolute smash lock and cannot fail."

Do not use exaggerated gambling language, fake certainty, or unnecessary technical jargon.

When uncertainty matters, state it clearly:
"The main risk is Jaquez's minutes if Carrington returns to a full workload."

Lead with the recommendation.
Then explain the most important reasons.
Keep deeper evidence available behind expandable detail rather than overwhelming the primary response.

And I’d probably define the user-facing personality in one line for the product team:

“The friend who knows the slate cold.”

Not a tout. Not a professor. Not a chatbot reading a spreadsheet.

That feels like the right voice for Selection.

Agreed. Locked. Let's move on 

Next is Learning Loop, and this one should be hybrid, not a single AI agent.

The clean boundary is:

Learning Loop monitors entered lineups, detects meaningful changes, measures outcomes, diagnoses where the engine was right or wrong, and proposes evidence-backed lessons.

I’d split it into three parts:

1. Deterministic Monitoring Service

This should handle:

watch-item polling/rechecks
timestamps
change detection
materiality thresholds
lock snapshots
entered-lineup state
actual DK scoring/results
projection error calculations
contest finish / payout / ROI when available

Given the same inputs, this should always produce the same measurement.

2. Impact Router

Mostly deterministic.

When something changes, it decides where to restart the engine:

injury/news change → Research
role interpretation change → Sport Adjustment
numeric assumption change → Projection
ownership/field change → Optimize
candidate-set decision change → Selection

It should trigger the smallest necessary rerun rather than starting over.

3. Learning & Diagnosis Agent

This is where AI is useful.

It receives the measured results and asks:

Why was the prediction wrong or right?

It classifies outcomes into the categories we locked:

Research error
Sport Adjustment error
Projection error
Optimize error
Selection error
Variance

The important rule is that variance is allowed. A player shooting 2-for-15 does not automatically mean the model was bad if minutes, usage, and opportunity were projected correctly.

A lean prompt would look like:

You are the Learning & Diagnosis Agent for a DraftKings DFS decision engine.

Your job is to diagnose completed and pre-lock decisions using measured evidence.

PRE-LOCK:
When a material change is detected, determine the earliest affected engine stage and recommend:
KEEP
ADJUST
REBUILD

Never silently alter an Entered lineup.

POST-CONTEST:
Compare:
- projected opportunity vs actual opportunity
- projected component stats vs actual stats
- projected DK distribution vs actual DK score
- intended game script vs observed game
- selected lineup vs optimizer alternatives

Classify meaningful errors as:
RESEARCH
SPORT_ADJUSTMENT
PROJECTION
OPTIMIZE
SELECTION
VARIANCE

Do not infer a model failure solely because a lineup lost.

For each diagnosis:
- state what assumption was tested
- state what actually happened
- identify the earliest stage responsible
- cite the supporting measurements
- assign confidence

Create Lesson Candidates only when the finding could generalize beyond one contest.

Never modify engine rules from a single outcome.

Lessons must progress through:
OBSERVED
ACCUMULATING
VALIDATED
REJECTED

Only VALIDATED lessons may be promoted into future engine rules.
Mobile behavior

Before lock, the Learning Loop should be nearly invisible unless something matters:

✓ Lineup current
or
⚠ Update recommended — starter ruled out

Then KEEP / ADJUST / REBUILD.

After the contest, it can show a compact recap:

Projected: 182
Actual: 196
Finish: Top 8%

What worked: minutes and game script
What missed: Hull played 5 fewer minutes than projected
Diagnosis: normal projection variance; no model change

That’s enough on mobile, with deeper diagnostics expandable.

So I’d classify Learning Loop as:

AI agent? Partially.
Deterministic monitoring/measurement? Yes.
AI diagnosis? Yes.
Automatically rewrites model rules? No.
Can trigger targeted reruns? Yes.
Can silently change entered lineups? Never.

That would complete the agent/service boundary pass across the entire engine.

Agreed.

Locked.

At this point, the architecture is clean:

Deterministic / service layers

Slate
Projection core
Optimize
Learning Loop monitoring + measurement

AI reasoning layers

Research
Sport Adjustment specialists
Selection
Learning & Diagnosis

Hybrid

Projection input interpretation
Learning Loop overall

And we’ve also locked the key behavior rules:

DraftKings-only
sport-specific intelligence lives in Sport Adjustment
Selection is mobile-first and user-facing
Selection tone = friendly, knowledgeable sports expert
Generated → Entered is the only lineup lifecycle
Entered lineups feed Learning
Learning diagnoses assumptions, not just wins/losses
no silent changes to entered lineups

We now have the full agent/service boundary model defined.