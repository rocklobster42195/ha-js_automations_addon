# YouTube Skript: JS Automations für Home Assistant
**Folge 1:** Vorstellung & Key Features für **Serie:** Menschen, Tiere, Automationen (Spiel&Zeug)
**Dauer:** ca. 9-10 Minuten

---

## 0:00 - 0:45 | Intro: Der YAML-Frust
**(Bild: Nahaufnahme Gesicht / Screen mit 200 Zeilen kryptischem YAML-Code mit Jinja2-Templates)**

1. **Sprecher:** "Mal ehrlich: Wer von euch hat schon mal eine lange Zeit damit verbracht, in einem YAML-Template die richtige Einrückungen zu finden? Oder versucht, eine komplexe Logik mit verschachtelten `choose`-Bedingungen zu bauen, nur um am Ende frustriert aufzugeben? Oder etwas mit KI zu erzeugen?"

2. **Sprecher:** "Ich mag Home Assistant, aber für mich als Entwickler war YAML für Logik schon immer ein Kompromiss. Ich komme ursprünglich von ioBroker und dort gab es eine Sache, die ich schmerzlich vermisst habe: Den JavaScript-Adapter. Einfach Code schreiben, native Logik, volle Kontrolle – und das Ganze mit **nativem TypeScript-Support und einem eingebauten Compiler**. Genau deshalb habe ich **JS Automations** gebaut."

---

## 0:45 - 1:45 | Der Einstieg: Der Unified Creation Wizard
**(Bild: Screen-Recording: Klick auf das "+" Icon, der Wizard öffnet sich)**

4. **Sprecher:** "Der Einstieg soll so einfach wie möglich sein. Dafür gibt es den **Unified Creation Wizard**. Über das Plus-Icon könnt ihr sofort loslegen."

5. **Sprecher:** "Ihr habt drei Wege: Entweder ihr startet komplett neu – wahlweise in JavaScript oder direkt in **TypeScript**. Oder – und das ist mein Favorit – ihr importiert Code direkt via URL von GitHub oder Gist. Datei hochladen geht natürlich auch. Mit einem Klick legt das Add-on im Hintergrund alles an, inklusive der nötigen Metadaten wie Icons, Labels oder Bereichen. Das Addon versucht dabei die Namen mit den Label und Areas von Home Assistant zu matchen.
Die Skripte werden auf der in der Liste nach Label sortiert angezeigt. Blaues Icon heißt: Das Skript läuft, grau: es ist angehalten. Rotes Icon: Das Skript ist gecrashed. Aber keine Sorge: Die anderen Skripte, das Addon oder gar Home Assistant bleiben davon unberührt."

---

## 1:45 - 2:45 | Coden mit Köpfchen: Die schlaue IDE
**(Bild: Screen-Recording: Editor zeigt das Tippen von `ha.entity(` und wie sofort die Liste der echten HA-Entitäten erscheint. Danach werden Methoden wie .turn_on() vorgeschlagen.)**

6. **Sprecher:** "Wenn das Skript offen ist, merkt ihr sofort: Das hier ist kein einfaches Textfeld. Wir nutzen den Monaco-Editor – das ist der Kern von VS Code – und im Hintergrund arbeitet ein **vollwertiger TypeScript-Compiler**. Das Besondere: Das System kennt euer Home Assistant."

7. **Sprecher:** "Schaut euch das an: Wenn ich `ha.entity(` tippe, schlägt mir der Editor meine *echten* Entitäten vor. Kein Tippen von IDs aus dem Gedächtnis mehr. Ihr bekommt sofort Zugriff auf den Zustand, die Attribute und alle Methoden wie `.turn_on()` oder `.toggle()`. Das Add-on weiß genau, was eure Hardware kann und bietet euch nur das an, was auch wirklich funktioniert."

8. **Sprecher:** "Das ist der Vorteil einer integrierten Entwicklungsumgebung: Ihr schreibt Code nicht ins Blaue hinein, sondern interagiert direkt mit euren Geräten. Fehler werden markiert, noch bevor das Skript überhaupt das erste Mal gestartet wird."

**CODE-BEISPIEL (Einblendung):**
```javascript
// IntelliSense zeigt dir deine echten Entitäten:
const lampe = ha.entity('light.wohnzimmer');

// Und schlägt dir direkt die passenden Methoden vor:
if (lampe.state === 'off') {
    lampe.turn_on({ 
        brightness: 200, 
        transition: 2 
    });
}
```

---

## 2:45 - 3:45 | Reaktive Trigger mit ha.on
**(Bild: Code-Einblendung Beispiel 1)**

9. **Sprecher:** "Kommen wir zu den Details. Wer ioBroker kennt, wird `ha.on` lieben. Es ist das Herzstück für reaktive Automationen. Statt seitenweise YAML-Trigger zu definieren, schreibt ihr einfach eine Zeile Code."

10. **Sprecher:** "Das Ganze unterstützt Wildcards, Arrays oder sogar Regular Expressions. Ihr wollt auf alle Luftfeuchtigkeitssensoren im Haus reagieren? `ha.on('sensor.*_humidity', ...)` – fertig. Ihr könnt sogar Filter direkt mitgeben, damit das Skript nur triggert, wenn ein Wert zum Beispiel über eine Schwelle steigt."

**CODE-BEISPIEL (Einblendung):**
```javascript
// Reagiere nur, wenn die Temperatur über 25 Grad steigt
ha.on('sensor.wohnzimmer_temp', 'gt', 25, (e) => {
    ha.log(`Hitzewarnung! Es sind jetzt ${e.state}°C`);
    ha.entity('cover.markise').set_cover_position({ position: 0 });
});
```

## 4:30 - 5:30 | Die Native Integration & Reboot-Festigkeit
**(Bild: Screen-Recording der HA-Integrationsseite, man sieht die "JS Automation Integration")**

11. **Sprecher:** "Aber wir können nicht nur auf die Entitäten von Home Assitant zurückgreifen. Das Addon bringt eine eigene **native Integration** mit. Das ist eine echte Home Assistant Integration, die Hand in Hand mit dem Add-on arbeitet. Die Installation erfolgt über die Einstellungen."

12. **Sprecher:** "Über `ha.register` erstellt ihr Entitäten, die absolut 'reboot-fest' sind. Sie verschwinden nicht beim Neustart. Sie tauchen ganz normal in der HA-Geräteliste auf, ihr könnt sie Areas zuweisen, ihnen Icons geben und sie in jedem Dashboard nutzen. Es fühlt sich nicht an wie ein Hack, sondern wie ein nativer Teil eures Systems."

**CODE-BEISPIEL (Einblendung):**
```javascript
// Registriert einen echten Sensor in HA
ha.register('sensor.pool_status', {
    name: 'Pool Temperatur Status',
    icon: 'mdi:pool',
    unit: '°C'
});

// Wert aktualisieren - bleibt auch nach HA-Restart erhalten
ha.update('sensor.pool_status', 24.5);
```

---

## 4:45 - 5:45 | Bulk Actions mit ha.select
**(Bild: Code-Einblendung Beispiel 3)**

13. **Sprecher:** "Wenn ihr viele Geräte gleichzeitig steuern wollt, kommt `ha.select` ins Spiel."

14. **Sprecher:** "Ihr wählt eine Gruppe von Entitäten aus, filtert sie nach Zustand oder Attributen und führt dann eine Aktion aus. Ein riesiger Vorteil: Mit `.throttle()` könnt ihr Befehle zeitlich versetzt senden. Das schont zum Beispiel euer Zigbee- oder Homematic-Netzwerk, damit nicht 20 Lampen gleichzeitig angefunkt werden und Pakete verloren gehen."

**CODE-BEISPIEL (Einblendung):**
```javascript
// Alle eingeschalteten Lichter im Bereich 'Erdgeschoss' finden
// und mit 200ms Verzögerung nacheinander ausschalten
ha.select('light.*')
  .where(l => l.state === 'on' && l.attributes.area === 'Erdgeschoss')
  .throttle(200)
  .turn_off();
```

---

## 5:45 - 6:45 | Daten mit Gedächtnis: Persistence & Store Explorer
**(Bild: Code-Editor zeigt ha.persistent Beispiel, dann Wechsel zum Store Explorer)**

15. **Sprecher:** "Ein großes Problem bei komplexen Automationen ist oft: Wo landen meine Daten? Normalerweise sind Variablen in Skripten nach einem Neustart von Home Assistant oder dem Add-on einfach weg. Nicht hier."

16. **Sprecher:** "Mit `ha.persistent` könnt ihr Objekte erstellen , die absolut boot-fest sind. Nehmt zum Beispiel eine Endzeit für einen Bewässerungs-Timer. Dank Persistenz weiß euer Skript auch nach einem Stromausfall oder Update sofort: 'Ah, ich muss noch 10 Minuten wässern'. Das ist ideal für all die kleinen Status-Infos, die für eine eigene Home Assistant Entität viel zu 'klein' oder zu intern wären, aber trotzdem nicht verloren gehen dürfen."

17. **Sprecher:** "Gleichzeitig dient dieser Speicher als **reaktiver Shared Memory**. Wenn ein Skript einen Wert ändert, können andere Skripte sofort darauf reagieren. Ihr könnt also Logiken perfekt entkoppeln – ohne den Umweg über hunderte virtuelle Helfer-Entitäten in eurem HA-System."

18. **Sprecher:** "Damit ihr dabei nie den Überblick verliert, gibt es den **Store Explorer**. Das ist euer Röntgenblick in den Datenspeicher. Hier seht ihr live, welche Werte gerade aktiv sind. Ich habe hier zum Spaß mal einen Cocktail-Counter eingebaut. Jedes Mal, wenn ich den Button drücke, eskaliert der Wert im Hintergrund. Wie ihr seht, sind wir laut Store schon bei über 10.000 Litern – ha.persistent speichert das absolut effizient, egal wie absurd die Zahlen werden."

19. **Sprecher:** "Und noch ein wichtiges Sicherheits-Feature: **Credentials und API-Keys**. Markiert eine Variable einfach als 'Secret', dann wird sie in der UI maskiert. Euer Code nutzt sie ganz normal, aber sie tauchen nie versehentlich in einem Screenshot oder Stream auf. Das macht das Teilen von Skripten extrem sicher."

**CODE-BEISPIEL (Einblendung):**
```typescript
// Boot-feste Daten ohne HA-Entitäten-Chaos
const garden = ha.persistent('irrigation_logic', { 
    stopTime: 0, 
    lastRun: '2023-10-27' 
});

// REAKTION: Skript B wartet auf Änderungen im Store
ha.on('store.irrigation_logic', (newVal) => {
    ha.log(`Bewässerungs-Status hat sich geändert auf: ${newVal.lastRun}`);
});

// Datenaustausch: Skript A setzt das Secret, Skript B nutzt es
const keys = ha.persistent('api_secrets', { 
    weatherKey: 'SECRET_VALUE' // Im Store Explorer maskiert!
});
```

---

## 6:45 - 7:45 | Kein Copy-Paste: Global Libraries & NPM-Power
**(Bild: Editor zeigt Header mit @include und @npm. Wechsel zum Modal "Skript bearbeiten" -> Reiter "NPM Pakete")**

20. **Sprecher:** "Und hier wird es richtig mächtig: Eure Skripte können **NPM-Pakete** nutzen. Das definiert ihr entweder direkt im Header via `@npm` oder ganz bequem über das Einstellungs-Modal im Editor. Das Add-on kümmert sich dann automatisch um die Installation und das Management der Abhängigkeiten."

21. **Sprecher:** "Wenn man viele Skripte schreibt, merkt man schnell: Man braucht bestimmte Funktionen immer wieder. Statt Copy-Paste gibt es bei **Global Libraries**. Das sind passive Skripte für eure Helfer-Funktionen, die ihr über das `@include`-Tag im Header in eure Automationen einbindet. Das hält den Code sauber und wartbar. Einmal fixen, überall aktualisiert."

---

## 7:45 - 9:00 | Die Vision: Mini-Integrationen teilen statt Copy-Paste
**(Bild: Split-Screen: Links Wizard mit Gist-URL-Eingabe eines komplexen TS-Skripts, rechts das Ergebnis in HA)**

23. **Sprecher:** "Denkt das Ganze mal konsequent weiter: Wir bauen hier nicht nur Automationen. Wir bauen **Mini-Integrationen**. Durch die Kombination aus NPM-Modulen, TypeScript-Interfaces und der Bridge für native Entitäten könnt ihr in 15 Minuten eine Integration für jede exotische API der Welt bauen."

24. **Sprecher:** "Und das Beste: Kein Copy-Paste-Wahnsinn mehr. Ihr packt das Skript als **Gist auf GitHub** oder teilt es in der Community. Ein anderer Nutzer kopiert einfach die URL in den Wizard. Das Add-on erkennt die Abhängigkeiten, installiert via **NPM** automatisch Pakete wie `axios`, kompiliert den TypeScript-Code und registriert die Entitäten."

25. **Sprecher:** "JS Automations kann so zu einem dezentralen Marktplatz für Smart Home Lösungen – schnell, sicher und für jeden wartbar."

**CODE-BEISPIEL (Einblendung):**
```typescript
/**
 * @name 🍹 AI Cocktail Bar
 * @npm axios
 * @expose button
 * @typescript
 */
import axios from 'axios';

interface CocktailStats {
    total_drinks: number;
    last_order: { name: string; category: string } | null;
}

const stats = ha.persistent<CocktailStats>('beach_bar', { 
    total_drinks: 0, 
    last_order: null 
});

ha.on('button.jsa_cocktail_bar', async () => {
    try {
        const res = await axios.get('https://www.thecocktaildb.com/api/json/v1/1/random.php');
        const drink = res.data.drinks[0];

        stats.total_drinks++;
        stats.last_order = { name: drink.strDrink, category: drink.strCategory };

        ha.log(`🍸 Serviere einen ${drink.strDrink}!`);
    } catch (err) {
        ha.error("Fehler beim API-Call: " + err);
    }
});
```

---

## 9:00 - 9:45 | Fazit & Ausblick
**(Bild: Sprecher wieder in der Kamera / UI Übersicht)**

26. **Sprecher:** "JS Automations soll die Lücke für alle schließen, denen YAML zu starr und Node-RED zu unübersichtlich ist. Es bringt die Flexibilität von ioBroker direkt in das moderne Ökosystem von Home Assistant."

27. **Sprecher:** "Ein wichtiger Hinweis noch: Das Projekt ist aktuell offiziell noch im **Beta-Stadium**. Aber ich sage es euch wie es ist: Ich habe das Add-on selbst schon lange produktiv im Einsatz und es läuft bei mir so stabil, dass ich finde, es muss jetzt einfach raus an die Community. Rechnet aber damit, dass sicherlich noch der eine oder andere Bug auftaucht. Ich werde auch in Zukunft nicht davor zurückscheuen, Dinge zu optimieren oder zu ändern, nur um die Programmier-Erfahrung für uns alle so hoch wie möglich zu halten."

28. **Sprecher:** "Das war jetzt nur der Rundflug. In den nächsten Videos gehen wir so richtig ins Detail: Wir schauen uns an, wie ihr eigene native Entitäten registriert, komplexe Logiken sauber strukturiert und das volle Potenzial der API ausschöpft."

29. **Sprecher:** "Den link zum GitHub-Repository findet ihr in der Videobeschreibung. Probiert es aus, stellt eure Fragen in den Kommentaren!
Viel Spaß beim Automatisieren in Type- und JavaScript!"

---
*Notizen für den Schnitt:*
* *Bei Erwähnung von ioBroker: Kleines Logo einblenden.*
* *Beim Store Explorer: Den Effekt zeigen, wenn man auf das 'Auge' klickt, um Secrets zu maskieren.*
* *Beim Wizard: Kurz die Auswahl zwischen JS und TS zeigen.*
* *Code-Beispiele immer für ca. 5-8 Sekunden einblenden, während darüber gesprochen wird.*