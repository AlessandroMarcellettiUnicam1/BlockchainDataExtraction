const {
    handleCallTypeObjects,
    handleContractAddressObjects, handleEventNameObjects,
    handleInputNameObjects,
    handleSenderObjects,
    handleTxHashObjects, handleVariableNameObjects
} = require("./setObjectTypes.js");

const setObjectTypes = (obj, ocel,jsonLog) => {
    const newOcel = ocel

    switch (obj){
        case "contractAddress":
            const contractAddressObjectTypes = handleContractAddressObjects(jsonLog, newOcel)
            newOcel.objectTypes = contractAddressObjectTypes.objectTypes
            newOcel.objects = contractAddressObjectTypes.objects
            newOcel.events = contractAddressObjectTypes.events
            break;
        case "txHash":
            const txHashObjectTypes = handleTxHashObjects(jsonLog, newOcel)
            newOcel.objectTypes = txHashObjectTypes.objectTypes
            newOcel.objects = txHashObjectTypes.objects
            newOcel.events = txHashObjectTypes.events
            break;
        case "sender":
            const senderObjectTypes = handleSenderObjects(jsonLog, newOcel)
            newOcel.objectTypes = senderObjectTypes.objectTypes
            newOcel.objects = senderObjectTypes.objects
            newOcel.events = senderObjectTypes.events
            break;
        case "input":
            const inputNameObjectTypes = handleInputNameObjects(jsonLog, newOcel)
            newOcel.objectTypes = inputNameObjectTypes.objectTypes
            newOcel.objects = inputNameObjectTypes.objects
            newOcel.events = inputNameObjectTypes.events
            break;
        case "stateVariable":
            const variableNameObjectTypes = handleVariableNameObjects(jsonLog, newOcel)
            newOcel.objectTypes = variableNameObjectTypes.objectTypes
            newOcel.objects = variableNameObjectTypes.objects
            newOcel.events = variableNameObjectTypes.events
            break;
        case "event":  
            const eventObjectTypes = handleEventNameObjects(jsonLog, newOcel)
            newOcel.objectTypes = eventObjectTypes.objectTypes
            newOcel.objects = eventObjectTypes.objects
            newOcel.events = eventObjectTypes.events
            break;
        case "internalTx":
            const internalTxObjectType = handleCallTypeObjects(jsonLog, newOcel)
            newOcel.objectTypes = internalTxObjectType.objectTypes
            newOcel.objects = internalTxObjectType.objects
            newOcel.events = internalTxObjectType.events
            break;
        default:
            break;
    }
    return newOcel
}
module.exports={
setObjectTypes
}