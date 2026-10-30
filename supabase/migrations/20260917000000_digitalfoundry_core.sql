create extension if not exists pgcrypto;
-- Digital Foundry owns its own tenant boundary. The existing shared profile
-- tenant is intentionally not modified.
insert into public.tenants (id, slug, name, plan, settings)
values ('7c7c9f5a-7f1b-4d4f-8b2f-4c2fd0b9f001', 'digital-foundry', 'The Digital Foundry', 'standard', '{}'::jsonb)
on conflict (id) do update set slug = excluded.slug, name = excluded.name;
insert into public.tenant_memberships (id, tenant_id, user_id, role)
select gen_random_uuid(), '7c7c9f5a-7f1b-4d4f-8b2f-4c2fd0b9f001', id, 'owner'
from auth.users
where email = 'jasmine@demo.com'
  and not exists (
    select 1 from public.tenant_memberships m
    where m.tenant_id = '7c7c9f5a-7f1b-4d4f-8b2f-4c2fd0b9f001'
      and m.user_id = auth.users.id
  );
create table if not exists public.digitalfoundry_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '7c7c9f5a-7f1b-4d4f-8b2f-4c2fd0b9f001' references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  title text not null, product_type text not null check (product_type in ('spreadsheet_tool','guide_workbook','hybrid_kit')),
  entry_path text not null check (entry_path in ('human_directed','autonomous_discovery')),
  status text not null default 'discovered' check (status in ('discovered','analyzed','build_approved','building','qa_review','content_approval','publisher_prep','release_approval','ready_to_publish','published','measuring')),
  target_customer text, job_to_be_done text, category text, current_version text not null default 'v0.1',
  unique (id, tenant_id)
);
create table if not exists public.digitalfoundry_opportunity_briefs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '7c7c9f5a-7f1b-4d4f-8b2f-4c2fd0b9f001' references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  product_id uuid, opportunity_name text not null, product_type text not null,
  market_evidence jsonb not null default '{}'::jsonb, representative_competitors jsonb not null default '[]'::jsonb,
  typical_price_range jsonb, proposed_price_range jsonb, competition_level text, pain_points jsonb, existing_strengths jsonb,
  missing_capabilities jsonb, proposed_differentiators text, build_complexity text, expected_conversion_range jsonb,
  expected_revenue_range jsonb, confidence_level text, recommendation text not null check (recommendation in ('build','backlog','reject')),
  foreign key (product_id, tenant_id) references public.digitalfoundry_products(id, tenant_id) on delete restrict
);
create table if not exists public.digitalfoundry_build_briefs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '7c7c9f5a-7f1b-4d4f-8b2f-4c2fd0b9f001' references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  product_id uuid not null, source_type text not null check (source_type in ('idea','url','upload')),
  source_reference text not null, normalized_summary text, mvp_feature_set jsonb, proposed_structure jsonb,
  foreign key (product_id, tenant_id) references public.digitalfoundry_products(id, tenant_id) on delete cascade
);
create table if not exists public.digitalfoundry_agent_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '7c7c9f5a-7f1b-4d4f-8b2f-4c2fd0b9f001' references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  product_id uuid, agent_name text not null check (agent_name in ('opportunity','builder','red_team','publisher')),
  edge_function_name text not null, status text not null default 'queued' check (status in ('queued','running','succeeded','failed')),
  progress_label text, input_payload jsonb, output_payload jsonb, error_message text, started_at timestamptz, completed_at timestamptz,
  foreign key (product_id, tenant_id) references public.digitalfoundry_products(id, tenant_id) on delete cascade
);
create table if not exists public.digitalfoundry_qa_results (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '7c7c9f5a-7f1b-4d4f-8b2f-4c2fd0b9f001' references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  product_id uuid not null, version text not null, check_name text not null, passed boolean not null, detail text,
  overridden_by_approver boolean not null default false,
  foreign key (product_id, tenant_id) references public.digitalfoundry_products(id, tenant_id) on delete cascade
);
create table if not exists public.digitalfoundry_revisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '7c7c9f5a-7f1b-4d4f-8b2f-4c2fd0b9f001' references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  product_id uuid not null, requested_change text not null, builder_response text, files_affected jsonb, qa_impact text,
  status text not null default 'requested' check (status in ('requested','in_progress','completed')),
  foreign key (product_id, tenant_id) references public.digitalfoundry_products(id, tenant_id) on delete cascade
);
create table if not exists public.digitalfoundry_product_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '7c7c9f5a-7f1b-4d4f-8b2f-4c2fd0b9f001' references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  product_id uuid not null, version text not null, change_source text not null check (change_source in ('initial_build','red_team_fix','approver_revision')),
  summary text, files jsonb, qa_status text, approval_status text,
  foreign key (product_id, tenant_id) references public.digitalfoundry_products(id, tenant_id) on delete cascade
);
create table if not exists public.digitalfoundry_publisher_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '7c7c9f5a-7f1b-4d4f-8b2f-4c2fd0b9f001' references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  product_id uuid not null, title_copy text, short_description text, long_description text, feature_bullets jsonb, faqs jsonb,
  seo_keywords jsonb, proposed_pricing jsonb, screenshot_paths jsonb, graphic_paths jsonb, image_provider_used text,
  foreign key (product_id, tenant_id) references public.digitalfoundry_products(id, tenant_id) on delete cascade
);
create table if not exists public.digitalfoundry_revenue_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '7c7c9f5a-7f1b-4d4f-8b2f-4c2fd0b9f001' references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  product_id uuid not null, marketplace text not null check (marketplace in ('etsy','gumroad','other')),
  entry_date date not null, units_sold integer not null default 0, gross_revenue numeric not null default 0,
  refunds numeric not null default 0, forecast_revenue numeric not null default 0, notes text,
  foreign key (product_id, tenant_id) references public.digitalfoundry_products(id, tenant_id) on delete cascade
);
create or replace function public.digitalfoundry_touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
do $$ declare t text; begin foreach t in array array['digitalfoundry_products','digitalfoundry_opportunity_briefs','digitalfoundry_build_briefs','digitalfoundry_agent_runs','digitalfoundry_qa_results','digitalfoundry_revisions','digitalfoundry_product_versions','digitalfoundry_publisher_assets','digitalfoundry_revenue_entries'] loop execute format('drop trigger if exists %I_updated_at on public.%I',t,t); execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.digitalfoundry_touch_updated_at()',t,t); end loop; end $$;
alter table public.digitalfoundry_products enable row level security;
alter table public.digitalfoundry_opportunity_briefs enable row level security;
alter table public.digitalfoundry_build_briefs enable row level security;
alter table public.digitalfoundry_agent_runs enable row level security;
alter table public.digitalfoundry_qa_results enable row level security;
alter table public.digitalfoundry_revisions enable row level security;
alter table public.digitalfoundry_product_versions enable row level security;
alter table public.digitalfoundry_publisher_assets enable row level security;
alter table public.digitalfoundry_revenue_entries enable row level security;
do $$ declare t text; begin foreach t in array array['digitalfoundry_products','digitalfoundry_opportunity_briefs','digitalfoundry_build_briefs','digitalfoundry_agent_runs','digitalfoundry_qa_results','digitalfoundry_revisions','digitalfoundry_product_versions','digitalfoundry_publisher_assets','digitalfoundry_revenue_entries'] loop execute format('drop policy if exists %I_tenant_access on public.%I',t,t); execute format('create policy %I_tenant_access on public.%I for all to authenticated using (tenant_id = public.tenant_id_by_slug(''digital-foundry'') and public.is_tenant_member(tenant_id)) with check (tenant_id = public.tenant_id_by_slug(''digital-foundry'') and public.is_tenant_member(tenant_id))',t,t); end loop; end $$;
create index if not exists digitalfoundry_products_tenant_status_idx on public.digitalfoundry_products(tenant_id,status);
create index if not exists digitalfoundry_agent_runs_tenant_product_agent_idx on public.digitalfoundry_agent_runs(tenant_id,product_id,agent_name,created_at desc);
create index if not exists digitalfoundry_versions_tenant_product_idx on public.digitalfoundry_product_versions(tenant_id,product_id,created_at desc);
create index if not exists digitalfoundry_revenue_tenant_product_idx on public.digitalfoundry_revenue_entries(tenant_id,product_id);
insert into storage.buckets (id, name, public) values ('digitalfoundry-uploads','digitalfoundry-uploads',false) on conflict (id) do update set public = false;
insert into storage.buckets (id, name, public) values ('digitalfoundry-products','digitalfoundry-products',false) on conflict (id) do update set public = false;
drop policy if exists digitalfoundry_storage_tenant_access on storage.objects;
create policy digitalfoundry_storage_tenant_access on storage.objects for all to authenticated
using (
  (bucket_id = 'digitalfoundry-uploads' and split_part(name,'/',1) = '7c7c9f5a-7f1b-4d4f-8b2f-4c2fd0b9f001' and public.is_tenant_member('7c7c9f5a-7f1b-4d4f-8b2f-4c2fd0b9f001'::uuid))
  or
  (bucket_id = 'digitalfoundry-products' and exists (select 1 from public.digitalfoundry_products p where p.id::text = split_part(storage.objects.name,'/',1) and p.tenant_id = '7c7c9f5a-7f1b-4d4f-8b2f-4c2fd0b9f001' and public.is_tenant_member(p.tenant_id)))
)
with check (
  (bucket_id = 'digitalfoundry-uploads' and split_part(name,'/',1) = '7c7c9f5a-7f1b-4d4f-8b2f-4c2fd0b9f001' and public.is_tenant_member('7c7c9f5a-7f1b-4d4f-8b2f-4c2fd0b9f001'::uuid))
  or
  (bucket_id = 'digitalfoundry-products' and exists (select 1 from public.digitalfoundry_products p where p.id::text = split_part(storage.objects.name,'/',1) and p.tenant_id = '7c7c9f5a-7f1b-4d4f-8b2f-4c2fd0b9f001' and public.is_tenant_member(p.tenant_id)))
);
