async function filterOccurrences(transactions, minOccurrences) {
    const activityMap = {}
    transactions.forEach((tx) => {
        const activity = tx.activity || tx.functionName || "unknown";
        if (!activityMap[activity]) {
            activityMap[activity] = {
                contract: tx.contractAddress,
                activity,
                count: 0,
            };
        }
        activityMap[activity].count++;
    });
    for(const key in activityMap) {
        if(activityMap[key].count<minOccurrences){
            delete activityMap[key];
        }
    }
    const keys = Object.keys(activityMap);
    return transactions.filter((tx)=>{
        const activity = tx.activity || tx.functionName || "unknown";
        return keys.includes(activity);
    });
}
module.exports={
    filterOccurrences
}