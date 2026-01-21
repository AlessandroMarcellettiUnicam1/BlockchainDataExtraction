const mongoose = require("mongoose");
const getAllTransactions=require( "./flattenTransaction.js");
const {filterOccurrences} =require("./filter.js")

// Cache setup
const cache = new Map();
const CACHE_TTL = 5000; // 5 seconds

async function fetchTransactions(query) {
	const cacheKey = JSON.stringify(query);

	// Return cached result if available
	if (cache.has(cacheKey)) {
		const { timestamp, data } = cache.get(cacheKey);
		if (Date.now() - timestamp < CACHE_TTL) return data;
	}

	const { contractAddress, dateFrom, dateTo, fromBlock, toBlock, internalTxs, minOccurrences, txHash } = query;
	const queryFilter = {};

	if (contractAddress && Array.isArray(contractAddress) && contractAddress.length > 0) {
		queryFilter.contractAddress = {$in: contractAddress};
	}

	if (dateFrom) {
		queryFilter.timestamp = {
			...queryFilter.timestamp,
			$gte: new Date(dateFrom),
		};
	}

	if (dateTo) {
		queryFilter.timestamp = {
			...queryFilter.timestamp,
			$lte: new Date(dateTo),
		};
	}

	if (fromBlock) {
		queryFilter.blockNumber = {
			...queryFilter.blockNumber,
			$gte: Number(fromBlock),
		};
	}

	if (toBlock) {
		queryFilter.blockNumber = {
			...queryFilter.blockNumber,
			$lte: Number(toBlock),
		};
	}
    if(txHash){
        queryFilter.transactionHash = txHash;
    }

	let results = [];

	try {
		// Always search across all collections
		const collections = await mongoose.connection.db
			.listCollections()
			.toArray();

		for (const c of collections) {
			const collection = mongoose.connection.db.collection(c.name);
			const transactions = await collection
				.find(queryFilter, { projection: { _id: 0 } })
				.toArray();
			results = results.concat(transactions);
		}

        if(internalTxs && internalTxs!=="public") {
            results = await getAllTransactions(results);

            if(internalTxs==="internal")
                results = results.filter((tx)=>tx.hasOwnProperty("depth"))
                    .map((tx)=>({
                    ...tx,
                    transactionHash: tx.transactionHash.split("-")[0],
                        functionName: tx.activity
                }));
        }

        if(minOccurrences)
            results = await filterOccurrences(results, minOccurrences);


		const validTransactions = results.filter(
			(tx) => tx && Object.keys(tx).length > 0 && tx.gasUsed !== undefined
		);

		// Update cache
		cache.set(cacheKey, {
			timestamp: Date.now(),
			data: validTransactions,
		});

		return validTransactions;
	} catch (error) {
		cache.delete(cacheKey);
		throw error;
	}
}
module.exports={
	fetchTransactions
}