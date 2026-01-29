function findPathRecursive(node, parts, startIndex, results) {
    if (startIndex >= parts.length) {
        results.push(node);
        return;
    }

    if (node === null || typeof node !== "object") return;

    const currentKey = parts[startIndex];

    if (Array.isArray(node)) {
        node.forEach(item => {
            findPathRecursive(item, parts, startIndex, results);
        });
        return;
    }

    for (const [k, v] of Object.entries(node)) {
        if (k === currentKey) {
            findPathRecursive(v, parts, startIndex + 1, results);
        }
        if (startIndex < parts.length - 1) {
            findPathRecursive(v, parts, startIndex, results);
        }
    }
}

function queryJsonPath(tx, path) {
    const parts = path.split(".");
    const results = [];
    findPathRecursive(tx, parts, 0, results);
    return results;
}
module.exports={
    queryJsonPath
}