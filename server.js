const express = require("express");
const cors = require("cors");
const path = require("path");
const bodyParser = require("body-parser");
const fs = require("fs");
const { stringify } = require("csv-stringify");
const multer = require("multer");
const jsonToCsv = require("json-2-csv");
const jp = require("jsonpath");

const { getAllTransactions } = require("./services/main");
const app = express();
const upload = multer({ dest: "uploads/" });
const port = 8000;
const { setEventTypes } = require("./ocelMapping/eventTypes");
app.use(cors());

// Middleware: Logging for every request
app.use((req, res, next) => {
	const start = Date.now();
	const formattedDate = new Date().toLocaleString("it-IT", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
	const logInfo = `${formattedDate} - ${req.method} ${req.url}`;

	res.on("finish", () => {
		const duration = Date.now() - start;
		console.log(
			`${logInfo} - Status: ${res.statusCode} - Duration: ${duration}ms`
		);
	});

	next();
});

// Middleware: Serving static files from the "public" directory
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json({ limit: "50mb" }));

const { searchTransaction, queryData } = require("./query/query");
const { connectDB } = require("./config/db");
const { setObjectTypes } = require("./ocelMapping/objectTypes/objectTypes");
const { default: mongoose } = require("mongoose");

app.post("/api/generateGraph", (req, res) => {
	const jsonData = req.body.jsonData;
	const edges = req.body.edges;
	const nodesSet = new Map();
	let edgesArray = [];

	const addNodeIfMissing = (id, label, shape, color, tx, key) => {
		if (!nodesSet.has(id)) {
			nodesSet.set(id, {
				id: id,
				size: 10,
				hidden: false,
				label: label,
				keyUsed: key,
				x: Math.random() * 100,
				y: Math.random() * 100,
				color: color,
				details: tx,
			});
		}
	};
	const addEdgeIfMissing = (from, to) => {
		let id = `${from}-${to}`;
		if (!edgesArray.some((edge) => edge.id === id)) {
			edgesArray.push({
				id: id,
				from: from,
				to: to,
				label: "",
				value: 1,
				size: 1,
			});
		} else {
			edgesArray.forEach((edge) => {
				if (edge.id === id) {
					edge.value++;
					edge.size = edge.value;
				}
			});
		}
	};
	const getNodeId = (item) => {
		if (typeof item === "object" && item !== null) {
			return JSON.stringify(item);
		}
		return String(item);
	};
	const getRandomColor = () => {
		return (
			"#" + (((1 << 24) * Math.random()) | 0).toString(16).padStart(6, "0")
		);
	};

	edges.forEach((edge) => {
		let from = edge.from;
		let to = edge.to;
		const colorFrom = getRandomColor();
		const colorTo = getRandomColor();
		jsonData.forEach((tx) => {
			let fromResults = jp.value(tx, `$..${from}`);
			let toResults = jp.value(tx, `$..${to}`);
			const fromItems = Array.isArray(fromResults)
				? fromResults
				: [fromResults];
			const toItems = Array.isArray(toResults) ? toResults : [toResults];
			fromItems.forEach((fromItem) => {
				const idFrom = getNodeId(fromItem);
				const labelFrom = idFrom.slice(0, 64);
				addNodeIfMissing(idFrom, labelFrom, "ellipse", colorFrom, tx, from);

				toItems.forEach((toItem) => {
					const idTo = getNodeId(toItem);
					const labelTo = idTo.slice(0, 64);
					addNodeIfMissing(idTo, labelTo, "box", colorTo, tx, to);
					addEdgeIfMissing(idFrom, idTo, "");
				});
			});
		});
	});

	// Transform nodes for frontend
	const nodes = Array.from(nodesSet.values()).map((obj, index) => ({
		key: obj.id,
		attributes: {
			label: `${obj.label}`,
			size: 10,
			details: obj.details,
			keyUsed: obj.keyUsed,
			color: obj.color,
			x: obj.x,
			y: obj.y,
		},
	}));

	// Color legend
	const colorLegendData = [];
	const colorSet = new Set();
	nodes.forEach((node) => {
		if (node.attributes.color && !colorSet.has(node.attributes.color)) {
			colorLegendData.push({
				color: node.attributes.color,
				keyAssigned: node.attributes.keyUsed,
			});
			colorSet.add(node.attributes.color);
		}
	});

	// Edge scaling
	const edgeValues = edgesArray.map((edge) => edge.value);
	const maxEdgeValue = Math.max(...edgeValues);
	const minEdgeValue = Math.min(...edgeValues);
	const scaleEdgeValue = (value) => {
		if (maxEdgeValue === minEdgeValue) return 1;
		return ((value - minEdgeValue) / (maxEdgeValue - minEdgeValue)) * 4 + 1;
	};
	const newEdges = edgesArray.map((obj, index) => ({
		key: obj.id,
		source: obj.from,
		target: obj.to,
		attributes: {
			value: obj.value,
			size: scaleEdgeValue(obj.value),
			color: "#3399FF",
			x: Math.random() * 100,
			y: Math.random() * 100,
		},
	}));
	res.send({
		nodes,
		edges: newEdges,
		colorLegend: colorLegendData,
		edgeFilter: edgeValues,
	});
});

app.post("/api/ocelMap", (req, res) => {
	const ocelMap = req.body;
	let ocel = {
		eventTypes: [],
		objectTypes: [],
		events: [],
		objects: [],
	};
	const eventTypes = setEventTypes(ocelMap.blockchainLog, ocel);
	ocel.events = eventTypes.events;
	ocel.eventTypes = eventTypes.eventTypes;
	ocelMap.objectsToMap.forEach((obj) => {
		ocel = setObjectTypes(obj, ocel, ocelMap.blockchainLog);
	});
	res.send(ocel);
});
app.post("/api/xes", async (req, res) => {
	const jsonToTranslate = req.body.jsonToXes;
	const { caseId, activityKey, timestamp } = req.body.objectsToXes;
	let xes = {
		xesString: null,
	};
	xes.xesString = jsonToXes(jsonToTranslate, caseId.value, activityKey.value);
	res.send(xes);
	// const filename = "xesLogs.json"
	// // const xesString = jsonToXesString(jsonToTranslate);
	// const formattedFileName = encodeURIComponent(filename);
	// fs.writeFileSync(filename, xesString);

	// res.setHeader('Content-Disposition', `attachment; filename="${formattedFileName}"`);
	// res.setHeader('Content-Type', 'application/octet-stream');

	// res.sendFile(path.resolve(filename), (err) => {
	//     if (err) {
	//         console.error(err);
	//         res.status(err.status).end();
	//     } else {
	//         fs.unlinkSync(path.resolve(filename));
	//         console.log('File sent successfully');
	//     }
	// });
});
app.post("/api/query", async (req, res) => {
	const query = req.body;

	await connectDB(query.network);
	delete query.network;
	try {
		const results = await searchTransaction(query);

		if (results) {
			res.json(results);
		} else {
			res.status(404).json({ message: "No result found" });
		}
	} catch (error) {
		console.error("Error during query execution:", error);
		res.status(500).json({ error: error.message });
	}
});

// Route: Home Page
app.post("/submit", upload.single("file"), async (req, res) => {
	const contractAddress = req.body.contractAddress; // Get data from input1
	const implementationContractAddress = req.body.implementationContractAddress; // Get data from input1
	const contractName = req.body.contractName; // Get data from input2
	const fromBlock = req.body.fromBlock; // Get 'Start Block' value from form
	const toBlock = req.body.toBlock; // Get 'End Block' value from form
	const network = req.body.network;
	const filters = JSON.parse(req.body.filters);
	const extractionType = req.body.extractionType;
	// Perform actions based on the received data
	console.log(`Start Block: ${fromBlock}`);
	console.log(`End Block: ${toBlock}`);
	// Perform actions with the received data (you can customize this part)
	console.log(`contract Address: ${contractAddress}`);
	console.log(
		`implementation contract Address: ${implementationContractAddress}`
	);
	console.log(`Contract name: ${contractName}`);
	let logs = [];
	if (req.file) {
		fs.readFile(req.file.path, "utf-8", async (err, data) => {
			if (err) {
				console.error(err);
				return res.status(500).send("Error reading file");
			}
			logs = await getAllTransactions(
				contractName,
				contractAddress,
				implementationContractAddress,
				fromBlock,
				toBlock,
				network,
				filters,
				data,
				extractionType
			);
			fs.unlink(req.file.path, (err) => {
				if (err) {
					console.error(err);
				}
				if (logs instanceof Error) {
					res.status(404).send(logs.message);
				} else {
					res.send(logs);
				}
			});
		});
	} else {
		logs = await getAllTransactions(
			contractName,
			contractAddress,
			implementationContractAddress,
			fromBlock,
			toBlock,
			network,
			filters,
			null,
			extractionType
		);
		if (logs instanceof Error) {
			res.status(404).send(logs.message);
		} else {
			res.send(logs);
		}
	}
});

app.post("/json-download", (req, res) => {
	const jsonToDownload = req.body.jsonLog;
	fs.writeFileSync("jsonLog.json", JSON.stringify(jsonToDownload, null, 2));

	const formattedFileName = encodeURIComponent("jsonLog.json");
	res.setHeader(
		"Content-Disposition",
		`attachment; filename="${formattedFileName}"`
	);
	res.setHeader("Content-Type", "application/octet-stream");

	res.sendFile(path.resolve("jsonLog.json"), (err) => {
		if (err) {
			// Handle error if file sending fails
			console.error(err);
			res.status(err.status).end();
		} else {
			fs.unlinkSync(path.resolve("jsonLog.json"));
			console.log("File sent successfully");
		}
	});
});

app.post("/csv-download", async (req, res) => {
	const jsonToDownload = req.body.jsonLog;
	const fileName = "jsonLog.csv";

	const columns = [
		"BlockNumber",
		"transactionHash",
		"functionName",
		"Timestamp",
		"Sender",
		"GasFee",
		"StorageState",
		"Inputs",
		"Events",
		"InternalTxs",
	];
	const logs = jsonToDownload.map((log) => {
		const customDate = log.timestamp.split(".")[0] + ".000+0100";

		const blockNumber = log.blockNumber;
		const tr = log.transactionHash;
		const activity = log.functionName;
		const timestamp = customDate;
		const sender = log.sender;
		const gasFee = log.gasUsed;
		const storageState = log.storageState
			.map((variable) => variable.variableName)
			.toString();
		const inputs = log.inputs.map((input) => input.inputName).toString();
		const events = log.events.map((event) => event.eventName).toString();
		const internalTxs = log.internalTxs.map((tx) => tx.callType).toString();
		return {
			BlockNumber: blockNumber,
			transactionHash: tr,
			functionName: activity,
			Timestamp: timestamp,
			Sender: sender,
			GasFee: gasFee,
			StorageState: storageState,
			Inputs: inputs,
			Events: events,
			InternalTxs: internalTxs,
		};
	});
	stringify(logs, { header: true, columns: columns }, (err, output) => {
		fs.writeFileSync(`./${fileName}`, output);
		const formattedFileName = encodeURIComponent(fileName);
		res.setHeader(
			"Content-Disposition",
			`attachment; filename="${formattedFileName}"`
		);
		res.setHeader("Content-Type", "application/octet-stream");

		res.sendFile(path.resolve(fileName), (err) => {
			if (err) {
				// Handle error if file sending fails
				console.error(err);
				res.status(err.status).end();
			} else {
				fs.unlinkSync(path.resolve("jsonLog.csv"));
				console.log("File sent successfully");
			}
		});
	});
});

app.post("/ocel-download", (req, res) => {
	const jsonToDownload = req.body.ocel;
	const filename = "ocelLogs.json";
	// const jsonOcel = JsonOcelExporter.apply(jsonToDownload);

	fs.writeFileSync(filename, JSON.stringify(jsonToDownload, null, 2));

	const formattedFileName = encodeURIComponent(filename);
	res.setHeader(
		"Content-Disposition",
		`attachment; filename="${formattedFileName}"`
	);
	res.setHeader("Content-Type", "application/octet-stream");

	res.sendFile(path.resolve(filename), (err) => {
		if (err) {
			// Handle error if file sending fails
			console.error(err);
			res.status(err.status).end();
		} else {
			fs.unlinkSync(path.resolve(filename));
			console.log("File sent successfully");
		}
	});
});
app.post("/xes-translator", (req, res) => {
	const filename = "xesLogs.xes";
	fs.writeFileSync(filename, req.body.jsonLog.xesString);
	const formattedFileName = encodeURIComponent(filename);
	res.setHeader(
		"Content-Disposition",
		`attachment; filename="${formattedFileName}"`
	);
	res.setHeader("Content-Type", "application/octet-stream");
	res.sendFile(path.resolve(filename), (err) => {
		if (err) {
			// Handle error if file sending fails
			console.error(err);
			res.status(err.status).end();
		} else {
			fs.unlinkSync(path.resolve(filename));
			console.log("File sent successfully");
		}
	});
});

function jsonToXes(jsonToTranslate, caseIdKey, activityKey) {
	const trace = {};
	jsonToTranslate.forEach((entry) => {
		let caseIds = findAllValuesByKey(entry, caseIdKey); // Get all case IDs
		let activities = findAllValuesByKey(entry, activityKey); // Get all activities
		// Match occurrences one by one
		for (let i = 0; i < caseIds.length; i++) {
			let caseId = caseIds[i];
			let activity = activities[i];

			if (caseId in trace) {
				trace[caseId].push({ [activityKey]: activity, entry: entry });
			} else {
				trace[caseId] = [{ [activityKey]: activity, entry: entry }];
			}
		}
	});
	let stringResult = [];
	let index = 0;
	for (const key in trace) {
		stringResult.push(`\t<trace>`);
		stringResult.push(`\t<string key="concept:name" value="${key}"/>`);
		trace[key].forEach((entry) => {
			stringResult.push(`\t\t<event>`);
			stringResult.push(
				`\t\t<string key="concept:name" value="${entry[activityKey]}"/>`
			);
			generateKeyValueStrings(
				entry.entry,
				caseIdKey,
				activityKey,
				index,
				caseIdKey
			).forEach((elemt) => {
				stringResult.push(elemt);
			});
			stringResult.push(`\t\t</event>`);
			// stringResult.push(generateKeyValueStrings(entry.entry,caseIdKey,activityKey));
		});
		stringResult.push(`\t</trace>`);
	}
	let finalResult = `<?xml version="1.0" encoding="UTF-8"?>\n<log xmlns="http://www.xes-standard.org/">\n`;
	finalResult += stringResult.join("\n");
	finalResult += `\n</log>`;

	return finalResult;
}

function generateKeyValueStrings(obj, caseId, activityKey, keyToCheck = "") {
	let result = [];

	if (typeof obj === "object" && obj !== null) {
		for (let key in obj) {
			let newKeyToCheck = keyToCheck ? `${keyToCheck}_${key}` : key;

			if (Array.isArray(obj[key])) {
				obj[key].forEach((item, index) => {
					let arrayKey = `${newKeyToCheck}[${index}]`;
					result.push(
						...generateKeyValueStrings(item, caseId, activityKey, arrayKey)
					);
				});
			} else if (typeof obj[key] === "object" && obj[key] !== null) {
				result.push(
					...generateKeyValueStrings(
						obj[key],
						caseId,
						activityKey,
						newKeyToCheck
					)
				);
			} else if (key !== caseId && key !== activityKey) {
				let newKeyToCheckCut = newKeyToCheck;
				if (newKeyToCheck.includes("[")) {
					newKeyToCheckCut = newKeyToCheck.split("[")[0];
				}
				switch (newKeyToCheckCut) {
					case "inputs":
						result.push(
							`\t\t\t<string key="${newKeyToCheck}" value="${obj[key]}"/>`
						);
						break;
					case "events":
						if (
							!(
								newKeyToCheck.split("_eventValues")[1]?.includes("1") ||
								newKeyToCheck.split("_eventValues")[1]?.includes("2") ||
								newKeyToCheck.split("_eventValues")[1]?.includes("0") ||
								newKeyToCheck.split("_eventValues")[1]?.includes("_length")
							)
						) {
							newKeyToCheck = newKeyToCheck.replace("events", "BCEvent");
							result.push(
								`\t\t\t<string key="${newKeyToCheck}" value="${obj[key]}"/>`
							);
						}
						break;
					case "internalTxs":
						newKeyToCheck = newKeyToCheck.replace("internalTxs", "Int");
						result.push(
							`\t\t\t<string key="${newKeyToCheck}" value="${obj[key]}"/>`
						);
						break;
					case "storageState":
						newKeyToCheck = newKeyToCheck.replace("storageState", "stateVar");
						result.push(
							`\t\t\t<string key="${newKeyToCheck}" value="${obj[key]}"/>`
						);
						break;
					default:
						result.push(
							`\t\t\t<string key="${newKeyToCheck}" value="${obj[key]}"/>`
						);
						break;
				}
			}
		}
	} else {
		switch (keyToCheck) {
			case "inputs":
				result.push(`\t\t\t<string key="${keyToCheck}" value="${obj}"/>`);
				break;
			case "events":
				keyToCheck = keyToCheck.replace("events", "BCEvent");
				result.push(`\t\t\t<string key="${keyToCheck}" value="${obj}"/>`);
				break;
			case "internalTxs":
				keyToCheck = keyToCheck.replace("internalTxs", "Int");
				result.push(`\t\t\t<string key="${keyToCheck}" value="${obj}"/>`);
				break;
			case "storageState":
				keyToCheck = keyToCheck.replace("storageState", "stateVar");
				result.push(`\t\t\t<string key="${keyToCheck}" value="${obj}"/>`);
				break;
			default:
				result.push(`\t\t\t<string key="${keyToCheck}" value="${obj}"/>`);
				break;
		}
		// result.push(`<string  key="${keyToCheck}" value="${obj}"/>`);
	}

	return result;
}

function findAllValuesByKey(obj, key) {
	let results = [];

	function recursiveSearch(o) {
		if (typeof o !== "object" || o === null) return;

		if (key in o) {
			results.push(o[key]);
		}

		for (let k in o) {
			if (typeof o[k] === "object") {
				recursiveSearch(o[k]);
			} else if (Array.isArray(o[k])) {
				o[k].forEach((item) => recursiveSearch(item));
			}
		}
	}

	recursiveSearch(obj);
	return results;
}
app.post("/jsonocel-download", (req, res) => {
	const jsonToDownload = req.body.ocel;
	const filename = "ocelLogs.jsonocel";

	fs.writeFileSync(filename, JSON.stringify(jsonToDownload, null, 2));

	const formattedFileName = encodeURIComponent(filename);
	res.setHeader(
		"Content-Disposition",
		`attachment; filename="${formattedFileName}"`
	);
	res.setHeader("Content-Type", "application/octet-stream");

	res.sendFile(path.resolve(filename), (err) => {
		if (err) {
			// Handle error if file sending fails
			console.error(err);
			res.status(err.status).end();
		} else {
			fs.unlinkSync(path.resolve(filename));
			console.log("File sent successfully");
		}
	});
});

app.post("/csvocel-download", (req, res) => {
	const ocel = req.body.ocel;
	const filename = "ocelLogs.csv";

	const array = Array(1).fill(ocel);
	const csvRow = jsonToCsv.json2csv(array, { arrayIndexesAsKeys: true });

	fs.writeFileSync(filename, csvRow);

	const formattedFileName = encodeURIComponent(filename);
	res.setHeader(
		"Content-Disposition",
		`attachment; filename="${formattedFileName}"`
	);
	res.setHeader("Content-Type", "application/octet-stream");

	res.sendFile(path.resolve(filename), (err) => {
		if (err) {
			// Handle error if file sending fails
			console.error(err);
			res.status(err.status).end();
		} else {
			fs.unlinkSync(path.resolve(filename));
			console.log("File sent successfully");
		}
	});
	// fs.writeFileSync(filename, csvRow)
});

app.get("/", (req, res) => {
	res.send("Welcome to the Home Page!");
});

// Route: About Page
app.get("/about", (req, res) => {
	res.send("This is the About Page");
});

// Route: Dynamic Route with Parameter
app.get("/user/:id", (req, res) => {
	res.send(`User ID: ${req.params.id}`);
});

app.post("/api/data", async (req, res) => {
	const type = req.query.type;
	const query = req.body;
	try {
		await connectDB("Mainnet");
		const data = await queryData({ type: type, query: query });
		await mongoose.disconnect();
		res.json(data);
	} catch (error) {
		console.error("Error fetching data:", error);
		res.status(500).json({ error: error.message });
	}
});

// Start the server
app.listen(port, () => {
	console.log(`Server running at http://localhost:${port}`);
});

// docker stop $(docker ps -q)
// docker rm $(docker ps -aq)
// docker rmi $(docker images -q)
// docker volume rm $(docker volume ls -q)
// docker network rm $(docker network ls -q | grep -v "bridge\|host\|none")
// docker system prune -a --volumes -f
