/**
 * Each place's effective values. Most personal wins: the user's override, then
 * what Google Maps says, then our keyword guess.
 *
 * A cuisine makes a place food — Tibetan means restaurant, whatever the name
 * suggests — so a cuisine the user set outranks everything but an explicit
 * category of theirs. (Google's cuisine already implies its category.)
 */
export const EFFECTIVE = `
  SELECT p.*, l.name AS list_name,
         COALESCE(o.category,
                  CASE WHEN o.cuisine IS NOT NULL THEN 'food' END,
                  g.category, p.category) AS eff_category,
         CASE WHEN o.category IS NOT NULL OR o.cuisine IS NOT NULL THEN 'override'
              WHEN g.category IS NOT NULL THEN 'google'
              ELSE p.category_source END AS eff_source,
         COALESCE(o.cuisine, g.cuisine, p.cuisine) AS eff_cuisine,
         CASE WHEN o.cuisine IS NOT NULL THEN 'override'
              WHEN g.cuisine IS NOT NULL THEN 'google'
              WHEN p.cuisine IS NOT NULL THEN 'derived' END AS eff_cuisine_source,
         COALESCE(o.price, p.price) AS eff_price
  FROM places p
  JOIN lists l ON l.url = p.list_url AND l.user_key = p.user_key
  LEFT JOIN place_overrides o ON o.user_key = p.user_key AND o.place_id = p.id
  LEFT JOIN place_lookups g ON g.place_id = p.id AND g.status = 'matched'
  WHERE p.user_key = ?1 AND COALESCE(o.hidden, 0) = 0`;

/**
 * A place's subcategories only count while it sits in their parent. Moving a
 * place from food to drink hides its food subcategories rather than deleting
 * them, so moving it back brings them back.
 */
export const ACTIVE_SUB = `
  s.user_key = e.user_key AND s.place_id = e.id AND s.parent = e.eff_category`;
