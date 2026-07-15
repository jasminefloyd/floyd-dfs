# YSNT Framework — Monetize & Auth Phase

## What You're Shipping

Users, authentication, payments, and launch.

---

## Your Monetize & Auth Phase

### Part 1 — Supabase Auth Setup (~1 hr)

**Prompt to Claude Code:**
```
TASK: Implement Supabase Auth (email + password)

1. Set up Supabase Auth in Supabase dashboard:
   - Enable Email/Password auth
   - Configure email confirmation (optional for MVP)
   - Set redirect URLs: http://localhost:5173, https://yourdomain.com

2. Create src/pages/LoginPage.jsx:
   - Email input
   - Password input
   - "Sign Up" and "Log In" toggles
   - Call: supabaseClient.auth.signUp() or signIn()
   - Redirect to "/" on success

3. Create src/pages/SignupPage.jsx:
   - Email input
   - Password input
   - Password confirmation
   - Accept terms checkbox
   - Call: supabaseClient.auth.signUp()
   - On success, show "Check your email" (if confirmation enabled)

4. Update App.jsx:
   - Use useEffect() to check auth.onAuthStateChange()
   - Store user in state/context
   - If not authenticated, redirect to /login
   - If authenticated, show main app

5. Create src/contexts/AuthContext.jsx:
   - Provide current user
   - Provide sign out function
   - Provide user tier, user_id

6. Update Navigation.jsx:
   - Show user email when logged in
   - Show "Sign Out" button
   - Hide nav links if not authenticated

Output: Users can sign up and log in
```

### Part 2 — User Profiles & Tier Tracking (~1 hr)

**Prompt to Claude Code:**
```
TASK: Track user profiles, tiers, and usage

1. Create users profile table (linked to auth.users):
   - Trigger: on auth.users insert → create row in users table
   - Fields: id, email, tier (free/pro), created_at, stripe_customer_id, scan_count_today, last_scan_date

2. In ScanPage.jsx, check tier before allowing scan:
   - Fetch user from AuthContext
   - If tier = 'free':
     - Check scan_count_today
     - If >= 1: show "Upgrade to Pro for unlimited scans"
     - Disable scan button
   - If tier = 'pro': allow scan
   - After scan, increment scan_count_today

3. Reset scan_count_today daily:
   - Create database function/trigger
   - Or reset in Edge Function before incrementing

4. Display tier in Navigation.jsx:
   - Show "(Free)" or "(Pro)" next to user email

Output: Free users limited to 1 scan/day, Pro users unlimited
```

### Part 3 — Admin Role Setup (~1 hr)

**Prompt to Claude Code:**
```
TASK: Set up admin role and gate admin console

1. Add is_admin column to users table:
   - is_admin BOOLEAN DEFAULT false
   - Manually set is_admin=true for admin users in Supabase

2. Create RLS policy for admin check:
   - Allow users to SELECT from users WHERE is_admin=true (for themselves only)

3. Update AdminGuard.jsx:
   - Fetch user's is_admin status from users table
   - If false, redirect to "/"
   - If true, render children

4. Routes:
   - /admin → AdminConsole (redirects if not admin)
   - /admin/design-system → DesignSystem (redirects if not admin)

5. Test admin access:
   - Set your user is_admin=true in Supabase
   - Visit /admin → should work
   - Visit /admin/design-system → should show design system page
   - Log out, log in as non-admin → both should redirect

Output: Admin console gated by role, design system admin-only
```

### Part 4 — Stripe Integration (~1.5 hrs)

**Prompt to Claude Code:**
```
TASK: Set up Stripe subscription billing

1. Create Stripe account at stripe.com
   - Enable Test mode
   - Create Product "Pro Plan" at $9.99/month
   - Get Publishable Key and Secret Key

2. Install Stripe libraries:
   - npm install @stripe/react-stripe-js @stripe/js

3. Create src/components/PricingCard.jsx:
   - Show Free tier (included) and Pro tier ($9.99/month)
   - "Upgrade" button on Pro card
   - Disabled if already on Pro tier

4. Create src/pages/CheckoutPage.jsx:
   - Redirect from pricing or settings
   - Embed Stripe Checkout embed or Pricing Table
   - On success: user tier updated to 'pro' in Supabase
   - On cancel: return to pricing page

5. Set up Stripe Webhook:
   - Endpoint: POST /api/webhooks/stripe
   - Events: customer.subscription.created, customer.subscription.deleted
   - On creation: update users.tier = 'pro'
   - On deletion: update users.tier = 'free'
   - Deploy webhook handler as Supabase Edge Function

6. .env variables:
   VITE_STRIPE_PUBLIC_KEY=pk_test_...
   STRIPE_SECRET_KEY=sk_test_... (server-side only, in Edge Function)

Output: Users can subscribe to Pro tier with Stripe
```

### Part 5 — Usage Limits & Enforcement (~1 hr)

**Prompt to Claude Code:**
```
TASK: Enforce tier-based usage limits

1. In trigger-mios-scan Edge Function:
   - Extract user_id from JWT
   - Query users table: SELECT tier, scan_count_today, last_scan_date
   - If tier = 'free':
     - If today != last_scan_date: reset scan_count_today = 0
     - If scan_count_today >= 1: return 403 "Free tier limited to 1 scan/day"
   - If tier = 'pro': allow
   - Increment scan_count_today
   - Update last_scan_date = today

2. On frontend, reflect tier limits in UI:
   - Free users: see "1/1 scans used today" 
   - Show "Upgrade to Pro" button when limit reached
   - Pro users: see "Unlimited scans" badge

3. In Edge Function, log usage to analytics:
   - Track: user_id, scan_date, sport, result (success/failed)

Output: Tier limits enforced, users see usage tracking
```

### Part 6 — Launch Prep (~30 min)

**Prompt to Claude Code:**
```
TASK: Deploy to production and launch

1. Environment setup:
   - Create production Supabase project (if not already)
   - Update VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel
   - Set API keys for Claude, OpenAI, Reddit in Vercel secrets

2. Build and deploy:
   - npm run build (verify no errors)
   - Deploy to Vercel: git push origin main
   - Verify site is live: https://yourdomain.com

3. Test end-to-end in production:
   - Sign up with new account
   - Run 1 scan (free tier)
   - Try 2nd scan (should be blocked)
   - Upgrade to Pro via Stripe (test mode)
   - Run unlimited scans
   - Admin user: verify can access /admin/design-system
   - Non-admin user: verify redirected from /admin routes

4. Monitor:
   - Check Sentry for errors
   - Check analytics for user activity
   - Monitor uptime (Uptime Robot)

5. Marketing (optional):
   - Share link on Product Hunt, Twitter, relevant forums
   - Record demo video
   - Write launch post: "Fantasy AI helps DFS players build lineups in 90 seconds"

Output: Product live, first users signing up, Stripe payments flowing
```

---

## Monetize & Auth Deliverables Checklist

- [ ] Supabase Auth configured (email/password)
- [ ] LoginPage working (sign in)
- [ ] SignupPage working (create account)
- [ ] Auth state managed in AuthContext
- [ ] Unauthenticated users redirected to login
- [ ] users profile table created with is_admin, tier, scan_count_today
- [ ] Free tier limited to 1 scan/day
- [ ] Pro tier unlimited scans
- [ ] Tier displayed in UI ("Free" or "Pro" badge)
- [ ] Admin role defined and testable
- [ ] /admin routes protected by admin guard
- [ ] /admin/design-system accessible only to admins
- [ ] Stripe account created and products configured
- [ ] PricingCard showing Free and Pro tiers
- [ ] Stripe Checkout working
- [ ] Webhook handler deployed (Supabase Edge Function)
- [ ] User tier updated on successful payment
- [ ] Stripe test payment successful
- [ ] Usage limits enforced in Edge Functions
- [ ] Free users see "1/1 scans used" messaging
- [ ] Pro users see "Unlimited scans" messaging
- [ ] Sentry error monitoring working
- [ ] Analytics tracking events
- [ ] Uptime monitoring enabled
- [ ] All secrets in Vercel environment variables
- [ ] Production Supabase project configured
- [ ] Site deployed to Vercel with custom domain
- [ ] End-to-end test in production successful
- [ ] Code committed to GitHub
- [ ] Launch post published (optional)

---

## YOU SHIPPED IT. 🚀

Congratulations. You built a real product, validated the market, acquired real users, and are taking payments.

Next steps: Iterate based on user feedback, add Phase 3 (Bonus features), scale infrastructure.

