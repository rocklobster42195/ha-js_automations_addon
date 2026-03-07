/**
 * @name Gemini Wetter Demo
 * @description Fragt Gemini basierend auf dem Wetter, ob ein Regenschirm nötig ist.
 * @include gemini_toolbox.js
 * @icon mdi:weather-pouring
 * @loglevel info
 */

async function main() {
    // Die Wetter-Entität in deinem Home Assistant (bitte anpassen falls nötig)
    const weatherEntity = 'weather.openweathermap';

    ha.log("Frage Gemini nach der Regenschirm-Situation...");

    // 1. Frage stellen mit Kontext (Wetter-Entität)
    // askGemini(Prompt, Entitäten-Array oder String)
    const factualAnswer = await askGemini(
        "Soll ich heute einen Regenschirm mitnehmen? Antworte kurz und prägnant.", 
        weatherEntity
    );
    
    ha.log(`Faktische Antwort: ${factualAnswer}`);

    // 2. Antwort umformulieren lassen
    // rephraseGemini(Text, Stil)
    const funAnswer = await rephraseGemini(factualAnswer, "Pirate");
    
    ha.log(`Kreative Antwort: ${funAnswer}`);
}

main();