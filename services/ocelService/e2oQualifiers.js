/**
 * Fase 3a — E2O Qualifier
 * Equivalente JS di DataService.set_e2o_relationship_qualifiers() da Log_to_ocel
 *
 * Applica qualificatori alle relazioni evento-oggetto dell'OCEL.
 * Comportamento replicato da Python/pm4py:
 * - qualifier_map: { "objectType|activity": "qualifierString" }
 * - Per ogni relazione: se (objectType, activity) è nel map → aggiorna qualifier
 * - Se non è nel map → mantiene il qualifier esistente
 * - Rimuove relazioni con qualifier null/undefined (mai quelle con stringa vuota "")
 *
 * @param {Object}   ocel           struttura OCEL (output di ocelBuilder.js)
 * @param {Object}   qualifierMap   { "type|activity": "qualifier" }
 * @returns {Object} ocel con relazioni aggiornate
 */
function applyE2OQualifiers(ocel, qualifierMap) {
  const lookup = new Map(
    Object.entries(qualifierMap).map(([k, v]) => [k, v])
  );

  const updatedRelations = [];
  for (const rel of ocel.relations) {
    const key = `${rel.objectType}|${rel.activity}`;
    const qualifier = lookup.has(key) ? lookup.get(key) : rel.qualifier;

    // Replica filtro pm4py: rimuove solo null/undefined, mantiene stringa vuota ""
    if (qualifier !== null && qualifier !== undefined) {
      updatedRelations.push({ ...rel, qualifier });
    }
  }

  // Aggiorna anche relationships dentro ogni evento
  const relByEvent = new Map();
  for (const rel of updatedRelations) {
    if (!relByEvent.has(rel.eventId)) relByEvent.set(rel.eventId, []);
    relByEvent.get(rel.eventId).push({ objectId: rel.objectId, qualifier: rel.qualifier });
  }

  const updatedEvents = ocel.events.map(ev => ({
    ...ev,
    relationships: relByEvent.get(ev.id) ?? [],
  }));

  return { ...ocel, events: updatedEvents, relations: updatedRelations };
}

/**
 * Restituisce le combinazioni (objectType, activity) presenti nelle relazioni OCEL.
 * Usato dal frontend per costruire la UI di selezione qualifier.
 *
 * @param {Object} ocel
 * @returns {{ objectType: string, activity: string }[]}
 */
function getE2OCombinations(ocel) {
  const seen = new Set();
  const result = [];
  for (const rel of ocel.relations) {
    const key = `${rel.objectType}|${rel.activity}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ objectType: rel.objectType, activity: rel.activity });
    }
  }
  return result;
}

module.exports = { applyE2OQualifiers, getE2OCombinations };
