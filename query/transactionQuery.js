import mongoose from "mongoose";
import {getAllTransactions} from "./flattenTransaction.js"
import {filterOccurrences} from "./filter.js"

// Cache setup
const cache = new Map();
const CACHE_TTL = 5000; // 5 seconds

export async function fetchTransactions(query) {
	const cacheKey = JSON.stringify(query);

	// Return cached result if available
	if (cache.has(cacheKey)) {
		const { timestamp, data } = cache.get(cacheKey);
		if (Date.now() - timestamp < CACHE_TTL) return data;
	}

	const { contractAddress, dateFrom, dateTo, fromBlock, toBlock, internalTxs, minOccurrences } = query;
	const queryFilter = {};

	if (contractAddress) {
		queryFilter.contractAddress = contractAddress;
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

        if(internalTxs)
            results = await getAllTransactions(results);

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
