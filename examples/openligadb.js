/**
 * @name OpenLigaDB
 * @icon mdi:soccer
 * @description Multi-team football tracker with configurable cards.
 * @label Integration
 * @permission network
 * @card
 * @loglevel debug
 */
// --- Configuration and Constants ---
const API_BASE = 'https://api.openligadb.de';
// Derive Entity ID from filename safely
const SCRIPT_NAME = ha.getHeader('filename') || 'openligadb.js';
const ENTITY_ID = `sensor.${SCRIPT_NAME.split('.')[0]}`;

// Core leagues checked for every team (e.g., to find Cup matches automatically)
const KNOWN_LEAGUES = [
    { short: 'bl1', name: '1. Bundesliga',    icon: 'mdi:numeric-1-circle' },
    { short: 'bl2', name: '2. Bundesliga',    icon: 'mdi:numeric-2-circle' },
    { short: 'bl3', name: '3. Liga',          icon: 'mdi:numeric-3-circle' },
    { short: 'dfb', name: 'DFB-Pokal',        icon: 'mdi:trophy-outline' },
    { short: 'ucl', name: 'Champions League', icon: 'mdi:trophy' },
    { short: 'uel', name: 'Europa League',    icon: 'mdi:star' },
    { short: 'uecl', name: 'Conference League', icon: 'mdi:star-outline' },
];

// --- Registry of tracked teams ---
const registry = ha.persistent('openligadb_registry', {
    teams: {} // entity_id -> { teamId, teamName, leagueShort, season, lastRefresh, skipMatchId }
});

function detectSeason() {
    const now = new Date();
    return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}

function slugify(text) {
    return text.toString().toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^\w-]+/g, '')
        .replace(/--+/g, '_')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
}

// --- Data Fetching and Logic ---

async function updateMatchData() {
    const entityIds = Object.keys(registry.teams);
    if (entityIds.length === 0) return;

    const defaultSeason = detectSeason();

    // Build unique (league, season) pairs — each team may carry its own season
    // (e.g. WM2026 with season 2026 while Bundesliga teams are in 2025).
    const pairMap = new Map();
    KNOWN_LEAGUES.forEach(l => pairMap.set(`${l.short}_${defaultSeason}`, { league: l.short, season: defaultSeason }));
    entityIds.forEach(id => {
        const t = registry.teams[id];
        const s = t.season ?? defaultSeason;
        pairMap.set(`${t.leagueShort}_${s}`, { league: t.leagueShort, season: s });
    });
    const pairs = [...pairMap.values()];

    // Fetch all (league, season) pairs in parallel
    const settled = await Promise.allSettled(
        pairs.map(({ league, season }) =>
            fetch(`${API_BASE}/getmatchdata/${league}/${season}`, {
                headers: { 'User-Agent': 'HA-JS-Automations-Addon/1.0 (OpenLigaDB)' },
                signal: AbortSignal.timeout(10000),
            })
            .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
            .then(data => ({ key: `${league}_${season}`, data }))
        )
    );

    const matchCache = {};
    let fetchedCount = 0;
    settled.forEach((r, i) => {
        if (r.status === 'fulfilled') {
            matchCache[r.value.key] = r.value.data;
            fetchedCount++;
        } else {
            ha.warn(`OpenLigaDB: Failed to fetch ${pairs[i].league}/${pairs[i].season}: ${r.reason?.message}`);
        }
    });

    // If every fetch failed, preserve existing entity states rather than wiping them
    if (fetchedCount === 0) {
        ha.warn('OpenLigaDB: All league fetches failed — keeping existing entity states.');
        return;
    }

    // Update each team entity
    for (const entityId of entityIds) {
        const teamCfg = registry.teams[entityId];
        // Normalize teamId to number — API returns numbers, config may hold strings
        const teamIdNum = Number(teamCfg.teamId);

        // Register entity every time (Mark-and-Sweep protection)
        ha.register(entityId, { name: teamCfg.teamName, icon: 'mdi:soccer', area: 'Sports' });

        // Aggregate matches across all fetched leagues to find Cup games
        let teamMatches = [];
        Object.values(matchCache).forEach(matches => {
            const found = matches.filter(m =>
                Number(m.team1?.teamId) === teamIdNum ||
                Number(m.team2?.teamId) === teamIdNum
            );
            teamMatches = teamMatches.concat(found);
        });

        if (teamMatches.length === 0) {
            // Preserve existing match attributes so the card doesn't lose its last known data
            const current = ha.getState(entityId);
            if (current?.attributes?.datetime) {
                ha.update(entityId, 'no_match', current.attributes);
            } else {
                ha.update(entityId, 'no_match', { team_name: teamCfg.teamName });
            }
            continue;
        }

        teamMatches.sort((a, b) => new Date(a.matchDateTime) - new Date(b.matchDateTime));

        const now = new Date();
        
        // Display logic: Live > recently finished > upcoming
        let selected = teamMatches.find(m => !m.matchIsFinished && new Date(m.matchDateTime) <= now);

        if (!selected) {
            const finished = teamMatches.filter(m => m.matchIsFinished);
            const upcoming = teamMatches.filter(m => !m.matchIsFinished && m.matchID !== teamCfg.skipMatchId);
            const last     = finished.length > 0 ? finished[finished.length - 1] : null;
            const next     = upcoming.length > 0 ? upcoming[0] : null;

            // Show finished matches for 24 hours
            if (last && (now - new Date(last.matchDateTime)) < 24 * 3600 * 1000 && last.matchID !== teamCfg.skipMatchId) {
                selected = (next && (new Date(next.matchDateTime) - now) < 3 * 3600 * 1000) ? next : last;
            } else {
                selected = next || last;
            }
        }

        if (!selected) {
            const current = ha.getState(entityId);
            if (current?.attributes?.datetime) {
                ha.update(entityId, 'no_match', current.attributes);
            } else {
                ha.update(entityId, 'no_match', { team_name: teamCfg.teamName });
            }
            continue;
        }

        const state = selected.matchIsFinished ? 'finished' : (now >= new Date(selected.matchDateTime) ? 'live' : 'scheduled');
        const results = selected.matchResults || [];
        // ResultTypeID 2 is usually the final result
        const finalResult = results.find(r => r.resultTypeID === 2) || results[results.length - 1] || null;

        ha.update(entityId, state, {
            datetime:       selected.matchDateTime,
            team_home:      selected.team1.teamName,
            team_home_id:   String(selected.team1.teamId),
            team_home_icon: selected.team1.teamIconUrl,
            team_away:      selected.team2.teamName,
            team_away_id:   String(selected.team2.teamId),
            team_away_icon: selected.team2.teamIconUrl,
            score_home:     finalResult ? finalResult.pointsTeam1 : 0,
            score_away:     finalResult ? finalResult.pointsTeam2 : 0,
            match_id:       selected.matchID,
            league_name:    selected.leagueName,
            competition:    selected.leagueShortcut,
        });
    }
}

// --- Actions ---

ha.action('get_leagues', async () => KNOWN_LEAGUES);

ha.action('get_teams', async ({ league, season }) => {
    const s = season ?? detectSeason();
    ha.log(`get_teams: league=${league} season=${s}`);
    try {
        const response = await fetch(`${API_BASE}/getavailableteams/${league}/${s}`, {
            headers: { 'User-Agent': 'HA-JS-Automations-Addon/1.0 (OpenLigaDB)' },
            signal: AbortSignal.timeout(12000)
        });
        if (response.status === 404) {
            ha.log(`get_teams: no data for ${league}/${s} (404) — returning empty list`);
            return [];
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        ha.log(`get_teams: returning ${data.length} teams`);
        return data.map(t => ({ teamId: t.teamId, teamName: t.teamName, teamIconUrl: t.teamIconUrl }));
    } catch (e) {
        ha.warn(`get_teams failed: ${e.message}`);
        throw e;
    }
});

ha.action('get_config', async () => ({
    teams:    JSON.parse(JSON.stringify(registry.teams)),
    scriptId: SCRIPT_NAME.split('.')[0],
}));

ha.action('add_team', async ({ league, season, teamId, teamName, teamIcon }) => {
    const entityId = `sensor.${SCRIPT_NAME.split('.')[0]}_${teamId}`;
    const info = KNOWN_LEAGUES.find(l => l.short === league);
    registry.teams[entityId] = {
        leagueShort: league,
        leagueName:  info ? info.name : league.toUpperCase(),
        season:      season ?? detectSeason(),
        teamId, teamName, teamIcon: teamIcon || null, skipMatchId: null,
    };
    ha.log(`OpenLigaDB: Added ${teamName} → ${entityId}`);
    // Register immediately so the card shows "Warte auf Daten..." instead of
    // the unconfigured placeholder while the background fetch runs.
    ha.register(entityId, { name: teamName, icon: 'mdi:soccer', area: 'Sports' });
    updateMatchData().catch(e => ha.warn(`OpenLigaDB: updateMatchData failed: ${e.message}`));
    return { entityId };
});

ha.action('heartbeat', async ({ instanceId, entityId, autoDelete }) => {
    if (!instanceId || !entityId || !registry.teams[entityId]) return;
    if (!registry.teams[entityId].instances) registry.teams[entityId].instances = {};
    registry.teams[entityId].instances[instanceId] = {
        lastSeen: Date.now(),
        autoDelete: autoDelete !== false,
    };
});

ha.action('remove_team', async ({ entityId }) => {
    if (!registry.teams[entityId]) throw new Error(`Not found: ${entityId}`);
    delete registry.teams[entityId];
    ha.log(`OpenLigaDB: Removed ${entityId}`);
});

ha.action('set_config', async ({ league, season, teamId, teamName, teamIcon }) => {
    const info      = KNOWN_LEAGUES.find(l => l.short === league);
    registry.teams[ENTITY_ID] = {
        leagueShort: league,
        leagueName:  info ? info.name : league.toUpperCase(),
        season:      season ?? detectSeason(),
        teamId:      teamId,
        teamName:    teamName,
        teamIcon:    teamIcon || null,
        skipMatchId: null
    };
    ha.log(`OpenLigaDB: Config updated for ${ENTITY_ID} — ${teamName}`);
    await updateMatchData();
});

ha.action('refresh', async ({ entityId } = {}) => {
    const id = entityId || ENTITY_ID;
    const state = ha.getState(id);
    // If match is finished, clicking the card skips to the next one
    if (state && state.state === 'finished' && state.attributes.match_id) {
        if (registry.teams[id]) {
            registry.teams[id].skipMatchId = state.attributes.match_id;
            ha.debug(`OpenLigaDB: Skipping match ${state.attributes.match_id} for ${id}`);
        }
    } else if (registry.teams[id]) {
        // Reset skip if clicked during a non-finished match or to force refresh
        registry.teams[id].skipMatchId = null;
    }
    await updateMatchData();
});

// ─── Polling ──────────────────────────────────────────────────────────────────

const POLL_NORMAL = 15;
const POLL_LIVE   = 1;
let pollCounter = 0;

schedule('* * * * *', async () => {
    const isAnyLive = Object.keys(registry.teams).some(id => ha.getState(id)?.state === 'live');
    const interval = isAnyLive ? POLL_LIVE : POLL_NORMAL;
    if (pollCounter % interval === 0) await updateMatchData();
    pollCounter++;
});

// ─── Start ────────────────────────────────────────────────────────────────────

ha.frontend.installCard();

if (Object.keys(registry.teams).length > 0) {
    updateMatchData();
} else {
    ha.log('OpenLigaDB: Not configured yet. Add the card to your dashboard and run the setup wizard.');
}

ha.onStop(() => { ha.log('OpenLigaDB: Script stopped.'); });

/* __JSA_CARD__
Ly8gPT09IE9QRU5MSUdBREIgQ0FSRCAoSlNBIFNjcmlwdCBQYWNrIEVkaXRpb24pIHYxNCA9PT0KLy8gRU5USVRZX0lEIGlzIHJlYWQgZnJvbSB0aGUgTG92ZWxhY2UgY2FyZCBjb25maWcgKGVudGl0eUlkIHByb3BlcnR5KS4KLy8gRmFsbHMgYmFjayB0byBzZW5zb3IuPHNjcmlwdElkPiBmb3IgYmFja3dhcmQgY29tcGF0IHdpdGggc2luZ2xlLXRlYW0gaW5zdGFsbHMuCi8vIEZvciBtdWx0aS10ZWFtOiBzZXQgZW50aXR5SWQgaW4gdGhlIGNhcmQncyBMb3ZlbGFjZSBZQU1MLCBlLmcuOgovLyAgIHR5cGU6IGN1c3RvbTpvcGVubGlnYWRiLWNhcmQKLy8gICBlbnRpdHlJZDogc2Vuc29yLm9wZW5saWdhZGJfNwoKdmFyIExPR09fT1ZFUlJJREVTID0gewogICc3JzogICdodHRwczovL3VwbG9hZC53aWtpbWVkaWEub3JnL3dpa2lwZWRpYS9jb21tb25zLzYvNjcvQm9ydXNzaWFfRG9ydG11bmRfbG9nby5zdmcnLAp9OwoKLy8gV2lraW1lZGlhIC90aHVtYi8gVVJMcyBhcmUgbm8gbG9uZ2VyIHNlcnZlZCByZWxpYWJseSDigJQgcmV3cml0ZSB0byB0aGUgb3JpZ2luYWwgZmlsZSBVUkwuCi8vIGUuZy4gL3RodW1iLzkvOWUvTG9nby5zdmcvMTIwMHB4LUxvZ28uc3ZnLnBuZyDihpIgLzkvOWUvTG9nby5zdmcKZnVuY3Rpb24gZml4TG9nb1VybCh1cmwpIHsKICBpZiAoIXVybCkgcmV0dXJuICcnOwogIHVybCA9IHVybC5yZXBsYWNlKCdodHRwOicsICdodHRwczonKTsKICByZXR1cm4gdXJsLnJlcGxhY2UoL1wvdGh1bWIoXC9bXi9dK1wvW14vXStcL1teL10rKVwvW14vXSskLywgJyQxJyk7Cn0KCi8vIOKUgOKUgOKUgCBEaXNwbGF5IENhcmQg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSACgpjbGFzcyBPcGVubGlnYWRiQ2FyZCBleHRlbmRzIEhUTUxFbGVtZW50IHsKICBjb25zdHJ1Y3RvcigpIHsKICAgIHN1cGVyKCk7CiAgICB0aGlzLmF0dGFjaFNoYWRvdyh7IG1vZGU6ICdvcGVuJyB9KTsKICAgIHRoaXMuX2hhc3MgPSBudWxsOwogIH0KCiAgc2V0Q29uZmlnKGNvbmZpZykgewogICAgdGhpcy5fbG92ZWxhY2VDZmcgPSBjb25maWc7CiAgICAvLyBSZXNvbHZlIGVudGl0eSBJRDogZXhwbGljaXQgY29uZmlnIHByb3AgdGFrZXMgcHJlY2VkZW5jZSBvdmVyIHNjcmlwdElkIGZhbGxiYWNrCiAgICB0aGlzLl9lbnRpdHlJZCA9IChjb25maWcgJiYgY29uZmlnLmVudGl0eUlkKSA/IGNvbmZpZy5lbnRpdHlJZCA6ICgnc2Vuc29yLicgKyBfX2pzYV9fLnNjcmlwdElkKTsKICAgIC8vIFJlZ2lzdGVyIGluc3RhbmNlIGZvciBoZWFydGJlYXQgdHJhY2tpbmcKICAgIF9fanNhX18udXBkYXRlQ29uZmlnKHsKICAgICAgaW5zdGFuY2VJZDogY29uZmlnICYmIGNvbmZpZy5pbnN0YW5jZUlkLAogICAgICBlbnRpdHlJZDogdGhpcy5fZW50aXR5SWQsCiAgICAgIGF1dG9EZWxldGU6ICFjb25maWcgfHwgY29uZmlnLmF1dG9EZWxldGUgIT09IGZhbHNlLAogICAgfSk7CiAgfQoKICBzZXQgaGFzcyhoYXNzKSB7CiAgICB0aGlzLl9oYXNzID0gaGFzczsKICAgIF9fanNhX18uY29ubmVjdChoYXNzKTsKICAgIC8vIE9ubHkgcmUtcmVuZGVyIHdoZW4gdGhlIHJlbGV2YW50IGVudGl0eSBhY3R1YWxseSBjaGFuZ2VkIOKAlCBwcmV2ZW50cwogICAgLy8gcmVwZWF0ZWQgQ0ROIGxvZ28gcmVxdWVzdHMgb24gZXZlcnkgdW5yZWxhdGVkIEhBIHN0YXRlIGNoYW5nZS4KICAgIHZhciBzdGF0ZU9iaiA9IGhhc3Muc3RhdGVzW3RoaXMuX2VudGl0eUlkIHx8ICgnc2Vuc29yLicgKyBfX2pzYV9fLnNjcmlwdElkKV07CiAgICB2YXIgc2lnID0gc3RhdGVPYmogPyBzdGF0ZU9iai5zdGF0ZSArIHN0YXRlT2JqLmxhc3RfY2hhbmdlZCA6ICcnOwogICAgaWYgKHNpZyA9PT0gdGhpcy5fbGFzdFNpZykgcmV0dXJuOwogICAgdGhpcy5fbGFzdFNpZyA9IHNpZzsKICAgIHRoaXMuX3JlbmRlcigpOwogIH0KCiAgc3RhdGljIGdldENvbmZpZ0VsZW1lbnQoKSB7CiAgICByZXR1cm4gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnb3BlbmxpZ2FkYi1jYXJkLWVkaXRvcicpOwogIH0KCiAgc3RhdGljIGdldFN0dWJDb25maWcoKSB7IHJldHVybiB7fTsgfQoKICBzdGF0aWMgZ2V0R3JpZE9wdGlvbnMoKSB7CiAgICByZXR1cm4geyByb3dzOiAzLCBjb2x1bW5zOiAxMiwgbWluX3Jvd3M6IDIsIG1heF9yb3dzOiA4LCBtaW5fY29sdW1uczogNCwgbWF4X2NvbHVtbnM6IDEyIH07CiAgfQoKICBfcmVuZGVyKCkgewogICAgdmFyIHIgPSB0aGlzLnNoYWRvd1Jvb3Q7CiAgICBpZiAoIXRoaXMuX2hhc3MpIHJldHVybjsKCiAgICB2YXIgRU5USVRZX0lEID0gdGhpcy5fZW50aXR5SWQgfHwgKCdzZW5zb3IuJyArIF9fanNhX18uc2NyaXB0SWQpOwogICAgdmFyIHN0YXRlT2JqID0gdGhpcy5faGFzcy5zdGF0ZXNbRU5USVRZX0lEXTsKCiAgICBpZiAoIXN0YXRlT2JqKSB7CiAgICAgIHIuaW5uZXJIVE1MID0KICAgICAgICAnPHN0eWxlPicgKwogICAgICAgICc6aG9zdHtkaXNwbGF5OmJsb2NrfScgKwogICAgICAgICdoYS1jYXJke3BhZGRpbmc6MTZweDt0ZXh0LWFsaWduOmNlbnRlcjtjdXJzb3I6cG9pbnRlcjtvcGFjaXR5Oi43NX0nICsKICAgICAgICAnLmhlYWRlcntmb250LXNpemU6Ljg1ZW07Y29sb3I6dmFyKC0tc2Vjb25kYXJ5LXRleHQtY29sb3IpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzoxLjVweDtmb250LXdlaWdodDpib2xkO21hcmdpbi1ib3R0b206MTVweH0nICsKICAgICAgICAnLm1hdGNoe2Rpc3BsYXk6ZmxleDtqdXN0aWZ5LWNvbnRlbnQ6c3BhY2UtYmV0d2VlbjthbGlnbi1pdGVtczpjZW50ZXI7bWFyZ2luLWJvdHRvbToyMHB4fScgKwogICAgICAgICcudGVhbXtmbGV4OjE7dGV4dC1hbGlnbjpjZW50ZXJ9JyArCiAgICAgICAgJy5iYWxse2ZvbnQtc2l6ZTozZW07bGluZS1oZWlnaHQ6MTtmaWx0ZXI6Z3JheXNjYWxlKDEpO29wYWNpdHk6LjM1fScgKwogICAgICAgICcudGVhbS1uYW1le2ZvbnQtc2l6ZTouODVlbTttYXJnaW4tdG9wOjhweDtmb250LXdlaWdodDo1MDA7Y29sb3I6dmFyKC0tc2Vjb25kYXJ5LXRleHQtY29sb3IpfScgKwogICAgICAgICcuc2NvcmV7ZmxleDouNjtmb250LXNpemU6Mi4yZW07Zm9udC13ZWlnaHQ6OTAwO29wYWNpdHk6LjJ9JyArCiAgICAgICAgJy5iYWRnZXtkaXNwbGF5OmlubGluZS1ibG9jaztwYWRkaW5nOjZweCAxOHB4O2JhY2tncm91bmQ6dmFyKC0tcHJpbWFyeS1jb2xvcik7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjIwcHg7Zm9udC1zaXplOi44NWVtO2ZvbnQtd2VpZ2h0OjYwMH0nICsKICAgICAgICAnPC9zdHlsZT4nICsKICAgICAgICAnPGhhLWNhcmQ+JyArCiAgICAgICAgICAnPGRpdiBjbGFzcz0iaGVhZGVyIj5PcGVuTGlnYURCPC9kaXY+JyArCiAgICAgICAgICAnPGRpdiBjbGFzcz0ibWF0Y2giPicgKwogICAgICAgICAgICAnPGRpdiBjbGFzcz0idGVhbSI+PGRpdiBjbGFzcz0iYmFsbCI+XHUyNkJEPC9kaXY+PGRpdiBjbGFzcz0idGVhbS1uYW1lIj5IZWltPC9kaXY+PC9kaXY+JyArCiAgICAgICAgICAgICc8ZGl2IGNsYXNzPSJzY29yZSI+VlM8L2Rpdj4nICsKICAgICAgICAgICAgJzxkaXYgY2xhc3M9InRlYW0iPjxkaXYgY2xhc3M9ImJhbGwiPlx1MjZCRDwvZGl2PjxkaXYgY2xhc3M9InRlYW0tbmFtZSI+R2FzdDwvZGl2PjwvZGl2PicgKwogICAgICAgICAgJzwvZGl2PicgKwogICAgICAgICAgJzxkaXYgY2xhc3M9ImJhZGdlIj5Lb25maWd1cmllcmVuPC9kaXY+JyArCiAgICAgICAgJzwvaGEtY2FyZD4nOwogICAgICByLnF1ZXJ5U2VsZWN0b3IoJ2hhLWNhcmQnKS5vbmNsaWNrID0gZnVuY3Rpb24oKSB7IHdpbmRvdy5wb3N0TWVzc2FnZSh7IHR5cGU6ICdqc2Etb3Blbi1lZGl0b3InIH0sICcqJyk7IH07CiAgICAgIHJldHVybjsKICAgIH0KCiAgICB2YXIgYXR0ciA9IHN0YXRlT2JqLmF0dHJpYnV0ZXM7CiAgICB2YXIgc3RhdGUgPSBzdGF0ZU9iai5zdGF0ZTsKCiAgICBpZiAoc3RhdGUgPT09ICdub19tYXRjaCcgJiYgIWF0dHIuZGF0ZXRpbWUpIHsKICAgICAgdmFyIG5vTWF0Y2hOYW1lID0gYXR0ci50ZWFtX25hbWUgfHwgJyc7CiAgICAgIHIuaW5uZXJIVE1MID0gJzxoYS1jYXJkIHN0eWxlPSJwYWRkaW5nOjE2cHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tc2Vjb25kYXJ5LXRleHQtY29sb3IpIj4nICsKICAgICAgICAobm9NYXRjaE5hbWUgPyAnPGRpdiBzdHlsZT0iZm9udC13ZWlnaHQ6NjAwO21hcmdpbi1ib3R0b206NnB4Ij4nICsgbm9NYXRjaE5hbWUgKyAnPC9kaXY+JyA6ICcnKSArCiAgICAgICAgJzxkaXY+XHUyNkJEIEtlaW4gU3BpZWwgZ2VmdW5kZW48L2Rpdj4nICsKICAgICAgICAnPGRpdiBzdHlsZT0iZm9udC1zaXplOi44ZW07bWFyZ2luLXRvcDo2cHgiPlNhaXNvbiBvZGVyIExpZ2EgcHJcdTAwZmNmZW48L2Rpdj4nICsKICAgICAgICAnPC9oYS1jYXJkPic7CiAgICAgIHJldHVybjsKICAgIH0KICAgIGlmICghYXR0ciB8fCAhYXR0ci5kYXRldGltZSkgewogICAgICByLmlubmVySFRNTCA9ICc8aGEtY2FyZCBzdHlsZT0icGFkZGluZzoxNnB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXNlY29uZGFyeS10ZXh0LWNvbG9yKSI+V2FydGUgYXVmIERhdGVuLi4uPC9oYS1jYXJkPic7CiAgICAgIHJldHVybjsKICAgIH0KCiAgICB2YXIgbWF0Y2hEYXRlID0gbmV3IERhdGUoYXR0ci5kYXRldGltZSk7CiAgICB2YXIgbm93ID0gbmV3IERhdGUoKTsKICAgIHZhciB0b21vcnJvdyA9IG5ldyBEYXRlKG5vdyk7IHRvbW9ycm93LnNldERhdGUobm93LmdldERhdGUoKSArIDEpOwogICAgdmFyIHRpbWVPbmx5ID0gbWF0Y2hEYXRlLnRvTG9jYWxlVGltZVN0cmluZygnZGUtREUnLCB7IGhvdXI6ICcyLWRpZ2l0JywgbWludXRlOiAnMi1kaWdpdCcgfSkgKyAnIFVocic7CgogICAgdmFyIGJhZGdlVGV4dCA9IHRpbWVPbmx5OwogICAgdmFyIGN1cnJlbnRNaW51dGUgPSAwOwoKICAgIGlmIChzdGF0ZSA9PT0gJ2xpdmUnKSB7CiAgICAgIHZhciBkaWZmTWlucyA9IE1hdGguZmxvb3IoKG5vdyAtIG1hdGNoRGF0ZSkgLyA2MDAwMCk7CiAgICAgIGlmIChkaWZmTWlucyA8IDQ1KSAgICAgICB7IGN1cnJlbnRNaW51dGUgPSBkaWZmTWluczsgICAgICBiYWRnZVRleHQgPSBkaWZmTWlucyArICcuIE1pbi4nOyB9CiAgICAgIGVsc2UgaWYgKGRpZmZNaW5zIDwgNjApICB7IGJhZGdlVGV4dCA9ICdIYWxiemVpdCc7IH0KICAgICAgZWxzZSBpZiAoZGlmZk1pbnMgPCAxMDUpIHsgY3VycmVudE1pbnV0ZSA9IGRpZmZNaW5zIC0gMTU7IGJhZGdlVGV4dCA9IChkaWZmTWlucyAtIDE1KSArICcuIE1pbi4nOyB9CiAgICAgIGVsc2UgICAgICAgICAgICAgICAgICAgICB7IGN1cnJlbnRNaW51dGUgPSA5MDsgICAgICAgICAgICAgYmFkZ2VUZXh0ID0gJzkwLisgTWluLic7IH0KICAgICAgaWYgKGF0dHIubGFzdF9nb2FsICYmIGF0dHIubGFzdF9nb2FsX21pbnV0ZSkgewogICAgICAgIHZhciBhZ2UgPSBjdXJyZW50TWludXRlIC0gYXR0ci5sYXN0X2dvYWxfbWludXRlOwogICAgICAgIGlmIChhZ2UgPj0gMCAmJiBhZ2UgPD0gNSkgYmFkZ2VUZXh0ID0gJ1x1MjZCRCAnICsgYXR0ci5sYXN0X2dvYWw7CiAgICAgIH0KICAgIH0gZWxzZSBpZiAoc3RhdGUgPT09ICdmaW5pc2hlZCcpIHsKICAgICAgYmFkZ2VUZXh0ID0gJ1NwaWVsIGJlZW5kZXQnOwogICAgfSBlbHNlIHsKICAgICAgaWYgKG1hdGNoRGF0ZS50b0RhdGVTdHJpbmcoKSA9PT0gbm93LnRvRGF0ZVN0cmluZygpKSAgICAgICAgICAgYmFkZ2VUZXh0ID0gJ0hldXRlLCAnICsgdGltZU9ubHk7CiAgICAgIGVsc2UgaWYgKG1hdGNoRGF0ZS50b0RhdGVTdHJpbmcoKSA9PT0gdG9tb3Jyb3cudG9EYXRlU3RyaW5nKCkpIGJhZGdlVGV4dCA9ICdNb3JnZW4sICcgKyB0aW1lT25seTsKICAgICAgZWxzZSBiYWRnZVRleHQgPSBtYXRjaERhdGUudG9Mb2NhbGVEYXRlU3RyaW5nKCdkZS1ERScsIHsgd2Vla2RheTogJ3Nob3J0JywgZGF5OiAnMi1kaWdpdCcsIG1vbnRoOiAnMi1kaWdpdCcgfSkgKyAnLCAnICsgdGltZU9ubHk7CiAgICB9CgogICAgdmFyIGhvbWVJY29uID0gTE9HT19PVkVSUklERVNbYXR0ci50ZWFtX2hvbWVfaWRdIHx8IGZpeExvZ29VcmwoYXR0ci50ZWFtX2hvbWVfaWNvbik7CiAgICB2YXIgYXdheUljb24gPSBMT0dPX09WRVJSSURFU1thdHRyLnRlYW1fYXdheV9pZF0gfHwgZml4TG9nb1VybChhdHRyLnRlYW1fYXdheV9pY29uKTsKICAgIHZhciBpc0xpdmUgPSBzdGF0ZSA9PT0gJ2xpdmUnOwogICAgdmFyIGhlYWRlckNsYXNzID0gaXNMaXZlID8gJ2hlYWRlciBsaXZlJyA6ICdoZWFkZXInOwogICAgdmFyIGhlYWRlckNvbnRlbnQgPSBpc0xpdmUKICAgICAgPyAnPHNwYW4gY2xhc3M9ImxpdmUtZG90Ij48L3NwYW4+TElWRScKICAgICAgOiAoc3RhdGUgPT09ICdmaW5pc2hlZCcgPyAnRW5kZXJnZWJuaXMnIDogJ05cdTAwZTRjaHN0ZXMgU3BpZWwnKTsKICAgIHZhciBzY29yZUNvbnRlbnQgPSBzdGF0ZSAhPT0gJ3NjaGVkdWxlZCcKICAgICAgPyAoYXR0ci5zY29yZV9ob21lICsgJzonICsgYXR0ci5zY29yZV9hd2F5KQogICAgICA6ICc8c3BhbiBzdHlsZT0ib3BhY2l0eTouMztmb250LXNpemU6LjdlbSI+VlM8L3NwYW4+JzsKCiAgICByLmlubmVySFRNTCA9CiAgICAgICc8c3R5bGU+JyArCiAgICAgICc6aG9zdHtkaXNwbGF5OmJsb2NrfScgKwogICAgICAnaGEtY2FyZHtwYWRkaW5nOjE2cHg7dGV4dC1hbGlnbjpjZW50ZXI7Y3Vyc29yOnBvaW50ZXJ9JyArCiAgICAgICdAa2V5ZnJhbWVzIHB1bHNlezAlLDEwMCV7b3BhY2l0eToxfTUwJXtvcGFjaXR5Oi4zfX0nICsKICAgICAgJy5saXZlLWRvdHtoZWlnaHQ6MTBweDt3aWR0aDoxMHB4O2JhY2tncm91bmQ6I2U3NGMzYztib3JkZXItcmFkaXVzOjUwJTtkaXNwbGF5OmlubGluZS1ibG9jazttYXJnaW4tcmlnaHQ6OHB4O2FuaW1hdGlvbjpwdWxzZSAxLjVzIGluZmluaXRlfScgKwogICAgICAnLmhlYWRlcntmb250LXNpemU6Ljg1ZW07Y29sb3I6dmFyKC0tc2Vjb25kYXJ5LXRleHQtY29sb3IpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzoxLjVweDtmb250LXdlaWdodDpib2xkO21hcmdpbi1ib3R0b206MTVweH0nICsKICAgICAgJy5oZWFkZXIubGl2ZXtjb2xvcjojZTc0YzNjfScgKwogICAgICAnLm1hdGNoe2Rpc3BsYXk6ZmxleDtqdXN0aWZ5LWNvbnRlbnQ6c3BhY2UtYmV0d2VlbjthbGlnbi1pdGVtczpjZW50ZXI7bWFyZ2luLWJvdHRvbToyMHB4fScgKwogICAgICAnLnRlYW17ZmxleDoxO3RleHQtYWxpZ246Y2VudGVyfScgKwogICAgICAnLnRlYW0gaW1ne3dpZHRoOjU1cHg7aGVpZ2h0OjU1cHg7b2JqZWN0LWZpdDpjb250YWlufScgKwogICAgICAnLnRlYW0tbmFtZXtmb250LXNpemU6Ljg1ZW07bWFyZ2luLXRvcDo4cHg7Zm9udC13ZWlnaHQ6NTAwO2xpbmUtaGVpZ2h0OjEuMn0nICsKICAgICAgJy5zY29yZXtmbGV4Oi42O2ZvbnQtc2l6ZToyLjJlbTtmb250LXdlaWdodDo5MDB9JyArCiAgICAgICcuYmFkZ2V7ZGlzcGxheTppbmxpbmUtYmxvY2s7cGFkZGluZzo2cHggMThweDtiYWNrZ3JvdW5kOnZhcigtLXNlY29uZGFyeS1iYWNrZ3JvdW5kLWNvbG9yKTtib3JkZXItcmFkaXVzOjIwcHg7Zm9udC1zaXplOi45ZW07Zm9udC13ZWlnaHQ6NTAwO2JvcmRlcjoxcHggc29saWQgdmFyKC0tZGl2aWRlci1jb2xvcil9JyArCiAgICAgICc8L3N0eWxlPicgKwogICAgICAnPGhhLWNhcmQ+JyArCiAgICAgICAgJzxkaXYgY2xhc3M9IicgKyBoZWFkZXJDbGFzcyArICciPicgKyBoZWFkZXJDb250ZW50ICsgJzwvZGl2PicgKwogICAgICAgICc8ZGl2IGNsYXNzPSJtYXRjaCI+JyArCiAgICAgICAgICAnPGRpdiBjbGFzcz0idGVhbSI+PGltZyBzcmM9IicgKyBob21lSWNvbiArICciPjxkaXYgY2xhc3M9InRlYW0tbmFtZSI+JyArIGF0dHIudGVhbV9ob21lICsgJzwvZGl2PjwvZGl2PicgKwogICAgICAgICAgJzxkaXYgY2xhc3M9InNjb3JlIj4nICsgc2NvcmVDb250ZW50ICsgJzwvZGl2PicgKwogICAgICAgICAgJzxkaXYgY2xhc3M9InRlYW0iPjxpbWcgc3JjPSInICsgYXdheUljb24gKyAnIj48ZGl2IGNsYXNzPSJ0ZWFtLW5hbWUiPicgKyBhdHRyLnRlYW1fYXdheSArICc8L2Rpdj48L2Rpdj4nICsKICAgICAgICAnPC9kaXY+JyArCiAgICAgICAgJzxkaXYgY2xhc3M9ImJhZGdlIj4nICsgYmFkZ2VUZXh0ICsgJzwvZGl2PicgKwogICAgICAnPC9oYS1jYXJkPic7CgogICAgdmFyIGVudGl0eUlkRm9yUmVmcmVzaCA9IEVOVElUWV9JRDsKICAgIHIucXVlcnlTZWxlY3RvcignaGEtY2FyZCcpLm9uY2xpY2sgPSBmdW5jdGlvbigpIHsgX19qc2FfXy5jYWxsQWN0aW9uKCdyZWZyZXNoJywgeyBlbnRpdHlJZDogZW50aXR5SWRGb3JSZWZyZXNoIH0pLmNhdGNoKGZ1bmN0aW9uKCkge30pOyB9OwogIH0KCiAgZ2V0Q2FyZFNpemUoKSB7IHJldHVybiAzOyB9Cn0KCi8vIOKUgOKUgOKUgCBDb25maWcgRWRpdG9yICh1c2VzIF9fanNhX18ud2l6YXJkKCkpIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgAoKY2xhc3MgT3BlbmxpZ2FkYkNhcmRFZGl0b3IgZXh0ZW5kcyBIVE1MRWxlbWVudCB7CiAgY29uc3RydWN0b3IoKSB7CiAgICBzdXBlcigpOwogICAgdGhpcy5hdHRhY2hTaGFkb3coeyBtb2RlOiAnb3BlbicgfSk7CiAgICB0aGlzLl9jZmcgPSB7fTsKICB9CgogIHNldCBoYXNzKGhhc3MpIHsKICAgIGlmICghdGhpcy5faGFzc1JlYWR5KSB7CiAgICAgIHRoaXMuX2hhc3NSZWFkeSA9IHRydWU7CiAgICAgIF9fanNhX18uY29ubmVjdChoYXNzKTsKICAgICAgdGhpcy5fcnVuV2l6YXJkKCk7CiAgICB9CiAgfQoKICBzZXQgY29uZmlnKGNmZykgeyB0aGlzLl9jZmcgPSBjZmc7IH0KICBzZXRDb25maWcoY2ZnKSB7IHRoaXMuX2NmZyA9IGNmZzsgfQoKICBfcnVuV2l6YXJkKCkgewogICAgX19qc2FfXy53aXphcmQodGhpcywgewogICAgICBzdGVwczogWwogICAgICAgIHsKICAgICAgICAgIGlkOiAnbGVhZ3VlJywKICAgICAgICAgIGxhYmVsOiAnTGlnYSB3XHUwMGU0aGxlbicsCiAgICAgICAgICBhY3Rpb246ICdnZXRfbGVhZ3VlcycsCiAgICAgICAgICB2YWx1ZUtleTogJ3Nob3J0JywKICAgICAgICAgIGxhYmVsS2V5OiAnbmFtZScsCiAgICAgICAgICBzZWFzb25GaWVsZDogdHJ1ZSwKICAgICAgICAgIGZyZWVJbnB1dDogdHJ1ZSwKICAgICAgICB9LAogICAgICAgIHsKICAgICAgICAgIGlkOiAndGVhbScsCiAgICAgICAgICBsYWJlbDogJ01hbm5zY2hhZnQgd1x1MDBlNGhsZW4nLAogICAgICAgICAgYWN0aW9uOiAnZ2V0X3RlYW1zJywKICAgICAgICAgIGRlcGVuZHM6IHsgbGVhZ3VlOiAnbGVhZ3VlJywgc2Vhc29uOiAnc2Vhc29uJyB9LAogICAgICAgICAgdmFsdWVLZXk6ICd0ZWFtSWQnLAogICAgICAgICAgbGFiZWxLZXk6ICd0ZWFtTmFtZScsCiAgICAgICAgfSwKICAgICAgXSwKICAgICAgb25Db21wbGV0ZTogYXN5bmMgZnVuY3Rpb24odmFsdWVzLCBpbnN0YW5jZUlkKSB7CiAgICAgICAgdmFyIHRlYW1JdGVtID0gdmFsdWVzLnRlYW1faXRlbTsKICAgICAgICB2YXIgcmVzdWx0ID0gYXdhaXQgX19qc2FfXy5jYWxsQWN0aW9uKCdhZGRfdGVhbScsIHsKICAgICAgICAgIGxlYWd1ZTogdmFsdWVzLmxlYWd1ZSwKICAgICAgICAgIHNlYXNvbjogdmFsdWVzLnNlYXNvbiwKICAgICAgICAgIHRlYW1JZDogdGVhbUl0ZW0udGVhbUlkLAogICAgICAgICAgdGVhbU5hbWU6IHRlYW1JdGVtLnRlYW1OYW1lLAogICAgICAgICAgdGVhbUljb246IHRlYW1JdGVtLnRlYW1JY29uVXJsIHx8IG51bGwsCiAgICAgICAgfSk7CiAgICAgICAgdmFyIGVudGl0eUlkID0gcmVzdWx0ICYmIHJlc3VsdC5lbnRpdHlJZCA/IHJlc3VsdC5lbnRpdHlJZCA6IG51bGw7CiAgICAgICAgcmV0dXJuIHsgZW50aXR5SWQ6IGVudGl0eUlkIHx8IHVuZGVmaW5lZCwgaW5zdGFuY2VJZDogaW5zdGFuY2VJZCwgYXV0b0RlbGV0ZTogdHJ1ZSB9OwogICAgICB9LAogICAgfSk7CiAgfQp9Cgp0cnkgeyBjdXN0b21FbGVtZW50cy5kZWZpbmUoJ29wZW5saWdhZGItY2FyZCcsIE9wZW5saWdhZGJDYXJkKTsgfSBjYXRjaChfKSB7fQp0cnkgeyBjdXN0b21FbGVtZW50cy5kZWZpbmUoJ29wZW5saWdhZGItY2FyZC1lZGl0b3InLCBPcGVubGlnYWRiQ2FyZEVkaXRvcik7IH0gY2F0Y2goXykge30K
__JSA_CARD_END__ */
