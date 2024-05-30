// Convert solidity version from string to array of numbers
const axios = require('axios')
const solc = require('solc')

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
    const response = await axios.get("https://binaries.soliditylang.org/bin/list.json")
    return {stringVersion: response.data.releases, numberVersion: Object.keys(response.data.releases)}
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