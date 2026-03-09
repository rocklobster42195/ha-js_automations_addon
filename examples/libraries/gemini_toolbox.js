/**
 * @name Gemini Toolbox
 * @description A collection of helper functions to interact with Google Gemini AI.
 *              Requires 'gemini_api_key' in ha.store.
 *              For analyzeImage, 'ha_base_url' (and optional 'ha_token') is required.
 * @icon mdi:brain
 * @version 1.2.0
 * @npm axios
 */

const axios = require('axios');

// --- API Key Instructions ---
// 1. Visit Google AI Studio: https://aistudio.google.com/
// 2. Create a free API Key.
// 3. Save it in the JS Automations Store Explorer under the key 'gemini_api_key'.

// --- Configuration ---
const _GEMINI_API_KEY = ha.store.get('gemini_api_key');
const _GEMINI_MODEL = 'gemini-2.5-flash-lite'; // Fast and cost-effective
const _GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${_GEMINI_MODEL}:generateContent`;

// --- State ---
let _stopSignal = false;

// --- Internal Helpers ---

/**
 * Builds a context string from Home Assistant entities.
 * Fetches current state and friendly names synchronously from ha.states.
 * 
 * @param {string|string[]} entities - Single Entity ID or Array of IDs
 * @returns {string} Formatted context string for the LLM
 */
function _buildGeminiContext(entities) {
    if (!entities) return '';
    
    const list = Array.isArray(entities) ? entities : [entities];
    let contextLines = [];

    list.forEach(id => {
        const entity = ha.states[id];
        if (entity) {
            const name = entity.attributes.friendly_name || id;
            const state = entity.state;
            const unit = entity.attributes.unit_of_measurement || '';
            contextLines.push(`- ${name} (${id}): ${state}${unit}`);
        } else {
            contextLines.push(`- ${id}: <State unknown / Entity not found>`);
        }
    });

    if (contextLines.length === 0) return '';
    
    return "Current Home Assistant Data:\n" + contextLines.join('\n');
}

/**
 * Internal function to perform the API call.
 * Supports text-only and multimodal (parts array) payloads.
 */
async function _callGeminiApi(systemPrompt, userContent, allowRetry = true) {
    if (_stopSignal) return null;

    if (!_GEMINI_API_KEY) {
        ha.error("Gemini Toolbox: No API Key found in ha.store. Please set 'gemini_api_key'.");
        return null;
    }

    try {
        let parts = [];
        
        if (systemPrompt) {
            parts.push({ text: systemPrompt });
        }

        if (Array.isArray(userContent)) {
            parts = parts.concat(userContent);
        } else {
            parts.push({ text: userContent });
        }

        const payload = {
            contents: [{ parts: parts }]
        };

        const response = await axios.post(`${_GEMINI_URL}?key=${_GEMINI_API_KEY}`, payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000 // 10s timeout
        });

        if (response.data && response.data.candidates && response.data.candidates.length > 0) {
            return response.data.candidates[0].content.parts[0].text.trim();
        } else {
            ha.warn("Gemini Toolbox: Received empty response from API.");
            return null;
        }

    } catch (e) {
        // Handle Rate Limits (429) with a simple retry
        if (allowRetry && !_stopSignal && e.response && e.response.status === 429) {
            ha.warn("Gemini Toolbox: Rate limit exceeded (429). Retrying in 10 seconds...");
            await sleep(10000);
            if (_stopSignal) return null;
            return _callGeminiApi(systemPrompt, userContent, false);
        }
        ha.error(`Gemini Toolbox Error: ${e.message}`);
        if (e.response) {
            ha.error(`API Details: ${JSON.stringify(e.response.data)}`);
        }
        return null;
    }
}

/**
 * Helper to parse JSON from LLM response (removes markdown code blocks).
 */
function _parseJson(text) {
    if (!text) return null;
    try {
        const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(clean);
    } catch (e) {
        ha.error(`Gemini JSON Parse Error: ${e.message} | Raw: ${text}`);
        return null;
    }
}

// --- Public Functions ---

/**
 * Sends a prompt to Gemini, optionally enriched with entity states.
 * 
 * @param {string} prompt - The question or instruction (e.g. "Are all windows closed?")
 * @param {string|string[]} [entities] - Optional: List of entities to check
 * @returns {Promise<string>} The AI response text
 */
async function askGemini(prompt, entities = null) {
    const context = _buildGeminiContext(entities);
    const system = `You are an intelligent Home Assistant. Answer the user's question based on the provided data. 
    Answer in the same language as the user (mostly German). Be concise.`;
    
    const fullPrompt = context ? `${context}\n\nUser Question: ${prompt}` : prompt;
    
    const result = await _callGeminiApi(system, fullPrompt);
    return result || "Entschuldigung, ich konnte keine Antwort generieren.";
}

/**
 * Evaluates a condition using AI logic. Useful for fuzzy logic automations.
 * 
 * @param {string} condition - The condition to check (e.g. "Is it dark enough for lights?")
 * @param {string|string[]} entities - Entities providing the context
 * @returns {Promise<boolean>} True or False
 */
async function checkGemini(condition, entities) {
    const context = _buildGeminiContext(entities);
    const system = `You are a logic engine for a Smart Home. 
    Analyze the provided data and the condition. 
    Reply ONLY with the word "TRUE" or "FALSE". 
    Do not provide explanations. Do not use markdown.`;
    
    const fullPrompt = `${context}\n\nCondition to check: ${condition}`;
    
    const result = await _callGeminiApi(system, fullPrompt);
    
    if (result && result.toUpperCase().includes("TRUE")) return true;
    return false;
}

/**
 * Rephrases a standard notification text into a specific style.
 * 
 * @param {string} message - The original message (e.g. "Washing machine finished")
 * @param {string} style - The persona (e.g. "Sarcastic Robot", "Polite Butler", "Pirate")
 * @returns {Promise<string>} The rephrased message
 */
async function rephraseGemini(message, style = "Polite Butler") {
    const system = `You are a creative writer. Rewrite the following smart home notification.
    Style: ${style}.
    Language: German.
    Keep the core information, but change the tone.
    IMPORTANT: Provide exactly ONE rephrased version. Do not offer options. Do not add introductory text. Just the raw message text.`;
    
    const result = await _callGeminiApi(system, message);
    return result || message;
}

/**
 * Analyzes a camera image using Gemini Vision.
 * Requires 'ha_base_url' (e.g. http://192.168.1.5:8123) and optionally 'ha_token' in ha.store.
 * 
 * @param {string} prompt - Question about the image
 * @param {string} entityId - The camera entity ID (e.g. camera.front_door)
 * @returns {Promise<string>} The analysis result
 */
async function analyzeImage(prompt, entityId) {
    const entity = ha.states[entityId];
    if (!entity) return "Error: Camera entity not found.";

    const picturePath = entity.attributes.entity_picture;
    if (!picturePath) return "Error: Entity has no picture attribute.";

    // Configuration for HA Access
    const haUrl = ha.store.get('ha_base_url');
    const haToken = ha.store.get('ha_token');

    if (!haUrl) {
        ha.warn("Gemini Toolbox: 'ha_base_url' not set in ha.store. Cannot fetch image.");
        return "Configuration Error: Please set 'ha_base_url' in Store.";
    }

    try {
        const imageUrl = picturePath.startsWith('http') ? picturePath : `${haUrl}${picturePath}`;
        const headers = {};
        if (haToken) headers['Authorization'] = `Bearer ${haToken}`;

        const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            headers: headers,
            timeout: 5000
        });

        const base64Image = Buffer.from(response.data, 'binary').toString('base64');
        const mimeType = response.headers['content-type'] || 'image/jpeg';

        const userContent = [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64Image } }
        ];

        return await _callGeminiApi("You are a helpful vision assistant.", userContent);

    } catch (e) {
        ha.error(`Gemini Image Fetch Error: ${e.message}`);
        return `Error fetching image: ${e.message}`;
    }
}

/**
 * Generates a scene configuration based on a mood.
 * 
 * @param {string} mood - The desired atmosphere (e.g. "Cyberpunk", "Cozy Reading", "Horror Movie")
 * @param {string[]} entities - List of light entity IDs to control
 * @returns {Promise<Object>} JSON object mapping entity_id to attributes (brightness, rgb_color, etc.)
 */
async function generateScene(mood, entities) {
    const context = _buildGeminiContext(entities);
    const system = `You are a professional lighting designer. 
    Based on the requested mood and the available entities, generate a configuration.
    Return ONLY valid JSON. No markdown. No explanations.
    Format: { "entity_id": { "state": "on", "brightness": 0-255, "rgb_color": [r,g,b] }, ... }
    If a light should be off, set "state": "off".`;

    const prompt = `${context}\n\nCreate a scene for the mood: "${mood}"`;
    
    const result = await _callGeminiApi(system, prompt);
    return _parseJson(result);
}

/**
 * Parses a natural language command into Home Assistant service calls.
 * 
 * @param {string} command - The user instruction (e.g. "Turn on kitchen lights and make them blue")
 * @param {string[]} [entities] - Optional: List of available entities to help resolution
 * @returns {Promise<Array>} Array of service call objects { domain, service, service_data }
 */
async function parseCommand(command, entities = null) {
    const context = _buildGeminiContext(entities);
    const system = `You are a Home Assistant command parser.
    Convert the user's natural language command into a list of service calls.
    Return ONLY valid JSON array. No markdown.
    Format: [ { "domain": "light", "service": "turn_on", "service_data": { "entity_id": "...", "brightness": ... } }, ... ]
    Guess the entity_id based on the name if not provided in context.`;

    const prompt = `${context}\n\nCommand: "${command}"`;
    
    const result = await _callGeminiApi(system, prompt);
    return _parseJson(result) || [];
}

/**
 * Stops any pending retries or operations in the toolbox.
 */
function stopGeminiRetries() {
    _stopSignal = true;
}

// Export functions to global scope (optional, but good practice in this environment)
// In JS Automations, functions defined here are available if included via @include.
// We can also attach them to a global object if preferred, but standalone functions are easier to use.
global.askGemini = askGemini;
global.checkGemini = checkGemini;
global.rephraseGemini = rephraseGemini;
global.analyzeImage = analyzeImage;
global.generateScene = generateScene;
global.parseCommand = parseCommand;
global.stopGeminiRetries = stopGeminiRetries;