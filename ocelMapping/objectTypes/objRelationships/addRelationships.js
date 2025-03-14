const addContractStateVariableRelationships = (ocelObjects, jsonLog) => {
    const objects = ocelObjects
    const variableObjects = objects.filter(obj => obj.id.includes("variable_"))
    const contractAddressObjects = objects.filter(obj => obj.type.includes("contractAddress"))
    if (contractAddressObjects.length > 0 && variableObjects.length > 0) {
        if (!contractAddressObjects.some(contractAddressObj => contractAddressObj.relationships?.some(relationship => relationship.qualifier.includes("contains")))) {
            objects.forEach(obj => {
                if (obj.type.includes("contractAddress")) {
                    const relationships = [...(obj.relationships || [])]
                    const storageState = jsonLog.find(log => log.transactionHash === obj.id.split("_")[1]).storageState
                    variableObjects.forEach(variableObj => {
                        if (storageState.some(variable => variableObj.id.replace("variable_", "").includes(variable.variableName))) {
                            relationships.push({
                                objectId: variableObj.id,
                                qualifier: "contains"
                            })
                        }
                    })
                    obj.relationships = relationships
                }
            })
        }

        if (!variableObjects.some(variableObj => variableObj.relationships?.some(relationship => relationship.qualifier.includes("storage of")))) {
            objects.forEach(obj => {
                if (obj.id.includes("variable_")) {
                    const relationships = [...(obj.relationships || [])]
                    jsonLog.forEach(log => {
                        if (log.storageState.some(variable => obj.id.replace("variable_", "").includes(variable.variableName))) {
                            const contractAddressToAdd = contractAddressObjects.find(contractAddressObj => contractAddressObj.id.split("_")[1] === log.transactionHash).id
                            relationships.push({
                                objectId: contractAddressToAdd,
                                qualifier: "storage of"
                            })
                        }
                    })
                    obj.relationships = relationships
                }
            })
        }
    }

    return objects
}

const addContractEventRelationships = (ocelObjects) => {
    const objects = ocelObjects
    const eventObjects = objects.filter(obj => obj.id.includes("event_"))
    const contractAddressObjects = objects.filter(obj => obj.type.includes("contractAddress"))

    if (contractAddressObjects.length > 0 && eventObjects.length > 0) {
        if (!contractAddressObjects.some(contractAddressObj => contractAddressObj.relationships?.some(relationship => relationship.qualifier.includes("defines")))) {
            objects.forEach(obj => {
                if (obj.type.includes("contractAddress")) {
                    const relationships = [...(obj.relationships || [])]
                    eventObjects.forEach(eventObj => {
                        if (eventObj.id.split("_")[2] === obj.id.split("_")[1]) {
                            relationships.push({
                                objectId: eventObj.id,
                                qualifier: "defines"
                            })
                        }
                    })
                    obj.relationships = relationships
                }
            })
        }

        if (!eventObjects.some(eventObj => eventObj.relationships?.some(relationship => relationship.qualifier.includes("member of")))) {
            objects.forEach(obj => {
                if (obj.id.includes("event_")) {
                    const relationships = [...(obj.relationships || [])]
                    const contractAddressToAdd = contractAddressObjects.find(contractAddressObj => contractAddressObj.id.split("_")[1] === obj.id.split("_")[2]).id
                    relationships.push({
                        objectId: contractAddressToAdd,
                        qualifier: "member of"
                    })
                    obj.relationships = relationships
                }
            })
        }
    }

    return objects
}

const addContractSenderRelationships = (ocelObjects) => {
    const objects = ocelObjects
    const senderObjects = objects.filter(obj => obj.type.includes("sender"))
    const contractAddressObjects = objects.filter(obj => obj.type.includes("contractAddress"))

    if (contractAddressObjects.length > 0 && senderObjects.length > 0) {
        if (!contractAddressObjects.some(contractAddressObj => contractAddressObj.relationships?.some(relationship => relationship.qualifier.includes("invoked by")))) {
            objects.forEach(obj => {
                if (obj.type.includes("contractAddress")) {
                    const relationships = [...(obj.relationships || [])]
                    const senderToAdd = senderObjects.find(senderObj => senderObj.id.split("_")[1] === obj.id.split("_")[1]).id
                    relationships.push({
                        objectId: senderToAdd,
                        qualifier: "invoked by"
                    })
                    obj.relationships = relationships
                }
            })
        }

        if (!senderObjects.some(senderObj => senderObj.relationships?.some(relationship => relationship.qualifier.includes("invokes")))) {
            objects.forEach(obj => {
                if (obj.type.includes("sender")) {
                    const relationships = [...(obj.relationships || [])]
                    const contractAddressToAdd = contractAddressObjects.find(contractAddressObj => contractAddressObj.id.split("_")[1] === obj.id.split("_")[1]).id
                    relationships.push({
                        objectId: contractAddressToAdd,
                        qualifier: "invokes"
                    })
                    obj.relationships = relationships
                }
            })
        }
    }

    return objects
}

export const addContractAddressRelationships = (ocelObjects, jsonLog) => {
    let objects = ocelObjects;

    if (objects.some(obj => obj.id.includes("variable_"))) {
        objects = addContractStateVariableRelationships(ocelObjects, jsonLog);
    }

    if (objects.some(obj => obj.id.includes("event"))) {
        objects = addContractEventRelationships(ocelObjects);
    }

    if (objects.some(obj => obj.type.includes("sender"))) {
        objects = addContractSenderRelationships(ocelObjects);
    }

    return objects
}

const addSenderInputRelationships = (ocelObjects) => {
    const objects = ocelObjects;
    const senderObjects = objects.filter(obj => obj.type.includes("sender"));
    const inputObjects = objects.filter(obj => obj.id.includes("inputName_"));
    if (senderObjects.length > 0 && inputObjects.length > 0) {
        if (!senderObjects.some(senderObj => senderObj.relationships?.some(relationship => relationship.qualifier.includes("passes")))) {
            objects.forEach(obj => {
                if (obj.type.includes("sender")) {
                    const relationships = [...(obj.relationships || [])]
                    inputObjects.forEach(inputObj => {
                        if (inputObj.id.split("_")[2] === obj.id.split("_")[1]) {
                            relationships.push({
                                objectId: inputObj.id,
                                qualifier: "passes"
                            })
                        }
                    })
                    obj.relationships = relationships
                }
            })
        }

        if (!inputObjects.some(inputObj => inputObj.relationships?.some(relationship => relationship.qualifier.includes("inserted by")))) {
            objects.forEach(obj => {
                if (obj.id.includes("inputName_")) {
                    const relationships = [...(obj.relationships || [])]
                    const senderToAdd = senderObjects.find(senderObj => senderObj.id.split("_")[1] === obj.id.split("_")[2]).id
                    relationships.push({
                        objectId: senderToAdd,
                        qualifier: "inserted by"
                    })
                    obj.relationships = relationships
                }
            })
        }
    }

    return objects
}

const addSenderTxHashRelationships = (ocelObjects) => {
    const objects = ocelObjects;
    const senderObjects = objects.filter(obj => obj.type.includes("sender"));
    const txHashObjects = objects.filter(obj => obj.type.includes("transactionHash"));
    if (senderObjects.length > 0 && txHashObjects.length > 0) {
        if (!senderObjects.some(senderObj => senderObj.relationships?.some(relationship => relationship.qualifier.includes("generates")))) {
            objects.forEach(obj => {
                if (obj.type.includes("sender")) {
                    const relationships = [...(obj.relationships || [])]
                    const txHashToAdd = txHashObjects.find(txHashObj => txHashObj.id === obj.id.split("_")[1]).id
                    relationships.push({
                        objectId: txHashToAdd,
                        qualifier: "generates"
                    })
                    obj.relationships = relationships
                }
            })
        }

        if (!txHashObjects.some(txHashObj => txHashObj.relationships?.some(relationship => relationship.qualifier.includes("created by")))) {
            objects.forEach(obj => {
                if (obj.type.includes("transactionHash")) {
                    const relationships = [...(obj.relationships || [])]
                    const senderToAdd = senderObjects.find(senderObj => senderObj.id.split("_")[1] === obj.id).id
                    relationships.push({
                        objectId: senderToAdd,
                        qualifier: "created by"
                    })
                    obj.relationships = relationships
                }
            })
        }
    }

    return objects
}

export const addSenderRelationships = (ocelObjects) => {
    let objects = ocelObjects;

    if (objects.some(obj => obj.type.includes("contractAddress"))) {
        objects = addContractSenderRelationships(objects);
    }

    if (objects.some(obj => obj.id.includes("inputName"))) {
        objects = addSenderInputRelationships(objects);
    }

    if (objects.some(obj => obj.type.includes("transactionHash"))) {
        objects = addSenderTxHashRelationships(objects);
    }

    return objects
}

const addTxHashInternalTxRelationships = (ocelObjects) => {
    const objects = ocelObjects;
    const txHashObjects = objects.filter(obj => obj.type.includes("transactionHash"));
    const internalTxObjects = objects.filter(obj => obj.id.includes("internalTransaction_"));
    if (txHashObjects.length > 0 && internalTxObjects.length > 0) {
        if (!txHashObjects.some(txHashObj => txHashObj.relationships?.some(relationship => relationship.qualifier.includes("triggers")))) {
            objects.forEach(obj => {
                if (obj.type.includes("transactionHash")) {
                    const relationships = [...(obj.relationships || [])]
                    internalTxObjects.forEach(internalTxObj => {
                        if (internalTxObj.id.split("_")[2] === obj.id) {
                            relationships.push({
                                objectId: internalTxObj.id,
                                qualifier: "triggers"
                            })
                        }
                    })
                    obj.relationships = relationships
                }
            })
        }

        if (!internalTxObjects.some(internalTxObj => internalTxObj.relationships?.some(relationship => relationship.qualifier.includes("triggered in")))) {
            objects.forEach(obj => {
                if (obj.id.includes("internalTransaction_")) {
                    const relationships = [...(obj.relationships || [])]
                    const txHashToAdd = txHashObjects.find(txHashObj => txHashObj.id === obj.id.split("_")[2]).id
                    relationships.push({
                        objectId: txHashToAdd,
                        qualifier: "triggered in"
                    })
                    obj.relationships = relationships
                }
            })
        }
    }

    return objects
}

export const addTxHashRelationships = (ocelObjects) => {
    let objects = ocelObjects;

    if (objects.some(obj => obj.type.includes("sender"))) {
        objects = addSenderTxHashRelationships(objects);
    }

    if (objects.some(obj => obj.id.includes("internalTransaction_"))) {
        objects = addTxHashInternalTxRelationships(objects);
    }

    return objects
}

export const addInputNameRelationships = (ocelObjects) => {
    let objects = ocelObjects;
    if (objects.some(obj => obj.type.includes("sender"))) {
        objects = addSenderInputRelationships(objects);
    }

    return objects
}

export const addVariableRelationships = (ocelObjects, jsonLog) => {
    let objects = ocelObjects

    if (objects.some(obj => obj.type.includes("contractAddress"))) {
        objects = addContractStateVariableRelationships(objects, jsonLog);
    }

    return objects
}

export const addEventRelationships = (ocelObjects) => {
    let objects = ocelObjects

    if (objects.some(obj => obj.type.includes("contractAddress"))) {
        objects = addContractEventRelationships(objects);
    }

    return objects
}

export const addInternalTxRelationships = (ocelObjects) => {
    let objects = ocelObjects

    if (objects.some(obj => obj.type.includes("transactionHash"))) {
        objects = addTxHashInternalTxRelationships(objects);
    }

    return objects
}