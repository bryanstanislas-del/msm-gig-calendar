-- Applied to production as 20261021040807.
-- Public listing functions read the public read models; slug helpers run
-- with owner rights so uniqueness checks see every row; search limit bounded.
set lock_timeout = '3s';

-- ------------------------------------------------- public listing functions
-- Same signatures and outputs; joins now use the public read models.
create or replace function public.get_featured_listings(p_entity_type text default null)
 returns table(id uuid, entity_type text, listing_type text, active boolean, archive_visible boolean, is_pinned boolean, display_order integer, start_date date, end_date date, published_at timestamp with time zone, expires_at timestamp with time zone, headline text, body_text text, image_url text, image_alt text, notes text, created_at timestamp with time zone, gig_id uuid, gig_band_name text, gig_venue text, gig_date date, gig_slug text, venue_id uuid, venue_name text, venue_city text, venue_slug text, venue_photo_url text, profile_id uuid, profile_name text, profile_type text, profile_slug text, profile_photo_url text)
 language sql
 stable
 set search_path to 'public'
as $function$
  SELECT
    fl.id, fl.entity_type, fl.listing_type::text, fl.active,
    fl.archive_visible, fl.is_pinned, fl.display_order,
    fl.start_date, fl.end_date, fl.published_at, fl.expires_at,
    fl.headline, fl.body_text, fl.image_url, fl.image_alt,
    fl.notes, fl.created_at,
    g.id            AS gig_id,
    g.band_name     AS gig_band_name,
    g.venue         AS gig_venue,
    g.date          AS gig_date,
    g.slug          AS gig_slug,
    v.id            AS venue_id,
    v.name          AS venue_name,
    v.city          AS venue_city,
    v.slug          AS venue_slug,
    v.photo_url     AS venue_photo_url,
    p.id            AS profile_id,
    p.band_name     AS profile_name,
    p.profile_type::text AS profile_type,
    p.band_slug     AS profile_slug,
    p.photo_url     AS profile_photo_url
  FROM public.featured_listings fl
  LEFT JOIN public.public_gigs     g ON fl.gig_id     = g.id
  LEFT JOIN public.public_venues   v ON fl.venue_id   = v.id
  LEFT JOIN public.public_profiles p ON fl.profile_id = p.id
  WHERE fl.active = true
    AND (fl.published_at IS NULL OR fl.published_at <= now())
    AND (fl.expires_at   IS NULL OR fl.expires_at   >  now())
    AND (p_entity_type IS NULL OR fl.entity_type = p_entity_type)
  ORDER BY
    fl.is_pinned DESC,
    fl.display_order ASC,
    CASE fl.entity_type
      WHEN 'gig' THEN 0 WHEN 'band' THEN 1
      WHEN 'venue' THEN 2 WHEN 'festival' THEN 3
    END,
    fl.start_date DESC;
$function$;

create or replace function public.get_editorial_features(p_award_type_slug text default null)
 returns table(id uuid, award_type_id uuid, award_slug text, award_label text, award_color_hex text, is_pinned boolean, display_order integer, published_at timestamp with time zone, headline text, body_text text, image_url text, image_alt text, gig_id uuid, gig_band_name text, gig_venue text, gig_date date, gig_slug text, profile_id uuid, profile_name text, profile_slug text, awarded_at timestamp with time zone, review_url text, slug text, notes text)
 language sql
 stable
 set search_path to 'public'
as $function$
  SELECT
    ef.id, ef.award_type_id,
    eat.slug AS award_slug, eat.label AS award_label, eat.color_hex AS award_color_hex,
    ef.is_pinned, ef.display_order, ef.published_at,
    ef.headline, ef.body_text, ef.image_url, ef.image_alt,
    g.id AS gig_id, g.band_name AS gig_band_name, g.venue AS gig_venue,
    g.date AS gig_date, g.slug AS gig_slug,
    p.id AS profile_id, p.band_name AS profile_name, p.band_slug AS profile_slug,
    ef.awarded_at, ef.review_url, ef.slug, ef.notes
  FROM public.editorial_features ef
  JOIN public.editorial_award_types eat ON ef.award_type_id = eat.id
  LEFT JOIN public.public_gigs     g ON ef.gig_id     = g.id
  LEFT JOIN public.public_profiles p ON ef.profile_id = p.id
  WHERE ef.active = true
    AND (ef.published_at IS NULL OR ef.published_at <= now())
    AND (ef.expires_at   IS NULL OR ef.expires_at   >  now())
    AND (p_award_type_slug IS NULL OR eat.slug = p_award_type_slug)
  ORDER BY ef.is_pinned DESC, ef.display_order ASC, ef.awarded_at DESC;
$function$;

create or replace function public.get_editorial_archive(p_award_type_slug text default null, p_year integer default null)
 returns table(id uuid, award_type_id uuid, award_slug text, award_label text, award_color_hex text, headline text, body_text text, image_url text, image_alt text, gig_id uuid, gig_band_name text, gig_venue text, gig_date date, gig_slug text, profile_id uuid, profile_name text, profile_slug text, awarded_at timestamp with time zone, awarded_year integer, review_url text, archive_visible boolean, active boolean, slug text, notes text)
 language sql
 stable
 set search_path to 'public'
as $function$
  SELECT
    ef.id, ef.award_type_id,
    eat.slug AS award_slug, eat.label AS award_label, eat.color_hex AS award_color_hex,
    ef.headline, ef.body_text, ef.image_url, ef.image_alt,
    g.id AS gig_id, g.band_name AS gig_band_name, g.venue AS gig_venue,
    g.date AS gig_date, g.slug AS gig_slug,
    p.id AS profile_id, p.band_name AS profile_name, p.band_slug AS profile_slug,
    ef.awarded_at,
    EXTRACT(YEAR FROM ef.awarded_at)::integer AS awarded_year,
    ef.review_url, ef.archive_visible, ef.active, ef.slug, ef.notes
  FROM public.editorial_features ef
  JOIN public.editorial_award_types eat ON ef.award_type_id = eat.id
  LEFT JOIN public.public_gigs     g ON ef.gig_id     = g.id
  LEFT JOIN public.public_profiles p ON ef.profile_id = p.id
  WHERE ef.archive_visible = true
    AND (p_award_type_slug IS NULL OR eat.slug = p_award_type_slug)
    AND (p_year IS NULL OR EXTRACT(YEAR FROM ef.awarded_at)::integer = p_year)
  ORDER BY ef.awarded_at DESC;
$function$;

create or replace function public.get_founding_supporters()
 returns table(id uuid, profile_id uuid, profile_name text, profile_slug text, profile_photo_url text, profile_city text, granted_at timestamp with time zone, supporter_level text, website_url text, headline text, body_text text, image_url text, image_alt text, is_pinned boolean, display_order integer, notes text)
 language sql
 stable
 set search_path to 'public'
as $function$
  SELECT
    fs.id,
    p.id            AS profile_id,
    p.band_name     AS profile_name,
    p.band_slug     AS profile_slug,
    p.photo_url     AS profile_photo_url,
    p.city          AS profile_city,
    fs.granted_at, fs.supporter_level, fs.website_url,
    fs.headline, fs.body_text, fs.image_url, fs.image_alt,
    fs.is_pinned, fs.display_order, fs.notes
  FROM public.founding_supporters fs
  JOIN public.public_profiles p ON fs.profile_id = p.id
  WHERE fs.active = true
    AND (fs.published_at IS NULL OR fs.published_at <= now())
    AND (fs.expires_at   IS NULL OR fs.expires_at   >  now())
  ORDER BY fs.is_pinned DESC, fs.display_order ASC, fs.granted_at ASC;
$function$;

-- ----------------------------------------------------------- slug helpers
-- Uniqueness checks must see every row regardless of the caller; they only
-- ever return a slug string.
alter function public.generate_band_slug(text)            security definer;
alter function public.generate_gig_slug(text, text, date)  security definer;
alter function public.generate_venue_slug(text, text)      security definer;

-- ---------------------------------------------------------- search_entities
-- Unchanged output (id, name, city, score); limit now bounded.
create or replace function public.search_entities(p_entity_type text, p_query text, p_limit integer default 8)
 returns table(id uuid, name text, city text, similarity_score real)
 language plpgsql
 volatile security definer
 set search_path to ''
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 8), 1), 25);
begin
  if p_query is null or length(trim(p_query)) < 2 then
    return;
  end if;

  perform extensions.set_limit(0.25);

  if p_entity_type = 'venue' then
    return query
      select v.id, v.name, v.city, extensions.similarity(v.name, p_query) as similarity_score
      from public.venues v
      where v.name OPERATOR(extensions.%) p_query
         or v.name ilike '%' || p_query || '%'
      order by similarity_score desc, v.name asc
      limit v_limit;

  elsif p_entity_type in ('band','solo_artist','festival','promoter','organisation') then
    return query
      select p.id, p.band_name as name, p.city, extensions.similarity(p.band_name, p_query) as similarity_score
      from public.profiles p
      where p.profile_type = p_entity_type
        and p.disabled = false
        and (p.band_name OPERATOR(extensions.%) p_query or p.band_name ilike '%' || p_query || '%')
      order by similarity_score desc, p.band_name asc
      limit v_limit;

  else
    raise exception 'Unsupported entity_type for search: %. Must be one of venue, band, solo_artist, festival, promoter, organisation', p_entity_type;
  end if;
end;
$function$;
