/**
 * Fase 3b — O2O Enrichment (Object Interaction Graph)
 * Equivalente JS di pm4py.ocel_o2o_enrichment(included_graphs=["object_interaction_graph"])
 *
 * Per ogni evento, genera tutte le coppie ordinate (oid, oid_2) di oggetti co-occorrenti.
 * Comportamento replicato da pm4py:
 * - Due oggetti sono "interagenti" se appaiono insieme nello stesso evento
 * - Le coppie sono ordinate: (A, B) e (B, A) sono due relazioni distinte
 * - Il qualifier viene inizializzato a null (verrà impostato da o2oQualifiers.js)
 * - Coppie duplicate (stesso evento, stessa coppia) vengono deduplicate
 *
 * @param {Object} ocel   struttura OCEL (output di ocelBuilder.js o e2oQualifiers.js)
 * @returns {Object}      ocel arricchito con campo o2o: { oid, oid_2, qualifier }[]
 */
function buildO2OEnrichment(ocel) {
  // Raggruppa objectId per eventId
  const eventObjects = new Map();
  for (const rel of ocel.relations) {
    if (!eventObjects.has(rel.eventId)) eventObjects.set(rel.eventId, []);
    eventObjects.get(rel.eventId).push(rel.objectId);
  }

  const seen = new Set();
  const o2o = [];

  for (const [, objectIds] of eventObjects) {
    if (objectIds.length < 2) continue;

    // Genera tutte le coppie ordinate (i, j) con i ≠ j
    for (let i = 0; i < objectIds.length; i++) {
      for (let j = 0; j < objectIds.length; j++) {
        if (i === j) continue;
        const oid  = objectIds[i];
        const oid2 = objectIds[j];
        const key  = `${oid}||${oid2}`;
        if (seen.has(key)) continue;
        seen.add(key);
        o2o.push({ oid, oid_2: oid2, qualifier: null });
      }
    }
  }

  return { ...ocel, o2o };
}

/**
 * Restituisce le coppie (oid, oid_2) presenti nell'O2O enrichment.
 * Usato dal frontend per costruire la UI di selezione qualifier.
 *
 * @param {Object} ocel   con campo o2o
 * @returns {{ oid: string, oid_2: string }[]}
 */
function getO2OPairs(ocel) {
  if (!ocel.o2o) return [];
  return ocel.o2o.map(({ oid, oid_2 }) => ({ oid, oid_2 }));
}

module.exports = { buildO2OEnrichment, getO2OPairs };
