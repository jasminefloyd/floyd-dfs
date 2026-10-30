alter table public.digitalfoundry_products add column if not exists marketplace text;
alter table public.digitalfoundry_products add column if not exists live_listing_price numeric;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='digitalfoundry_products_marketplace_check') then
    alter table public.digitalfoundry_products add constraint digitalfoundry_products_marketplace_check check (marketplace is null or marketplace in ('etsy','gumroad','other'));
  end if;
  if not exists (select 1 from pg_constraint where conname='digitalfoundry_products_live_listing_price_check') then
    alter table public.digitalfoundry_products add constraint digitalfoundry_products_live_listing_price_check check (live_listing_price is null or live_listing_price >= 0);
  end if;
end $$;
