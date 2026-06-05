/* ============================================================
   Jays Tracker — team registry (v2 / #114 Phase 3)

   Looks up team metadata by 3-letter abbreviation. Pairs with the
   tooltip module — every .opp / .abbr DOM token that carries
   data-team="ABBR" resolves to {name, league, division} here, so the
   tooltip module can render the same kind of bubble it does for stats.

   Hand-maintained instead of derived from data.json because data.json
   only carries our division (5 teams) + our league's wild-card race
   (15 teams). Interleague opponents — the Braves, Phillies, etc. —
   aren't there at all, but they show up on every Next-3 card during an
   interleague series. A static 30-team map covers all opponents.

   League key is two-letter ('AL'/'NL'); division is the short form Stat
   School uses ('AL East', 'NL Central'). The format mirrors what
   overview.js's KNOWN map already encodes for the inverse lookup.
   ============================================================ */
(function () {
  'use strict';

  // {abbrev: {name, league, division}}. Athletics keyed under 'OAK' to
  // match the abbreviate() KNOWN map; their MLB.com brand says "Athletics"
  // with no city, but the dashboard already canonicalizes to OAK.
  const TEAMS = {
    // AL East
    BAL: { name: 'Baltimore Orioles',   league: 'AL', division: 'AL East' },
    BOS: { name: 'Boston Red Sox',      league: 'AL', division: 'AL East' },
    NYY: { name: 'New York Yankees',    league: 'AL', division: 'AL East' },
    TBR: { name: 'Tampa Bay Rays',      league: 'AL', division: 'AL East' },
    TOR: { name: 'Toronto Blue Jays',   league: 'AL', division: 'AL East' },
    // AL Central
    CWS: { name: 'Chicago White Sox',   league: 'AL', division: 'AL Central' },
    CLE: { name: 'Cleveland Guardians', league: 'AL', division: 'AL Central' },
    DET: { name: 'Detroit Tigers',      league: 'AL', division: 'AL Central' },
    KCR: { name: 'Kansas City Royals',  league: 'AL', division: 'AL Central' },
    MIN: { name: 'Minnesota Twins',     league: 'AL', division: 'AL Central' },
    // AL West
    HOU: { name: 'Houston Astros',      league: 'AL', division: 'AL West' },
    LAA: { name: 'Los Angeles Angels',  league: 'AL', division: 'AL West' },
    OAK: { name: 'Athletics',           league: 'AL', division: 'AL West' },
    SEA: { name: 'Seattle Mariners',    league: 'AL', division: 'AL West' },
    TEX: { name: 'Texas Rangers',       league: 'AL', division: 'AL West' },
    // NL East
    ATL: { name: 'Atlanta Braves',      league: 'NL', division: 'NL East' },
    MIA: { name: 'Miami Marlins',       league: 'NL', division: 'NL East' },
    NYM: { name: 'New York Mets',       league: 'NL', division: 'NL East' },
    PHI: { name: 'Philadelphia Phillies', league: 'NL', division: 'NL East' },
    WSN: { name: 'Washington Nationals',  league: 'NL', division: 'NL East' },
    // NL Central
    CHC: { name: 'Chicago Cubs',        league: 'NL', division: 'NL Central' },
    CIN: { name: 'Cincinnati Reds',     league: 'NL', division: 'NL Central' },
    MIL: { name: 'Milwaukee Brewers',   league: 'NL', division: 'NL Central' },
    PIT: { name: 'Pittsburgh Pirates',  league: 'NL', division: 'NL Central' },
    STL: { name: 'St. Louis Cardinals', league: 'NL', division: 'NL Central' },
    // NL West
    ARI: { name: 'Arizona Diamondbacks', league: 'NL', division: 'NL West' },
    COL: { name: 'Colorado Rockies',     league: 'NL', division: 'NL West' },
    LAD: { name: 'Los Angeles Dodgers',  league: 'NL', division: 'NL West' },
    SDP: { name: 'San Diego Padres',     league: 'NL', division: 'NL West' },
    SFG: { name: 'San Francisco Giants', league: 'NL', division: 'NL West' },
  };

  function get(abbrev) {
    if (!abbrev) return null;
    return TEAMS[String(abbrev).toUpperCase()] || null;
  }

  window.JaysTeamRegistry = {
    get: get,
  };
})();
