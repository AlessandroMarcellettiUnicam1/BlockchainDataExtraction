/**
 * Fase 5 — OCEL Exporter
 * Serializza la struttura OCEL 2.0 interna nei formati standard di output.
 *
 * toOcel2Json  → OCEL 2.0 JSON ufficiale (.json / .jsonocel)
 * toFlatCsv    → CSV piatto evento × relazione E2O (.csv)
 */

/**
 * Converte la struttura interna in OCEL 2.0 JSON standard.
 *
 * Differenze rispetto alla struttura interna:
 * - il flat `relations` viene omesso (è solo una cache interna)
 * - le relazioni O2O (ocel.o2o) vengono aggiunte dentro ogni oggetto
 *   come array `relationships: [{ objectId, qualifier }]`
 */
function toOcel2Json(ocel) {
  // Indicizza le coppie O2O per oid → lista di {objectId, qualifier}
  const o2oByOid = {};
  for (const pair of (ocel.o2o ?? [])) {
    if (!o2oByOid[pair.oid])   o2oByOid[pair.oid]   = [];
    if (!o2oByOid[pair.oid_2]) o2oByOid[pair.oid_2] = [];
    o2oByOid[pair.oid].push({   objectId: pair.oid_2, qualifier: pair.qualifier });
    o2oByOid[pair.oid_2].push({ objectId: pair.oid,   qualifier: pair.qualifier });
  }

  const objects = ocel.objects.map(obj => ({
    id:            obj.id,
    type:          obj.type,
    attributes:    obj.attributes   ?? [],
    relationships: o2oByOid[obj.id] ?? [],
  }));

  return {
    objectTypes: ocel.objectTypes,
    eventTypes:  ocel.eventTypes,
    objects,
    events: ocel.events,
  };
}

/**
 * Converte la struttura OCEL in CSV piatto.
 * Una riga per ogni relazione E2O (evento × oggetto collegato).
 * Colonne: event_id, event_type, event_time, object_id, object_type, qualifier,
 *          [un campo per ogni attributo evento trovato nel log]
 *
 * I valori con virgole o doppi apici vengono opportunamente escaped (RFC 4180).
 */
function toFlatCsv(ocel) {
  if (!ocel.relations || ocel.relations.length === 0) {
    return 'event_id,event_type,event_time,object_id,object_type,qualifier\n';
  }

  // Union di tutti i nomi di attributi evento (per costruire header uniforme)
  const attrNames = [...new Set(
    ocel.events.flatMap(e => (e.attributes ?? []).map(a => a.name))
  )];

  // Lookup rapido eventId → evento
  const eventById = {};
  for (const ev of ocel.events) eventById[ev.id] = ev;

  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

  const header = ['event_id', 'event_type', 'event_time', 'object_id', 'object_type', 'qualifier', ...attrNames]
    .join(',');

  const rows = ocel.relations.map(rel => {
    const ev = eventById[rel.eventId] ?? {};
    const attrMap = {};
    for (const a of (ev.attributes ?? [])) attrMap[a.name] = a.value;

    return [
      rel.eventId,
      rel.activity,
      ev.time ?? '',
      rel.objectId,
      rel.objectType,
      rel.qualifier ?? '',
      ...attrNames.map(n => attrMap[n] ?? ''),
    ].map(escape).join(',');
  });

  return [header, ...rows].join('\n');
}

module.exports = { toOcel2Json, toFlatCsv };
