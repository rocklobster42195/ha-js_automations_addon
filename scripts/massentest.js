/**
 * @name Massen-Steuerung
 * @icon mdi:layers-outline
 */

// 1. Zähle alle Sensoren, die "battery" im Namen haben
const batteries = ha.select('sensor.*_battery');
ha.log(`Ich habe ${batteries.count} Batterien gefunden.`);


// 3. Eigene Logik für jeden Treffer
ha.select('sensor.*_battery')
  .each(s => {
      ha.log(`Raum-Status: ${s.entity_id} ist ${s.state}`);
  });