# Database boundary

Supabase client setup, generated types, migrations, RLS policies, tenant helpers, and the Orchestrator persistence adapter belong here.

The database must support a shared multi-tenant Postgres design with:

- mandatory `tenant_id` on every tenant-owned record;
- unique, tenant-isolated naming for tenant-scoped resources and functions;
- membership-based RLS policies for every tenant-owned table;
- server-only service-role access;
- no schema-per-tenant assumption;
- explicit tenant context in application and Edge Function operations.

Tenant naming and tenant-scoped database functions must be finalized in the database design before migrations are created.

Credentials remain environment-only. The migration and client code in this package are local foundation artifacts; they have not been applied to a remote Supabase project.
