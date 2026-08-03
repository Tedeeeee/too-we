-- Wishlist place content is shared and editable by both active members, but
-- the row's couple and original picker are identity metadata fixed at insert.
-- The existing generic guard raises TW003 before a direct client update can
-- rewrite either value.
create trigger wishlist_places_guard_immutable
  before update on public.wishlist_places
  for each row execute function app.guard_immutable_columns('couple_id', 'created_by');
