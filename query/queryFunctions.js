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
				};
			}
			activityGasMap[activity].gasUsed += Number(tx.gasUsed) || 0;
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
          totalGasUsed: 0
        };
      }
      mostActiveSenders[tx.sender].numberOfTransactions += 1;
      mostActiveSenders[tx.sender].totalGasUsed += Number(tx.gasUsed) || 0;
    });

    // Calculate average gas used for each sender
    Object.values(mostActiveSenders).forEach(sender => {
      sender.averageGasUsed = Math.round(sender.totalGasUsed / sender.numberOfTransactions);
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
    const sortedData = Object.values(timeData).sort((a, b) =>
      new Date(a.date) - new Date(b.date)
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
        count: 0
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
        })
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
