// Convert solidity version from string to array of numbers
const axios = require('axios')
const solc = require('solc')
const https = require('https') // Aggiunto per l'agent HTTPS

const parseVersion = (versionString) => {
    return versionString
        .split('.')
        .map(part => parseInt(part))
}

// Compare two solidity versions and returns:
//  = 0 if are equal
//  > 0 if v1 is greater than v2
//  < 0 if v2 is greater than v2
const compareVersions = (v1, v2) => {
    if (v1.length !== v2.length) return v1.length - v2.length
    let equal = 0
    for (let i = 0; i < v1.length && equal === 0; i++) {
        equal = v1[i] - v2[i]
    }
    return equal
}

async function getAllSolidityVersions() {
    const url = "https://binaries.soliditylang.org/bin/list.json";
    let retries = 5;
    let delayMs = 3000;

    const httpsAgent = new https.Agent({ 
        keepAlive: true,
        rejectUnauthorized: false 
    });

    while (retries > 0) {
        try {
            const response = await axios.get(url, {
                httpsAgent,
                timeout: 15000,
                headers: { 'Connection': 'keep-alive' }
            });
            // Ritorna lo stesso esatto formato del tuo codice originale
            return {
                stringVersion: response.data.releases, 
                numberVersion: Object.keys(response.data.releases)
            };
        } catch (error) {
            console.error(`[Rete] Connessione a SolidityLang fallita. Ritento in ${delayMs/1000}s... (Tentativi rimasti: ${retries - 1})`);
            retries--;
            if (retries === 0) {
                throw new Error(`Impossibile contattare binaries.soliditylang.org: ${error.message}`);
            }
            await new Promise(r => setTimeout(r, delayMs)); 
        }
    }
}

function getRemoteVersion(version) {
    return new Promise((resolve, reject) => {
        solc.loadRemoteVersion(version, async (err, solcSnapshot) => {
            if (err) {
                console.error(err)
                reject(err)
            }

            resolve(solcSnapshot)
        })
    })
}

async function detectVersion(contractSource) {

    // Find all pragma solidity version occurences (=x.x.x, <x.x.x, <=x.x.x, >x.x.x, >=x.x.x, ^x.x.x, >x.x.x <y.y.y)
    const firstRegex = /pragma\s+solidity\s*([<>]?=?|\^)\s*(\d+\.\d+\.\d+)/g
    const secondRegex = /pragma\s+solidity\s*[[>]=?]*\s\d+\.\d+\.\d+\s*([<]=?)\s*(\d+\.\d+\.\d+)/g
    const matches = [...contractSource.matchAll(firstRegex), ...contractSource.matchAll(secondRegex)]

    // Find the highest common solidity version for compilation
    let highestVersion = null
    const availableVersions = await getAllSolidityVersions()
    for (const versionString of availableVersions.numberVersion) {
        const version = parseVersion(versionString)
        if (highestVersion == null || compareVersions(parseVersion(highestVersion), version) < 0) {
            let valid = true
            for (let i = 0; i < matches.length && valid; i++) {
                const sign = matches[i][1]
                const ver = parseVersion(matches[i][2])

                if (sign === '=' && compareVersions(version, ver) !== 0) valid = false
                else if (sign === '>' && compareVersions(version, ver) <= 0) valid = false
                else if (sign === '>=' && compareVersions(version, ver) < 0) valid = false
                else if (sign === '<' && compareVersions(version, ver) >= 0) valid = false
                else if (sign === '<=' && compareVersions(version, ver) > 0) valid = false
                else if (sign === '^' && (compareVersions(version, ver) < 0 || version[version.length - 2] > ver[ver.length - 2])) valid = false
            }
            if (valid) highestVersion = versionString
        }
    }

    return availableVersions.stringVersion[highestVersion]
}

module.exports = {
    detectVersion,
    getRemoteVersion
}