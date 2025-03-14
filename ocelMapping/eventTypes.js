const setEventTypes = (jsonLog, ocel) => {
    const temporaryEvents = []

    jsonLog.forEach((log) => {
        // findValue(log, "activity", values)
        temporaryEvents.push({
            // relationships: log.storageState.map(variable => ({
            //     objectId: variable.variableId,
            //     qualifier: variable.variableName
            // })),
            id: log.transactionHash,
            relationships: [],
            timestamp: log.timestamp,
            name: log.activity || "",
            gasUsed: log.gasUsed,
            blockNumber: log.blockNumber,
            sender: log.sender,
            attributes: [{name: "gasUsed", type: "integer"}, {name: "blockNumber", type: "integer"}, {name: "sender", type: "string"}]
        })
    })

    let newEventTypes = [...ocel.eventTypes]

    const valuesSet = temporaryEvents.filter((value, index, self) => self.map(item => item.name).indexOf(value.name) === index)
    valuesSet.forEach(value => {
        newEventTypes.push({name: value.name, attributes: value.attributes})
    })

    const events = []
    temporaryEvents.forEach((value) => {
        events.push({
            id: value.id,
            type: value.name,
            time: value.timestamp,
            attributes: [{name: "gasUsed", value: value.gasUsed}, {name: "blockNumber", value: value.blockNumber}, {name: "sender", value: value.sender}],
            relationships: value.relationships
        })
    })

    return {
        eventTypes: newEventTypes,
        events: events
    }
}
module.exports={
    setEventTypes
}