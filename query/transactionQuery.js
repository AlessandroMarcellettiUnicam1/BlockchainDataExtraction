import mongoose from "mongoose";

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

	const { contractAddress, dateFrom, dateTo, fromBlock, toBlock } = query;
	const queryFilter = {};

	if (dateFrom && dateTo) {
		queryFilter.timestamp = {
			$gte: new Date(dateFrom),
			$lte: new Date(dateTo),
		};
	}

  if (fromBlock && toBlock) {
		queryFilter.blockNumber = {
			$gte: Number(fromBlock),
			$lte: Number(toBlock),
		};
	}

	let results = [];

	try {
		if (contractAddress) {
			const collection = mongoose.connection.db.collection(contractAddress);
			let transactions = await collection
				.find(queryFilter, { projection: { _id: 0 } })
				.toArray();
			transactions = transactions.map((tx) => ({ ...tx, contractAddress }));
			results = transactions;
		} else {
			const collections = await mongoose.connection.db
				.listCollections()
				.toArray();
			for (const c of collections) {
				const collection = mongoose.connection.db.collection(c.name);
				let transactions = await collection
					.find(queryFilter, { projection: { _id: 0 } })
					.toArray();
				results = results.concat(transactions);
			}
		}

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
