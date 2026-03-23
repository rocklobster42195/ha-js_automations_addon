/**
 * @name OpenLigaDB
 * @description Creates a Home Assistant sensor for the next match of a specific football team using the OpenLigaDB API.
 * This script provides team information, live match status, scores, and a corresponding Lovelace card.
 *
 * @version 2.0.0
 * @author Gemini
 * @npm axios
 */

const axios = require('axios');

// --- CONFIGURATION ---
const CONFIG = {
    teamName: 'Borussia Mönchengladbach',
    teamId: 87, // Borussia Mönchengladbach (Note: as a number, not a string)
    league: 'bl1', // 1. Bundesliga
    season: '2025', // The year the season started in (e.g., 2025 for the 25/26 season)
    entity_id: 'sensor.openligadb_borussia_monchengladbach',
    // Polling interval in minutes
    poll_interval_scheduled: 15,
    poll_interval_live: 1,
};
// --- END CONFIGURATION ---

const CARD_CODE = `
/*
  MAPPING FOR MANUAL LOGO CORRECTIONS
  Syntax: "TeamID": "HTTPS link to the logo"
*/
const LOGO_MAPPING = {
  "98": "https://upload.wikimedia.org/wikipedia/commons/b/b3/Fc_st_pauli_logo.svg",
  "7":  "https://upload.wikimedia.org/wikipedia/commons/6/67/Borussia_Dortmund_logo.svg",
  "87": "https://upload.wikimedia.org/wikipedia/commons/8/81/Borussia_M%C3%B6nchengladbach_logo.svg"
};

console.info("%c OPENLIGADB-CARD %c v14.0.0 (Smart-Live-Edition) ", "color: white; background: #25a69a; font-weight: 700;", "color: #25a69a; background: white; font-weight: 700;");

class OpenLigaDBCard extends HTMLElement {
  static getConfigForm() {
    return { schema: [{ name: "entity", label: "Mannschaft", required: true, selector: { entity: { domain: "sensor" } } }] };
  }

  setConfig(config) { this.config = config; }

  set hass(hass) {
    const stateObj = hass.states[this.config.entity];
    if (!stateObj) {
        this.innerHTML = \`<ha-card><div style="padding: 16px;">Entity not found: \${this.config.entity}</div></ha-card>\`;
        return;
    }

    const attr = stateObj.attributes;
    const state = stateObj.state;

    if (!attr || !attr.datetime) {
      this.innerHTML = \`<ha-card><div style="padding: 16px;">Waiting for data...</div></ha-card>\`;
      return;
    }

    const matchDate = new Date(attr.datetime);
    const now = new Date();
    const isToday = matchDate.toDateString() === now.toDateString();
    const tomorrow = new Date(); tomorrow.setDate(now.getDate() + 1);
    const isTomorrow = matchDate.toDateString() === tomorrow.toDateString();
    const timeOnly = matchDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + " Uhr";
    
    let badgeText = timeOnly;

    if (state === "live") {
      const diffMs = now - matchDate;
      const diffMins = Math.floor(diffMs / 60000);
      let currentMinute = 0;
      
      if (diffMins < 45) {
        currentMinute = diffMins;
        badgeText = \`\${currentMinute}'. Min.\`;
      } else if (diffMins >= 45 && diffMins < 60) {
        badgeText = "Halbzeit";
      } else if (diffMins >= 60 && diffMins < 105) {
        currentMinute = diffMins - 15;
        badgeText = \`\${currentMinute}'. Min.\`;
      } else {
        currentMinute = 90;
        badgeText = "90.+ Min.";
      }

      if (attr.last_goal && attr.last_goal_minute) {
        const goalAge = currentMinute - attr.last_goal_minute;
        if (goalAge >= 0 && goalAge <= 5) {
          badgeText = \`⚽️ \${attr.last_goal}\`;
        }
      }
    } else if (state === "finished") {
      badgeText = "Spiel beendet";
    } else {
      if (isToday) badgeText = \`Heute, \${timeOnly}\`;
      else if (isTomorrow) badgeText = \`Morgen, \${timeOnly}\`;
      else badgeText = matchDate.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }) + ", " + timeOnly;
    }

    const homeIcon = LOGO_MAPPING[attr.team_home_id] || (attr.team_home_icon ? attr.team_home_icon.replace('http:', 'https:') : '');
    const awayIcon = LOGO_MAPPING[attr.team_away_id] || (attr.team_away_icon ? attr.team_away_icon.replace('http:', 'https:') : '');

    this.innerHTML = \`
      <style>
        .ol-card { padding: 16px; text-align: center; cursor: pointer; transition: opacity 0.2s; }
        @keyframes ol-pulse { 0% { opacity: 1; } 50% { opacity: 0.3; } 100% { opacity: 1; } }
        .ol-live-dot { height: 10px; width: 10px; background-color: #e74c3c; border-radius: 50%; display: inline-block; margin-right: 8px; animation: ol-pulse 1.5s infinite; }
        .ol-header { font-size: 0.85em; color: var(--secondary-text-color); text-transform: uppercase; letter-spacing: 1.5px; font-weight: bold; margin-bottom: 15px; }
        .ol-header.is-live { color: #e74c3c; }
        .ol-match { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .ol-team { flex: 1; text-align: center; width: 40%; }
        .ol-team img { width: 55px; height: 55px; object-fit: contain; }
        .ol-team-name { font-size: 0.85em; margin-top: 8px; font-weight: 500; line-height: 1.2; }
        .ol-score { flex: 0.6; font-size: 2.2em; font-weight: 900; }
        .ol-badge { display: inline-block; padding: 6px 18px; background: var(--secondary-background-color); border-radius: 20px; font-size: 0.9em; font-weight: 500; border: 1px solid var(--divider-color); }
      </style>
      <ha-card class="ol-card">
        <div class="ol-header \${state === 'live' ? 'is-live' : ''}">
          \${state === 'live' ? '<span class="ol-live-dot"></span>LIVE' : (state === 'finished' ? 'Endergebnis' : 'Nächstes Spiel')}
        </div>
        <div class="ol-match">
          <div class="ol-team"><img src="\${homeIcon}"><div class="ol-team-name">\${attr.team_home}</div></div>
          <div class="ol-score">\${state !== 'scheduled' ? \`\${attr.score_home}:\${attr.score_away}\` : '<span style="opacity:0.3;font-size:0.7em">VS</span>'}</div>
          <div class="ol-team"><img src="\${awayIcon}"><div class="ol-team-name">\${attr.team_away}</div></div>
        </div>
        <div class="ol-badge">\${badgeText}</div>
      </ha-card>
    \`;

    this.onclick = () => {
      this.style.opacity = "0.5";
      setTimeout(() => { this.style.opacity = "1"; }, 200);
      hass.callService("homeassistant", "update_entity", { entity_id: this.config.entity });
    };
  }
}
customElements.define("openligadb-card", OpenLigaDBCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "openligadb-card", name: "OpenLigaDB Match Card", preview: true });
`;

// Helper to parse datetime from API
function parseDateTime(str) {
    if (!str) return null;
    return new Date(str);
}

// Main function to fetch and update data
async function updateMatchData() {
    ha.log(`Fetching match data for ${CONFIG.teamName} (Season: ${CONFIG.season})...`);

    try {
        const url = `https://api.openligadb.de/getmatchdata/${CONFIG.league}/${CONFIG.season}`;
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'HA-JS-Automations-Addon/1.0.0 (OpenLigaDB-Script)' }
        });
        
        const allMatches = response.data;
        if (!Array.isArray(allMatches) || allMatches.length === 0) {
            ha.warn('API returned no match data for the season.');
            ha.update(CONFIG.entity_id, { state: 'no_data', friendly_name: `OpenLigaDB ${CONFIG.teamName}` });
            return;
        }

        // --- Filter for team and sort by date ---
        const teamMatches = allMatches
            .filter(m => m.team1?.teamId === CONFIG.teamId || m.team2?.teamId === CONFIG.teamId)
            .sort((a, b) => new Date(a.matchDateTime) - new Date(b.matchDateTime));

        if (teamMatches.length === 0) {
            ha.warn(`No matches found for team ID ${CONFIG.teamId} in the season data.`);
            ha.update(CONFIG.entity_id, { state: 'no_match_in_season', friendly_name: `OpenLigaDB ${CONFIG.teamName}` });
            return;
        }

        // --- Find the currently relevant match (live, last, or next) ---
        const now = new Date();
        let selectedMatch = null;

        const liveMatch = teamMatches.find(m => !m.matchIsFinished && parseDateTime(m.matchDateTime) <= now);

        if (liveMatch) {
            selectedMatch = liveMatch;
        } else {
            const finishedMatches = teamMatches.filter(m => m.matchIsFinished);
            const lastFinished = finishedMatches.length > 0 ? finishedMatches[finishedMatches.length - 1] : null;
            
            const upcomingMatches = teamMatches.filter(m => !m.matchIsFinished);
            const nextUpcoming = upcomingMatches.length > 0 ? upcomingMatches[0] : null;

            if (lastFinished && (now - parseDateTime(lastFinished.matchDateTime)) < 24 * 60 * 60 * 1000) {
                selectedMatch = lastFinished;
                if (nextUpcoming && (parseDateTime(nextUpcoming.matchDateTime) - now) < 3 * 60 * 60 * 1000) {
                    selectedMatch = nextUpcoming;
                }
            } else {
                selectedMatch = nextUpcoming || lastFinished;
            }
        }

        if (!selectedMatch) {
            ha.warn('Could not determine a relevant match to display.');
            ha.update(CONFIG.entity_id, { state: 'no_relevant_match', friendly_name: `OpenLigaDB ${CONFIG.teamName}` });
            return;
        }
        
        const m = selectedMatch;

        // --- Determine Match State ---
        let state = 'scheduled';
        const matchTime = parseDateTime(m.matchDateTime);

        if (matchTime) {
            if (m.matchIsFinished) {
                state = 'finished';
            } else if (now >= matchTime) {
                state = 'live';
            }
        }
        
        // --- Process Results and Goals ---
        const results = m.matchResults || [];
        let finalResult = results.find(r => r.resultTypeID === 2) || (results.length > 0 ? results[results.length - 1] : null);

        const goals = m.goals || [];
        let last_goal_text = "";
        let last_goal_minute = 0;

        if (goals.length > 0) {
            const g = goals[goals.length - 1];
            last_goal_minute = g.matchMinute || 0;
            const name = g.goalGetterName;
            last_goal_text = `${g.matchMinute}' Tor${name ? `: ${name}` : ''}`;
        }

        // --- Build Attributes Object ---
        const attributes = {
            datetime: m.matchDateTime,
            team_home: m.team1.teamName,
            team_home_id: String(m.team1.teamId),
            team_home_icon: m.team1.teamIconUrl,
            team_away: m.team2.teamName,
            team_away_id: String(m.team2.teamId),
            team_away_icon: m.team2.teamIconUrl,
            score_home: finalResult ? finalResult.pointsTeam1 : 0,
            score_away: finalResult ? finalResult.pointsTeam2 : 0,
            last_goal: last_goal_text,
            last_goal_minute: last_goal_minute,
            match_id: m.matchID,
            league_name: m.leagueName,
        };

        // --- Update Home Assistant Entity ---
        ha.update(CONFIG.entity_id, {
            state: state,
            ...attributes
        });
        ha.log(`Update successful. State: ${state}, Score: ${attributes.score_home}:${attributes.score_away}`);

    } catch (error) {
        if (error.response && error.response.status === 404) {
            ha.error(`API returned a 404. Please check if league '${CONFIG.league}' and season '${CONFIG.season}' are correct.`);
        } else {
            ha.error('Failed to fetch or process OpenLigaDB data.');
            ha.error(error.stack);
        }
        // Make sensor unavailable on error
        ha.update(CONFIG.entity_id, { state: 'unavailable' });
    }
}


// --- SCRIPT INITIALIZATION ---
function init() {
    ha.log('--- OpenLigaDB Script Initializing ---');
    ha.log('This script creates a sensor and a Lovelace card for football matches.');
    ha.log('STEP 1: The backend sensor will be created/updated shortly.');
    ha.log('STEP 2: To use the card, create a new file in your `<config>/www/` directory named `openligadb-card.js`.');
    ha.log('STEP 3: Copy the entire content of the `CARD_CODE` variable from this script into that file.');
    ha.log('STEP 4: Refresh your browser (Ctrl+F5) and add the `custom:openligadb-card` to your dashboard, pointing it to this entity: ' + CONFIG.entity_id);
    
    // Register the entity if it doesn't exist.
    // This is persistent across restarts.
    ha.register(CONFIG.entity_id, {
        name: `OpenLigaDB ${CONFIG.teamName}`,
        icon: 'mdi:soccer',
        initial_state: 'unknown'
    });

    // Perform an initial update when the script starts
    updateMatchData();

    // --- Dynamic Polling Scheduler ---
    let counter = 0;
    schedule('* * * * *', async () => {
        const state = ha.getStateValue(CONFIG.entity_id);
        const interval = state === 'live' ? CONFIG.poll_interval_live : CONFIG.poll_interval_scheduled;

        if (counter % interval === 0) {
            await updateMatchData();
        }
        counter++;
    });
    
    ha.log(`Scheduler started. Polling every ${CONFIG.poll_interval_scheduled} min, and every ${CONFIG.poll_interval_live} min during live matches.`);
}

init();
