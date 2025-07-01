import mongoose from "mongoose";
import { fetchTransactions } from "./transactionQuery.js";

export async function getGasUsage(query) {
	try {
		const transactions = await fetchTransactions(query);
		const activityGasMap = {};

		transactions.forEach((tx) => {
			const activity = tx.activity || tx.functionName || "unknown";
			if (!activityGasMap[activity]) {
				activityGasMap[activity] = {
					contract: tx.contractAddress,
					activity,
					gasUsed: 0,
					timestamp: tx.timestamp,
					count: 0,
				};
			}
			activityGasMap[activity].gasUsed += Number(tx.gasUsed) || 0;
			activityGasMap[activity].count += 1;
		});

		return Object.values(activityGasMap);
	} catch (error) {
		console.error("Error fetching gas usage:", error);
		throw new Error(error.message);
	}
}

export async function getActivityData(query) {
	try {
		const transactions = await fetchTransactions(query);
		const activityStats = {};

		transactions.forEach((tx) => {
			const activity = tx.activity || tx.functionName || "unknown";
			if (!activityStats[activity]) {
				activityStats[activity] = {
					contract: tx.contractAddress,
					activity,
					count: 0,
				};
			}
			activityStats[activity].count += 1;
		});

		return Object.values(activityStats);
	} catch (error) {
		console.error("Error fetching activity data:", error);
		throw new Error(error.message);
	}
}
export async function getMostActiveSenders(query) {
	try {
		const transactions = await fetchTransactions(query);
		const mostActiveSenders = {};

		transactions.forEach((tx) => {
			if (!mostActiveSenders[tx.sender]) {
				mostActiveSenders[tx.sender] = {
					sender: tx.sender,
					numberOfTransactions: 0,
					totalGasUsed: 0,
				};
			}
			mostActiveSenders[tx.sender].numberOfTransactions += 1;
			mostActiveSenders[tx.sender].totalGasUsed += Number(tx.gasUsed) || 0;
		});

		// Calculate average gas used for each sender
		Object.values(mostActiveSenders).forEach((sender) => {
			sender.averageGasUsed = Math.round(
				sender.totalGasUsed / sender.numberOfTransactions
			);
			// Remove totalGasUsed as it's not needed in the final result
			delete sender.totalGasUsed;
		});

		return Object.values(mostActiveSenders);
	} catch (error) {
		console.error("Error fetching activity data:", error);
		throw new Error(error.message);
	}
}
export async function getTimeData(query) {
	try {
		const transactions = await fetchTransactions(query);
		const timeData = {};

		transactions.forEach((tx) => {
			const date = new Date(tx.timestamp).toISOString();

			if (!timeData[date]) {
				timeData[date] = {
					date,
					gasUsed: tx.gasUsed ? Number(tx.gasUsed) : 0,
					transactionCount: 0,
				};
			}

			timeData[date].gasUsed += Number(tx.gasUsed) || 0;
			timeData[date].transactionCount += 1;
		});

		// Sort by date
		const sortedData = Object.values(timeData).sort(
			(a, b) => new Date(a.date) - new Date(b.date)
		);

		return sortedData.slice(0, 500);
	} catch (error) {
		console.error("Error fetching time-based gas usage:", error);
		throw new Error(error.message);
	}
}

export async function getInputsData(query) {
	try {
		const transactions = await fetchTransactions(query);

		const formattedTransactions = transactions.map((tx) => {
			return {
				contractAddress: tx.contractAddress,
				activity: tx.activity || tx.functionName || "unknown",
				timestamp: tx.timestamp,
				inputName: tx.inputs[0]?.inputName || "unknown",
				inputType: tx.inputs[0]?.type || "unknown",
				inputValue: tx.inputs[0]?.inputValue || "unknown",
			};
		});

		return formattedTransactions;
	} catch (error) {
		console.error("Error fetching inputs data:", error);
		throw new Error(error.message);
	}
}

export async function getEventsData(query) {
	try {
		const transactions = await fetchTransactions(query);
		const eventsData = {};

		transactions.forEach((tx) => {
			if (tx.events && tx.events.length > 0) {
				const event = tx.events[0];
				const eventName = event.eventName || "unknown";

				if (!eventsData[eventName]) {
					eventsData[eventName] = {
						contractAddress: tx.contractAddress,
						eventName: eventName,
						count: 0,
					};
				}
				eventsData[eventName].count += 1;
			}
		});

		const formattedTransactions = Object.values(eventsData);

		return formattedTransactions;
	} catch (error) {
		console.error("Error fetching events data:", error);
		throw new Error(error.message);
	}
}
export async function getCallsData(query) {
	try {
		const transactions = await fetchTransactions(query);
		const callsData = {};

		transactions.forEach((tx) => {
			if (tx.internalTxs && tx.internalTxs.length > 0) {
				tx.internalTxs.forEach((call) => {
					const callType = call.callType || "unknown";
					if (!callsData[callType]) {
						callsData[callType] = {
							callType: callType,
							count: 0,
						};
					}
					callsData[callType].count += 1;
				});
			}
		});

		return Object.values(callsData);
	} catch (error) {
		console.error("Error fetching calls data:", error);
		throw new Error(error.message);
	}
}
export async function getStorageStateData(query) {
	try {
		const transactions = await fetchTransactions(query);
		const storageStateData = {};

		transactions.forEach((tx) => {
			if (tx.storageState && tx.storageState.length > 0) {
				tx.storageState.forEach((state) => {
					const name = state.variableName || "unknown";
					if (!storageStateData[name]) {
						storageStateData[name] = {
							variableName: name,
							count: 0,
						};
					}
					storageStateData[name].count += 1;
				});
			}
		});

		return Object.values(storageStateData);
	} catch (error) {
		console.error("Error fetching storage state data:", error);
		throw new Error(error.message);
	}
}

export function formatTransactionForTreeView(tx) {
	const children = [];

	// Add basic transaction details
	children.push({
		id: `${tx.transactionHash}-sender`,
		label: `Sender: ${tx.sender}`,
	});
	children.push({
		id: `${tx.transactionHash}-contractAddress`,
		label: `Contract Address: ${tx.contractAddress}`,
	});
	children.push({
		id: `${tx.transactionHash}-activity`,
		label: `Activity: ${tx.activity}`,
	});
	children.push({
		id: `${tx.transactionHash}-blockNumber`,
		label: `Block Number: ${tx.blockNumber}`,
	});
	children.push({
		id: `${tx.transactionHash}-timestamp`,
		label: `Timestamp: ${new Date(tx.timestamp).toLocaleString()}`, // Human-friendly date
	});
	children.push({
		id: `${tx.transactionHash}-gasUsed`,
		label: `Gas Used: ${tx.gasUsed}`,
	});

	// Add Inputs
	if (tx.inputs && tx.inputs.length > 0) {
		const inputsChildren = tx.inputs.map((input, index) => {
			let inputValue = input.inputValue;
			if (typeof inputValue === "number" && inputValue > 1e18) {
				// Simple heuristic for large numbers (likely BigInts or wei amounts)
				inputValue = inputValue.toExponential(2); // Format large numbers as exponential
			}
			return {
				id: `${tx.transactionHash}-input-${input.inputId}-${index}`,
				label: `${input.inputName} (${input.type}): ${inputValue}`,
			};
		});
		children.push({
			id: `${tx.transactionHash}-inputs`,
			label: "Inputs",
			children: inputsChildren,
		});
	}

	// Add Storage State
	if (tx.storageState && tx.storageState.length > 0) {
		const storageChildren = tx.storageState.map((state, index) => {
			let variableValue = state.variableValue;
			try {
				const parsedValue = JSON.parse(state.variableValue);
				if (
					typeof parsedValue === "object" &&
					parsedValue !== null &&
					Object.keys(parsedValue).length > 0
				) {
					variableValue = Object.entries(parsedValue)
						.map(([key, val]) => `${key}: ${val}`)
						.join(", ");
				}
			} catch (e) {
				// Not a JSON string, keep original value
			}
			return {
				id: `${tx.transactionHash}-storage-${state.variableId}-${index}`,
				label: `${state.variableName} (${state.type}): ${variableValue}`,
			};
		});
		children.push({
			id: `${tx.transactionHash}-storageState`,
			label: "Storage State",
			children: storageChildren,
		});
	}

	// Add Internal Transactions (if any)
	if (tx.internalTxs && tx.internalTxs.length > 0) {
		const internalTxsChildren = tx.internalTxs.map((internalTx, index) => {
			const inputsCallFormatted = internalTx.inputsCall
				.filter((input) => input !== null) // Filter out nulls
				.map((input) =>
					input.length > 20 ? `${input.substring(0, 10)}...` : input
				) // Shorten long hex strings
				.join(", ");

			return {
				id: `${tx.transactionHash}-internalTx-${internalTx.callId}-${index}`,
				label: `Call Type: ${internalTx.callType}, To: ${internalTx.to}, Inputs: [${inputsCallFormatted}]`,
			};
		});
		children.push({
			id: `${tx.transactionHash}-internalTxs`,
			label: `Internal Transactions (${tx.internalTxs.length})`,
			children: internalTxsChildren,
		});
	}

	// Add Events
	if (tx.events && tx.events.length > 0) {
		const eventsChildren = tx.events.map((event, index) => {
			const eventValuesFormatted = Object.entries(event.eventValues)
				.filter(([key]) => isNaN(parseInt(key))) // Filter out numeric keys like "0", "1", "__length__"
				.map(([key, value]) => {
					let formattedValue = value;
					if (typeof value === "number" && value > 1e18) {
						formattedValue = value.toExponential(2); // Format large numbers as exponential
					}
					return `${key}: ${formattedValue}`;
				})
				.join(", ");

			return {
				id: `${tx.transactionHash}-event-${event.eventId}-${index}`,
				label: `${event.eventName}: { ${eventValuesFormatted} }`,
			};
		});
		children.push({
			id: `${tx.transactionHash}-events`,
			label: "Events",
			children: eventsChildren,
		});
	}

	return {
		id: tx.transactionHash,
		label: `Transaction Hash: ${tx.transactionHash.substring(
			0,
			10
		)}...${tx.transactionHash.substring(
			tx.transactionHash.length - 8
		)} (Activity: ${tx.functionName})`, // Shorten hash for display
		children: children,
	};
}
