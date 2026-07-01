/**
 * Rileva quali colonne contengono array di oggetti.
 * @param {Object[]} records
 * @returns {{ nested: string[], flat: string[] }}
 */
function detectNestedColumns(records) {
  if (!records || records.length === 0) return { nested: [], flat: [] };

  const allKeys = new Set();
  for (const rec of records) {
    for (const k of Object.keys(rec)) allKeys.add(k);
  }

  const nested = [];
  const flat = [];

  for (const key of allKeys) {
    const isNested = records.some(
      (rec) => rec[key] !== null && rec[key] !== undefined && Array.isArray(rec[key])
    );
    if (isNested) nested.push(key);
    else flat.push(key);
  }

  return { nested, flat };
}

/**
 * Flattening di una singola colonna annidata.
 * Equivalente di pd.json_normalize con record_path=col, meta=metaFields, record_prefix="{col}_"
 *
 * ID deterministico: "{col}_{metaFields[0]_value}_{occorrenza_nel_gruppo}"
 * Replica formula Python: f"{col}_" + meta[0] + "_" + (groupby(meta[0]).cumcount() + 1)
 *
 * @param {Object[]} records
 * @param {string} col        colonna da espandere
 * @param {string[]} metaFields  campi piatti da propagare
 * @returns {Object[]}
 */
function normalizeColumn(records, col, metaFields) {
  const result = [];
  const groupCount = {};

  for (const rec of records) {
    const arr = rec[col];

    if (!arr || !Array.isArray(arr) || arr.length === 0) continue;

    const metaKey = metaFields.length > 0 ? metaFields[0] : null;
    const metaKeyValue = metaKey != null ? String(rec[metaKey] ?? '') : null;

    if (metaKeyValue != null) {
      groupCount[metaKeyValue] = groupCount[metaKeyValue] ?? 0;
    }

    for (const item of arr) {
      const row = {};

      // campi dall'array con prefisso
      if (item !== null && typeof item === 'object') {
        for (const [k, v] of Object.entries(item)) {
          row[`${col}_${k}`] = v;
        }
      } else {
        row[`${col}_value`] = item;
      }

      // meta fields propagati
      for (const mf of metaFields) {
        // non sovrascrivere se già esiste con prefisso
        if (!(mf in row)) {
          row[mf] = rec[mf] ?? null;
        }
      }

      // ID deterministico
      if (metaKeyValue != null) {
        groupCount[metaKeyValue]++;
        row[`${col}__id`] = `${col}_${metaKeyValue}_${groupCount[metaKeyValue]}`;
      } else {
        row[`${col}__id`] = `${col}_${result.length}`;
      }

      result.push(row);
    }
  }

  return result;
}

/**
 * Normalizza più colonne annidate e le concatena in un unico array.
 * Equivalente di normalize_data() in data_service.py.
 *
 * @param {Object[]} records
 * @param {number[]} colIndexes  indici delle colonne nested da normalizzare
 * @returns {{ normalized: Object[], nestedColumns: string[], flatColumns: string[] } | null}
 */
function normalizeData(records, colIndexes) {
  if (!records || records.length === 0) return null;

  const { nested, flat } = detectNestedColumns(records);

  if (nested.length === 0) return null;

  const colsToNormalize = colIndexes
    .filter((i) => i < nested.length)
    .map((i) => nested[i]);

  if (colsToNormalize.length === 0) return null;

  const allRows = [];

  for (const col of colsToNormalize) {
    const rows = normalizeColumn(records, col, flat);
    for (const r of rows) allRows.push(r);
  }

  if (allRows.length === 0) return null;

  return {
    normalized: allRows,
    nestedColumns: nested,
    flatColumns: flat,
  };
}

module.exports = { detectNestedColumns, normalizeColumn, normalizeData };
