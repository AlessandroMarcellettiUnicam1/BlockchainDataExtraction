import { fetchTransactions } from "./transactionQuery.js";
import {getAllTransactions} from "./flattenTransaction.js";

export async function getTransactions(query) {
    return fetchTransactions(query);
}


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
        let txs = transactions;
        if(query.hasOwnProperty("internalTxs")){
            txs = txs.filter((tx)=>!tx.hasOwnProperty("depth"));
        }

        return {gasUsed: Object.values(activityGasMap),
            transaction: txs};
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
			// Aggregate by day instead of exact timestamp
			const date = new Date(tx.timestamp).toISOString().split("T")[0];

			if (!timeData[date]) {
				timeData[date] = {
					date,
					gasUsed: 0,
					transactionCount: 0,
				};
			}
			timeData[date].gasUsed += Number(tx.gasUsed) || 0;
			timeData[date].transactionCount += 1;
		});

		return Object.values(timeData).sort(
			(a, b) => new Date(a.date) - new Date(b.date)
		);
	} catch (error) {
		console.error("Error fetching time-based gas usage:", error);
		throw new Error(error.message);
	}
}

export async function getInputsData(query) {
	try {
		const transactions = await fetchTransactions(query);
        const inputsData = {};
        transactions.forEach((tx) => {
            if(tx.inputs && Array.isArray(tx.inputs) && tx.inputs.length > 0) {
                tx.inputs.forEach((input) => {
                    const type = input.type || "unknown";
                    if(!inputsData[type]){
                        inputsData[type] = {
                            type: input.type,
                            count:0
                        }
                    }
                    inputsData[type].count += 1;
                })
            }
        });
        let result = []
        for (const transaction of transactions) {
            for(let i = 0;i<transaction.inputs.length;i++) {
                let value;
                if(transaction.inputs[i]?.type==="bool")
                    value = transaction.inputs[i]?.inputValue === "true";
                else
                    value = transaction.inputs[i]?.inputValue || transaction.inputs[i].value || "unknown"
                result = result.concat({
                    contractAddress: transaction.contractAddress,
                    activity: transaction.activity || transaction.functionName || "unknown",
                    timestamp: transaction.timestamp,
                    inputName: transaction.inputs[i]?.inputName || transaction.inputs[i].name || "unknown",
                    inputType: transaction.inputs[i]?.type || "unknown",
                    inputValue: value
                });
            }
        }
        const inputsChart = Object.values(inputsData)
		return {inputsGrid: result, inputsChart: inputsChart};
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
			if (tx.events && Array.isArray(tx.events)) {
				tx.events.forEach((event) => {
					const eventName = event.eventName || "unknown";

					if (!eventsData[eventName]) {
						eventsData[eventName] = {
							contractAddress: tx.contractAddress,
							eventName: eventName,
							count: 0,
						};
					}
					eventsData[eventName].count += 1;
				});
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

        const {internalTxs} = query;
        if(internalTxs) {
            for (const transaction of transactions) {
                if (transaction.hasOwnProperty("type")) {
                    if (!callsData[transaction.type]) {
                        callsData[transaction.type] = {
                            callType: transaction.type,
                            count: 0
                        };
                    }
                    callsData[transaction.type].count += 1;
                }
            }
        }
        else{
            transactions.forEach((tx) => {
                if (tx.internalTxs && tx.internalTxs.length > 0) {
                    tx.internalTxs.forEach((call) => {
                        const callType = call.type || "unknown";
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
        }
        let txsFiltered = transactions;
        if(!internalTxs)
            txsFiltered = await getAllTransactions(transactions);
        txsFiltered = txsFiltered.filter((tx)=>tx.hasOwnProperty("depth"))
                                    .map((tx)=>({
                                        ...tx,
                                        transactionHash: tx.transactionHash.split("-")[0]
                                    }));

		return {call: Object.values(callsData),
            dataGrid: txsFiltered};
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
		label: `Activity: ${tx.activity || tx.functionName}`,
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
				id: `${tx.transactionHash}-input-${input.inputName}-${index}`,
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
				.filter((input) => input !== null)
				.map((input) =>
					input.length > 20 ? `${input.substring(0, 10)}...` : input
				)
				.join(", ");

			return {
				id: `${tx.transactionHash}-internalTx-${internalTx.callId}-${index}`,
				label: `Call Type: ${internalTx.type}, To: ${internalTx.to}, Inputs: [${inputsCallFormatted}]`,
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
		label: `Transaction Hash: ${tx.transactionHash} (Activity: ${tx.functionName})`, // Shorten hash for display
		children: children,
	};
}

export function formatEventsForTreeView(tx) {
	const eventNodes = [];

	if (tx.events && tx.events.length > 0) {
		tx.events.forEach((event, eventIndex) => {
			const eventValuesChildren = [];

			Object.entries(event.eventValues)
				.filter(([key]) => isNaN(parseInt(key)) && key !== "__length__")
				.forEach(([key, value]) => {
					let formattedValue = value;
					if (typeof value === "number" && value > 1e18) {
						formattedValue = value.toExponential(2);
					} else if (typeof value === "object" && value !== null) {
						formattedValue = JSON.stringify(value);
					}

					eventValuesChildren.push({
						id: `${tx.transactionHash}-event-${eventIndex}-${key}`,
						label: `${key}: ${formattedValue}`,
					});
				});

			eventNodes.push({
				id: `${tx.transactionHash}-event-${eventIndex}`,
				label: `Event: ${event.eventName}`,
				children: eventValuesChildren,
			});
		});
	}

	return {
		id: tx.transactionHash,
		label: `Transaction: ${tx.transactionHash}`,
		children: eventNodes,
	};
}

export function formatInternalTransactionsForTreeView(
    transaction
){
    const children = [];
    children.push({
        id: `${transaction.transactionHash}`,
        label: `Transaction: ${transaction.transactionHash}`
    });
    children.push({
        id: `${transaction.transactionHash}-${transaction.functionName || transaction.activity}`,
        label: `Function Name: ${transaction.functionName || transaction.activity}`,
    });
    children.push({
        id: `${transaction.transactionHash}-${transaction.sender || transaction.from}`,
        label: `Sender: ${transaction.sender || transaction.from}`,
    });
    children.push({
        id: `${transaction.transactionHash}-${transaction.contractAddress || transaction.to}`,
        label: `Contract Address: ${transaction.contractAddress || transaction.to}`,
    });

    if(transaction.inputs && Array.isArray(transaction.inputs) && transaction.inputs.length > 0) {
        const inputsChildren = transaction.inputs.map((input, inputIndex) => {
            let inputValue = input.inputValue;
            if (typeof inputValue === "object" && inputValue.$numberLong) {
                inputValue = inputValue.$numberLong;
            }
            if (typeof inputValue === "number" && inputValue > 1e18) {
                inputValue = inputValue.toExponential(2);
            }
            return {
                id: `${transaction.transactionHash}-input-${inputIndex}`,
                label: `${input.inputName} (${input.type}): ${inputValue}`,
            };
        });
        children.push({
            id: `${transaction.transactionHash}-input`,
            label: `Inputs (Decoded): `,
            children: inputsChildren,
        })
    }
    if(transaction.internalTxs && Array.isArray(transaction.internalTxs) && transaction.internalTxs.length > 0) {
        const internalTxsChildren = expandInternal(transaction.internalTxs,[],transaction.transactionHash);
        children.push({
            id: `${transaction.transactionHash}-internalTxs`,
            label: `Internal Txs: `,
            children: internalTxsChildren
        });
    }
    return [{
        id: `${transaction.transactionHash}-transaction`,
        label: `Transaction : ${transaction.transactionHash}`,
        children: children,
    }]
}

export function formatCallForTreeView(transaction,depth,to,from,activity){
    if(activity==="null")
        activity = null;
    const children = [];
    children.push({
        id: `${transaction.transactionHash}`,
        label: `Transaction: ${transaction.transactionHash}`
    });
    children.push({
        id: `${transaction.transactionHash}-${transaction.functionName || transaction.activity}`,
        label: `Function Name: ${transaction.functionName || transaction.activity}`,
    });
    children.push({
        id: `${transaction.transactionHash}-${transaction.sender || transaction.from}`,
        label: `Sender: ${transaction.sender || transaction.from}`,
    });
    children.push({
        id: `${transaction.transactionHash}-${transaction.contractAddress || transaction.to}`,
        label: `Contract Address: ${transaction.contractAddress || transaction.to}`,
    });

    if(transaction.inputs && Array.isArray(transaction.inputs) && transaction.inputs.length > 0) {
        const inputsChildren = transaction.inputs.map((input, inputIndex) => {
            let inputValue = input.inputValue;
            if (typeof inputValue === "object" && inputValue.$numberLong) {
                inputValue = inputValue.$numberLong;
            }
            if (typeof inputValue === "number" && inputValue > 1e18) {
                inputValue = inputValue.toExponential(2);
            }
            return {
                id: `${transaction.transactionHash}-input-${inputIndex}`,
                label: `${input.inputName} (${input.type}): ${inputValue}`,
            };
        });
        children.push({
            id: `${transaction.transactionHash}-input`,
            label: `Inputs (Decoded): `,
            children: inputsChildren,
        })
    }
    if(transaction.internalTxs && Array.isArray(transaction.internalTxs) && transaction.internalTxs.length > 0) {
        const internalTxsChildren = findInternalCall(transaction.internalTxs,parseInt(depth),to,from,activity,transaction.transactionHash);
        console.log(internalTxsChildren);
        children.push({
            id: `${transaction.transactionHash}-internalTxs`,
            label: `Internal Txs: `,
            children: internalTxsChildren
        });
    }
    return [{
        id: `${transaction.transactionHash}-transaction`,
        label: `Transaction : ${transaction.transactionHash}`,
        children: children,
    }]

}

function findInternalCall(transactions,depth,to,from,activity,txHash) {
    for(const transaction of transactions) {
        if(transaction.depth===depth &&
            transaction.from===from &&
            transaction.to===to &&
            transaction.activity===activity
        )
            return expandInternal([transaction],[],txHash);
        else if(transaction.calls &&  Array.isArray(transaction.calls) && transaction.calls.length>0) {
            const result = findInternalCall(transaction.calls, depth, to, from, activity, txHash);
            if(result){
                return result;
            }
        }
    }
}

function expandInternal(transactions,parentIndex,txHash){
    const parentId = parentIndex.join("-");
    if(!transactions || !Array.isArray(transactions) || transactions.length === 0) return [];
    return transactions.map((tx, index) => {
        const children = [];
        children.push({
            id: `${txHash}-${tx.functionName || tx.activity}-${parentId}-${index}`,
            label: `Function Name: ${tx.functionName || tx.activity}`,
        });
        children.push({
            id: `${txHash}-${tx.sender || tx.from}-${parentId}-${index}`,
            label: `From: ${tx.sender || tx.from}`,
        });
        children.push({
            id: `${txHash}-${tx.contractAddress || tx.to}-${parentId}-${index}`,
            label: `To: ${tx.contractAddress || tx.to}`,
        });

        if (tx.inputs && Array.isArray(tx.inputs) && tx.inputs.length > 0) {
            const inputsChildren = tx.inputs.map((input, inputIndex) => {
                let inputValue = input.value;
                if (typeof inputValue === "object" && inputValue.$numberLong) {
                    inputValue = inputValue.$numberLong;
                }
                if (typeof inputValue === "number" && inputValue > 1e18) {
                    inputValue = inputValue.toExponential(2);
                }
                return {
                    id: `${txHash}-${parentId}-${index}-input-${inputIndex}`,
                    label: `${input.name} (${input.type}): ${inputValue}`,
                };
            });
            children.push({
                id: `${txHash}-${parentId}-${index}-input`,
                label: `Inputs (Decoded): `,
                children: inputsChildren
            })
        }
        if (tx.calls && Array.isArray(tx.calls) && tx.calls.length > 0) {
            const callChildren = expandInternal(tx.calls,parentIndex.concat(index),txHash);
            children.push({
                id: `${txHash}-${parentId}-${index}-call`,
                label: `Calls: `,
                children: callChildren
            })
        }
        return {
            id: `${txHash}-${parentId}-${index}-calls`,
            label: `Calls: `,
            children: children
        }
    });
}

export function formatCallsForTreeView(
	callType,
	transactions,
	page = 0,
	limit = null
) {
	const callsOfType = [];

	transactions.forEach((tx) => {
		if (tx.internalTxs && tx.internalTxs.length > 0){
			tx.internalTxs.forEach((call, callIndex) => {
				if (call.type === callType) {
					callsOfType.push({
						...call,
						transactionHash: tx.transactionHash,
						callIndex: callIndex,
					});
				}
			});
		}
        if(tx.calls && tx.calls.length > 0) {
            tx.calls.forEach((call,callIndex)=>{
                if (call.type === callType) {
                    callsOfType.push({
                        ...call,
                        transactionHash: tx.transactionHash,
                        callIndex: callIndex,
                    });
                }
            })
        }
	});

	const startIndex = page * (limit || callsOfType.length);
	const endIndex = limit ? startIndex + limit : callsOfType.length;
	const paginatedCalls = callsOfType.slice(startIndex, endIndex);

	return paginatedCalls.map((call, index) => {
		const children = [];
        children.push({
			id: `${call.transactionHash}-${call.callIndex}-${index}-callType`,
			label: `Call Type: ${call.type}`,
		});

		children.push({
			id: `${call.transactionHash}-${call.callIndex}-${index}-to`,
			label: `To: ${call.to}`,
		});

		if (call.inputsCall && Array.isArray(call.inputsCall) && call.inputsCall.length > 0) {
			const inputsCallChildren = call.inputsCall.map(
				(inputCall, inputIndex) => ({
					id: `${call.transactionHash}-${call.callIndex}-inputCall-${inputIndex}`,
					label: inputCall,
				})
			);

			children.push({
				id: `${call.transactionHash}-${call.callIndex}-inputsCall`,
				label: "Inputs Call (Raw)",
				children: inputsCallChildren,
			});
		}

		if (call.inputs && call.inputs.length > 0) {
			const inputsChildren = call.inputs.map((input, inputIndex) => {
				let inputValue = input.value;
				if (typeof inputValue === "object" && inputValue.$numberLong) {
					inputValue = inputValue.$numberLong;
				}
				if (typeof inputValue === "number" && inputValue > 1e18) {
					inputValue = inputValue.toExponential(2);
				}
				return {
					id: `${call.transactionHash}-${call.callIndex}-${index}-input-${inputIndex}`,
					label: `${input.name} (${input.type}): ${inputValue}`,
				};
			});

			children.push({
				id: `${call.transactionHash}-${call.callIndex}-${index}-inputs`,
				label: "Inputs (Decoded)",
				children: inputsChildren,
			});
		}

		return {
			id: `${call.transactionHash}-${call.callIndex}-${index}-call`,
			label: `Call ${startIndex + index + 1} - Tx: ${call.transactionHash}...`,
			children: children,
		};
	});
}

export function extractEventDataAsJson(tx) {
	const extractedEvents = [];

	if (tx.events && tx.events.length > 0) {
		tx.events.forEach((event) => {
			const formattedEventValues = {};

			// Convert eventValues object to an array of key-value pairs
			// and filter out numeric keys and "__length__"
			Object.entries(event.eventValues)
				.filter(([key]) => isNaN(parseInt(key)) && key !== "__length__")
				.forEach(([key, value]) => {
					let formattedValue = value;
					// Apply formatting for large numbers if needed
					if (typeof value === "number" && value > 1e18) {
						formattedValue = value.toExponential(2);
					}
					formattedEventValues[key] = formattedValue;
				});

			extractedEvents.push({
				transactionHash: tx.transactionHash,
				eventName: event.eventName,
				eventValues: formattedEventValues,
				blockNumber: tx.blockNumber,
				timestamp: tx.timestamp,
				contractAddress: tx.contractAddress,
				sender: tx.sender,
			});
		});
	}

	return extractedEvents;
}

// Function to format storage variable history for visualization
export function formatStorageHistoryForVisualization(
	variableName,
	transactions,
	options = {}
) {
	const { limit = 1000, page = 1, sampleRate = 1 } = options;
	const historyData = [];

	// Collect all transactions that modified this variable
	transactions.forEach((tx) => {
		if (tx.storageState && tx.storageState.length > 0) {
			const variableState = tx.storageState.find(
				(state) => state.variableName === variableName
			);

			if (variableState) {
				let numericValue = null;
				let displayValue = variableState.variableValue;

				try {
					const directNumber = parseFloat(variableState.variableValue);
					if (!isNaN(directNumber)) {
						numericValue = directNumber;
						displayValue = directNumber;
					} else {
						const parsedValue = JSON.parse(variableState.variableValue);
						if (typeof parsedValue === "object" && parsedValue !== null) {
							if (parsedValue.$numberLong) {
								numericValue = parseFloat(parsedValue.$numberLong);
								displayValue = numericValue;
							}
						}
					}
				} catch (e) {
					displayValue = variableState.variableValue;
				}

				historyData.push({
					transactionHash: tx.transactionHash,
					blockNumber: tx.blockNumber,
					timestamp: tx.timestamp.$date || tx.timestamp,
					variableName: variableState.variableName,
					variableType: variableState.type,
					variableValue: displayValue,
					numericValue: numericValue,
					variableRawValue: variableState.variableRawValue,
					sender: tx.sender,
					contractAddress: tx.contractAddress,
					functionName: tx.functionName,
					gasUsed: tx.gasUsed,
				});
			}
		}
	});

	// Sort by timestamp (oldest first)
	historyData.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

	// Apply sampling for large datasets
	let sampledData = historyData;
	if (sampleRate > 1 && historyData.length > limit) {
		sampledData = historyData.filter((_, index) => index % sampleRate === 0);
		// Always include the last item
		if (
			historyData.length > 0 &&
			sampledData[sampledData.length - 1] !==
				historyData[historyData.length - 1]
		) {
			sampledData.push(historyData[historyData.length - 1]);
		}
	}

	// Apply pagination
	const startIndex = (page - 1) * limit;
	const endIndex = startIndex + limit;
	const paginatedData = sampledData.slice(startIndex, endIndex);

	// Calculate changes between consecutive values
	const changesData = paginatedData.map((item, index) => {
		let change = null;
		let changePercent = null;

		if (
			index > 0 &&
			item.numericValue !== null &&
			paginatedData[index - 1].numericValue !== null
		) {
			change = item.numericValue - paginatedData[index - 1].numericValue;
			changePercent = (change / paginatedData[index - 1].numericValue) * 100;
		}

		return {
			...item,
			change: change,
			changePercent: changePercent,
		};
	});

	// Create optimized chart data (further sampling if needed)
	const maxChartPoints = 500;
	let chartData = changesData.filter((item) => item.numericValue !== null);

	if (chartData.length > maxChartPoints) {
		const chartSampleRate = Math.ceil(chartData.length / maxChartPoints);
		chartData = chartData.filter((_, index) => index % chartSampleRate === 0);
		// Always include the last point
		if (changesData.length > 0) {
			const lastNumericItem = changesData
				.slice()
				.reverse()
				.find((item) => item.numericValue !== null);
			if (
				lastNumericItem &&
				chartData[chartData.length - 1] !== lastNumericItem
			) {
				chartData.push(lastNumericItem);
			}
		}
	}

	return {
		variableName: variableName,
		totalOccurrences: historyData.length,
		displayedOccurrences: paginatedData.length,
		history: changesData,
		chartData: chartData.map((item) => ({
			timestamp: item.timestamp,
			blockNumber: item.blockNumber,
			value: item.numericValue,
			displayValue: item.variableValue,
			transactionHash: item.transactionHash,
			change: item.change,
			changePercent: item.changePercent,
		})),
		valueRange: getValueRange(changesData),
		timeRange: {
			start: historyData.length > 0 ? historyData[0].timestamp : null,
			end:
				historyData.length > 0
					? historyData[historyData.length - 1].timestamp
					: null,
		},
		pagination: {
			currentPage: page,
			totalPages: Math.ceil(sampledData.length / limit),
			hasMore: endIndex < sampledData.length,
			sampleRate: sampleRate,
		},
	};
}

// Helper function to determine value range for numeric variables
function getValueRange(historyData) {
	const numericValues = historyData
		.map((item) => item.numericValue)
		.filter((val) => val !== null && !isNaN(val));

	if (numericValues.length === 0) {
		return {
			type: "non-numeric",
			uniqueValues: [...new Set(historyData.map((item) => item.variableValue))],
		};
	}

	const changes = historyData
		.map((item) => item.change)
		.filter((change) => change !== null);

	return {
		type: "numeric",
		min: Math.min(...numericValues),
		max: Math.max(...numericValues),
		average:
			numericValues.reduce((sum, val) => sum + val, 0) / numericValues.length,
		totalChange:
			numericValues.length > 1
				? numericValues[numericValues.length - 1] - numericValues[0]
				: 0,
		averageChange:
			changes.length > 0
				? changes.reduce((sum, val) => sum + val, 0) / changes.length
				: 0,
		isMonotonic: isMonotonicSequence(numericValues),
	};
}

// Helper to check if sequence is monotonic (always increasing/decreasing)
function isMonotonicSequence(values) {
	if (values.length <= 1) return true;

	let increasing = true;
	let decreasing = true;

	for (let i = 1; i < values.length; i++) {
		if (values[i] > values[i - 1]) decreasing = false;
		if (values[i] < values[i - 1]) increasing = false;
	}

	return increasing || decreasing;
}
