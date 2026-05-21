import Dexie from 'dexie';

export const dexieDB = new Dexie('LiveComplianceDB');

dexieDB.version(1).stores({
    history: '++id, sessionId'
});