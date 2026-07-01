/**
 * Fase 2 — OCEL 2.0 Builder
 * Equivalente JS di pm4py.convert.convert_log_to_ocel() da Log_to_ocel (data_service.py)
 *
 * Input:  righe normalizzate (output di normalizer.js) + parametri OCEL scelti dall'utente
 * Output: struttura OCEL 2.0 in-memory (events, objects, relations, eventTypes, objectTypes)
 *
 * Comportamento replicato da pm4py:
 * - objectTypes sono colonne VALORE (es. "inputs_inputValue"), non colonne __id
 * - object ID = valore raw della colonna (es. indirizzo Ethereum "0x152649...")
 * - oggetti deduplicati per valore → stessa address in 100 tx = 1 oggetto
 * - righe con valore null/undefined/number nella colonna objectType → nessuna relazione
 *   (replica il comportamento pandas/pm4py che droppa NaN dagli objectType)
 */

function inferType(value) {
  if (value === null || value === undefined) return 'string';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'float';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

/**
 * Verifica se un valore è un object ID valido.
 * Replica il filtro pm4py: skippa null, undefined e numeri puri
 * (gli amount uint256 vengono convertiti in NaN da pandas → scartati).
 */
function isValidObjectId(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return false;   // amount uint256 → scartato come pm4py
  if (typeof value === 'string' && value.trim() === '') return false;
  return true;
}

/**
 * Costruisce la struttura OCEL 2.0 a partire dalle righe normalizzate.
 *
 * @param {Object[]} normalizedRows      output di normalizeData().normalized
 * @param {Object}   params
 * @param {string}   params.activity     nome colonna attività (es. "activity")
 * @param {string}   params.timestamp    nome colonna timestamp (es. "timestamp")
 * @param {string[]} params.objectTypes  colonne VALORE da usare come objectType (es. ["inputs_inputValue"])
 * @param {string[]} params.eventAttrs   colonne aggiuntive come attributi evento
 * @param {Object}   params.objectAttrs  { [colonna]: string[] } — attributi aggiuntivi per tipo oggetto
 */
function buildOcel(normalizedRows, params) {
  const {
    activity: activityCol,
    timestamp: timestampCol,
    objectTypes: objectTypeCols = [],
    eventAttrs: eventAttrCols = [],
    objectAttrs: objectAttrMap = {},
  } = params;

  const eventsMap  = new Map();
  const objectsMap = new Map(); // objectId → object
  const relations  = [];

  let eventCounter = 0;

  for (const row of normalizedRows) {
    const activity  = row[activityCol]  ?? null;
    const timestamp = row[timestampCol] ?? null;

    if (!activity || !timestamp) continue;

    const eventId = String(eventCounter++);

    const eventAttributes = eventAttrCols
      .filter(col => row[col] !== undefined && row[col] !== null)
      .map(col => ({ name: col, value: row[col], type: inferType(row[col]) }));

    const eventRelationships = [];

    for (const objTypeCol of objectTypeCols) {
      const objectId = row[objTypeCol];

      // Replica pm4py: salta righe senza un object ID stringa valido
      if (!isValidObjectId(objectId)) continue;

      const objectIdStr = String(objectId);

      // Tipo oggetto = nome colonna (come pm4py usa il nome della colonna come ocel:type)
      const objectType = objTypeCol;

      if (!objectsMap.has(objectIdStr)) {
        const attrCols = objectAttrMap[objTypeCol] ?? [];
        const objectAttributes = attrCols
          .filter(col => row[col] !== undefined && row[col] !== null)
          .map(col => ({
            name: col,
            value: row[col],
            type: inferType(row[col]),
            time: timestamp,
          }));

        objectsMap.set(objectIdStr, {
          id: objectIdStr,
          type: objectType,
          attributes: objectAttributes,
        });
      }

      const relation = {
        eventId,
        objectId: objectIdStr,
        objectType,
        activity,
        qualifier: '',   // pm4py usa stringa vuota "" come default (non null)
      };
      relations.push(relation);
      eventRelationships.push({ objectId: objectIdStr, qualifier: '' });
    }

    eventsMap.set(eventId, {
      id: eventId,
      type: activity,
      time: timestamp,
      attributes: eventAttributes,
      relationships: eventRelationships,
    });
  }

  const events  = Array.from(eventsMap.values());
  const objects = Array.from(objectsMap.values());

  const activityNames = [...new Set(events.map(e => e.type))];
  const eventTypes = activityNames.map(name => {
    const sample = events.find(e => e.type === name);
    return {
      name,
      attributes: sample ? sample.attributes.map(a => ({ name: a.name, type: a.type })) : [],
    };
  });

  const typeNames = [...new Set(objects.map(o => o.type))];
  const objectTypes = typeNames.map(type => {
    const sample = objects.find(o => o.type === type);
    return {
      name: type,
      attributes: sample ? sample.attributes.map(a => ({ name: a.name, type: a.type })) : [],
    };
  });

  return { eventTypes, objectTypes, events, objects, relations };
}

function getOcelStats(ocel) {
  return {
    events:      ocel.events.length,
    objects:     ocel.objects.length,
    relations:   ocel.relations.length,
    eventTypes:  ocel.eventTypes.map(t => t.name),
    objectTypes: ocel.objectTypes.map(t => t.name),
  };
}

module.exports = { buildOcel, getOcelStats };
