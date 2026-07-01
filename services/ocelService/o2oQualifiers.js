/**
 * Fase 3c — O2O Qualifier
 * Equivalente JS di DataService.set_o2o_relationship_qualifiers() da Log_to_ocel
 *
 * Applica qualificatori alle relazioni oggetto-oggetto dell'OCEL.
 * Comportamento replicato da Python/pm4py:
 * - qualifier_map: { "oid|oid_2": "qualifierString" }
 * - Per ogni relazione O2O: se (oid, oid_2) è nel map → aggiorna qualifier
 * - Rimuove relazioni con qualifier null/undefined OPPURE stringa vuota ""
 *   (a differenza di E2O, qui pm4py rimuove anche le stringhe vuote)
 *
 * @param {Object}   ocel           struttura OCEL con campo o2o (output di o2oEnrichment.js)
 * @param {Object}   qualifierMap   { "oid|oid_2": "qualifier" }
 * @returns {Object} ocel con o2o aggiornato
 */
function applyO2OQualifiers(ocel, qualifierMap) {
  if (!ocel.o2o) throw new Error('ocel.o2o mancante: eseguire prima o2oEnrichment');

  const lookup = new Map(
    Object.entries(qualifierMap).map(([k, v]) => [k, v])
  );

  const updatedO2O = [];
  for (const rel of ocel.o2o) {
    const key = `${rel.oid}|${rel.oid_2}`;
    const qualifier = lookup.has(key) ? lookup.get(key) : rel.qualifier;

    // Replica filtro pm4py: rimuove null/undefined E stringhe vuote
    if (qualifier !== null && qualifier !== undefined && qualifier !== '') {
      updatedO2O.push({ ...rel, qualifier });
    }
  }

  return { ...ocel, o2o: updatedO2O };
}

module.exports = { applyO2OQualifiers };
