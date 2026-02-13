/**
 * @name Store Reader
 */

async function run() {
    ha.log("Lese Wert aus Store...");
    
    // WICHTIG: Das await hier ist entscheidend!
    const temp = await ha.store.get('outdoor_temp');
    
    if (temp !== null) {
        ha.log(`Erfolg! Der Wert ist: ${temp}`);
    } else {
        ha.error("Wert konnte nicht gelesen werden.");
    }

    ha.log("Skript fertig.");
}

run();