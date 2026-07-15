# YSNT Framework — App Hardening Phase

## What You're Hardening

Security, performance, and design system relocation to admin console.

---

## Your App Hardening Phase

### Part 1 — Supabase RLS Audit (~1 hr)

**Prompt to Claude Code:**
```
TASK: Audit and strengthen Row Level Security policies

1. Review all RLS policies in Supabase:
   - users: only SELECT own row ✓
   - mios_manifest: only SELECT own manifests ✓
   - ranked_lineups: only SELECT own lineups ✓
   - saved_lineups: only SELECT own saved lineups ✓
   - player_last_5_stats: public READ (no auth required) ✓
   - social_sentiment: public READ (no auth required) ✓
   - draftkings_contests: public READ (no auth required) ✓

2. Test RLS in Supabase:
   - Log in as different users
   - Verify User A cannot see User B's manifests/lineups
   - Verify unauthenticated users can read cache tables (stats, sentiment, contests)
   - Verify all INSERT/UPDATE/DELETE operations are denied for regular users

3. Add UPDATE policies for managed operations:
   - Allow users to UPDATE saved_lineups (actual_points, user_feedback)
   - Allow users to UPDATE users table (tier only, via trigger on payment)

Output: All RLS policies reviewed and tightened
```

### Part 2 — Edge Function Auth (~1 hr)

**Prompt to Claude Code:**
```
TASK: Add JWT validation and auth checks to Edge Functions

1. Update trigger-mios-scan Edge Function:
   - Extract JWT from Authorization header
   - Validate JWT (Supabase will do this automatically)
   - Extract user_id from JWT
   - Verify user_id matches request
   - Check user tier: free users max 1 scan/day
   - Return 403 if not authorized

2. Update generate-pios-lineups Edge Function:
   - Validate JWT
   - Extract user_id
   - Verify user owns the manifest_id
   - Return 403 if not authorized

3. Service-role functions (don't require auth):
   - cache-player-stats
   - fetch-reddit-sentiment
   - sync-draftkings-contests
   - Use service role key (not exposed to client)

Output: All Edge Functions protected with auth checks
```

### Part 3 — Environment & Secrets (~30 min)

**Prompt to Claude Code:**
```
TASK: Audit secrets and environment variables

1. Check src/lib/supabaseClient.ts:
   - Uses import.meta.env.VITE_SUPABASE_URL (good, public URL)
   - Uses import.meta.env.VITE_SUPABASE_ANON_KEY (good, anon key only, not secret)
   - Does NOT have service role key in client code

2. Update .env.local (NOT in git):
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   VITE_CLAUDE_API_KEY=...
   VITE_OPENAI_API_KEY=...
   VITE_REDDIT_CLIENT_ID=...
   VITE_REDDIT_CLIENT_SECRET=...

3. Update .env.example (IN git):
   VITE_SUPABASE_URL=
   VITE_SUPABASE_ANON_KEY=
   VITE_CLAUDE_API_KEY=
   VITE_OPENAI_API_KEY=
   VITE_REDDIT_CLIENT_ID=
   VITE_REDDIT_CLIENT_SECRET=

4. Verify .gitignore includes:
   .env.local
   .env.*.local

5. Check for API keys in code:
   - Search codebase for hardcoded keys (should find none)
   - grep -r "sk-" src/ (find any hardcoded OpenAI keys)
   - grep -r "pk_" src/ (find any hardcoded Stripe keys)

Output: No secrets in code, all in .env.local
```

### Part 4 — Performance Audit (~1 hr)

**Prompt to Claude Code:**
```
TASK: Optimize performance

1. Lighthouse audit:
   - Run: npm run build
   - Use Lighthouse CI or browser dev tools
   - Target: 90+ for Performance, Accessibility
   - Check: largest contentful paint, cumulative layout shift, first input delay

2. Database query optimization:
   - Add indexes on frequently queried columns:
     - players_last_5_stats(player_id, sport)
     - mios_manifest(user_id, created_at)
     - ranked_lineups(user_id, created_at)
   - Test query performance in Supabase

3. Bundle size optimization:
   - npm run build
   - Check dist/ folder size
   - If > 500KB, remove unused dependencies
   - Use code splitting for routes

4. API call optimization:
   - Batch MIOS collections in parallel (already doing this)
   - Cache aggressive: 24-hour TTL for player stats, sentiment, contests
   - Compress responses: gzip enabled on Supabase

Output: Lighthouse 90+, load time < 3s
```

### Part 5 — Migrate Design System to Admin Console (~1 hr)

**Prompt to Claude Code:**
```
TASK: Move design system from public /design-system to admin console

1. Create src/pages/admin/AdminConsole.jsx:
   - Requires admin role (RLS check)
   - Links to: DesignSystem, Analytics (placeholder), User Feedback (placeholder)
   - Dashboard showing: total scans, active users, accuracy stats

2. Move DesignSystem.jsx:
   - From src/pages/DesignSystem.jsx
   - To src/pages/admin/DesignSystem.jsx
   - No changes to component itself, just location

3. Update routes in App.jsx:
   - Remove: <Route path="/design-system" element={<DesignSystem />} />
   - Add: <Route path="/admin/design-system" element={<AdminConsole><DesignSystem /></AdminConsole>} />
   - Add role check: only users with is_admin=true can access

4. Create AdminGuard component:
   - Check user's is_admin status (from users table)
   - If false, redirect to "/"
   - If true, render children

5. Update Navigation.jsx:
   - Remove "Design System" link
   - Add "Admin" link (only visible if user.is_admin=true)

6. Test:
   - Admin user: can access /admin/design-system ✓
   - Non-admin user: navigating to /admin/design-system redirects to home ✓
   - Non-admin user: cannot see "Admin" link in nav ✓

Output: Design system moved to admin console, protected by role check
```

### Part 6 — Pre-Launch Checklist (~30 min)

**Prompt to Claude Code:**
```
TASK: Final security and monitoring setup

1. Error monitoring:
   - Set up Sentry (sentry.io)
   - Install: npm install @sentry/react
   - Initialize in src/main.jsx
   - Errors automatically logged to dashboard

2. Analytics:
   - Set up Vercel Analytics (if deploying to Vercel)
   - Or use Plausible (plausible.io, privacy-focused)
   - Track: scans, lineups saved, export clicks

3. CORS policies:
   - Verify Supabase CORS allows origin
   - Verify ESPN/Reddit APIs allow client-side requests

4. HTTPS:
   - Ensure custom domain has HTTPS certificate
   - Vercel does this automatically

5. Database backups:
   - Enable automatic backups in Supabase
   - Test restore process once

6. Monitoring:
   - Set up uptime monitoring (Uptime Robot, free tier)
   - Alert if site goes down

7. Documentation:
   - README.md updated with setup instructions
   - CONTRIBUTING.md with dev guidelines (optional)
   - ENV_EXAMPLE.md explaining each variable

Output: App is secure, monitored, and ready for production
```

---

## App Hardening Deliverables Checklist

- [ ] All RLS policies reviewed and locked
- [ ] RLS tested: users cannot see each other's data
- [ ] Edge Functions authenticated with JWT
- [ ] Scan rate limiting checked (free: 1/day, pro: unlimited)
- [ ] No API keys in client-side code
- [ ] All secrets in .env.local
- [ ] .env.example includes all required keys
- [ ] Database indexes added for performance
- [ ] Lighthouse score 90+
- [ ] MIOS collection < 90 seconds
- [ ] Design system moved to /admin/design-system
- [ ] Admin guard protecting /admin routes
- [ ] Admin users can access design system
- [ ] Non-admin users redirected from /admin
- [ ] Sentry error monitoring configured
- [ ] Analytics tracking working
- [ ] CORS policies verified
- [ ] Database backups enabled
- [ ] Uptime monitoring set up
- [ ] README.md updated
- [ ] Code committed to GitHub

---

*Next up → Monetize & Auth: users, payments, launch*
