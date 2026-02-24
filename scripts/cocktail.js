/**
 * @name Cocktail & Sonne
 * @icon mdi:glass-cocktail
 * @description Holt Rezepte und berechnet goldene Stunde.
 * @area 
 * @label 
 * @loglevel info
 * @npm suncalc,iban
 */


// suncalc wird automatisch installiert
const suncalc = require('suncalc');
const iban=require('iban');
// axios nutzen wir global (schon im Add-on enthalten)

ha.log("🍹 Kombi-Skript gestartet...");

async function run() {
    try {
        // 1. Ein Rezept holen (via globalem axios)
        const res = await axios.get('https://www.thecocktaildb.com/api/json/v1/1/random.php');
        const drink = res.data.drinks[0];
        ha.log(`Empfehlung: ${drink.strDrink}`);

        // 2. Sonnenstand berechnen (via @npm suncalc)
        // Wir nutzen beispielhaft die Koordinaten von Berlin (könnte man auch aus HA ziehen)
        const times = suncalc.getTimes(new Date(), 52.52, 13.40);
        const sunsetStr = times.sunset.toLocaleTimeString();
        
        ha.log(`🌇 Sonnenuntergang heute ist um ${sunsetStr}`);

        const now = new Date();
        if (now > times.sunset) {
            ha.log("🍸 Die Sonne ist weg. Zeit für einen Drink!");
        } else {
            ha.log("☀️ Noch ist es hell. Bereite den Shaker schon mal vor.");
        }

        // 3. Status in HA setzen
        ha.updateState('sensor.cocktail_zeit', drink.strDrink, {
            friendly_name: 'Cocktail & Sonne',
            sunset: sunsetStr,
            is_cocktail_time: now > times.sunset
        });

    } catch (err) {
        ha.error("Fehler im Skript: " + err.message);
    }
}

ha.onStop(() => {
    // cleanup code
});

run();