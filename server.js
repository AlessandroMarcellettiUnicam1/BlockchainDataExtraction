const express = require("express");
const cors = require("cors");
const path = require("path");
const bodyParser = require("body-parser");
const fs = require("fs");
const { stringify } = require("csv-stringify");
const multer = require("multer");
const jsonToCsv = require("json-2-csv");
const jp = require("jsonpath");

//0000000000000000000000000000000000000000000000000000000000
const readline = require('readline');
const os = require('os');

const { chain } = require("stream-chain");
const { parser } = require("stream-json");
const { streamArray } = require("stream-json/streamers/StreamArray");
//0000000000000000000000000000000000000000000000000000000000

// const { getAllTransactions } = require("./services/main");
const { getOneTransaction } = require("./services/mainOnyTransaction")
const { getAllTransactions }=require("./services/ExtractionModule/mainWithOption")
const app = express();
const upload = multer({ dest: "uploads/" });
const port = 8000;
const { setEventTypes } = require("./ocelMapping/eventTypes");
const {queryJsonPath} = require("./jsonQuery/jsonQuery");

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
app.use(bodyParser.json({ limit: "100mb" }));

const { searchTransaction, queryData } = require("./query/query");
const { connectDB } = require("./config/db");
const { setObjectTypes } = require("./ocelMapping/objectTypes/objectTypes");
const { default: mongoose } = require("mongoose");
const { fetchTransactions } = require("./query/transactionQuery");
const {
	formatTransactionForTreeView,
	extractEventDataAsJson,
	formatStorageHistoryForVisualization,
	formatCallsForTreeView,
    formatInternalTransactionsForTreeView,
    formatCallForTreeView
} = require("./query/queryFunctions");
const { error } = require("console");
const { processSimulation } = require("./services/ExtractionModule/simulationOrchestrator");
const { getMempoolTxs, getSequentialMempoolTxs, simulateMempoolTxs } = require("./services/ExtractionModule/mempoolSimulator");
const { net } = require("web3");

function flattenTransaction(inputData) {
	 const result = [];
  
  // Handle array of transactions
  const transactions = Array.isArray(inputData) ? inputData : [inputData];
  for (const transaction of transactions) {
    // Extract parent transaction info (everything except _id, timestamp, and calls)
    const parentInfo = {
      functionName: transaction.functionName,
      transactionHash: transaction.transactionHash,
      contractAddress: transaction.contractAddress,
      sender: transaction.sender,
      gasUsed: transaction.gasUsed,
      blockNumber: transaction.blockNumber,
      value: transaction.value,
      inputs: transaction.inputs,
      storageState: transaction.storageState
    };
    
    // Recursively process internal transactions
    function processInternalTxs(calls) {
      if (!calls || calls.length === 0) {
		result.push({
			...parentInfo,
			calls:[]
		})
        return;
      }
      
      for (const tx of calls) {
        // Create a copy of the transaction without nested calls
        const flatTx = { ...tx };
        
        // Store nested calls temporarily
        const nestedCalls = flatTx.calls;
        
        // Replace calls with empty array
        flatTx.calls = flatTx.calls ? [] : undefined;
        
        // Create a new object with parent info and this transaction
        const flattenedObject = {
          ...parentInfo,
          calls: [flatTx]
        };
        
        result.push(flattenedObject);
        
        // Recursively process nested calls
        if (nestedCalls && nestedCalls.length > 0) {
          processInternalTxs(nestedCalls);
        }
      }
    }
    
    // Start processing from the top-level calls
    processInternalTxs(transaction.calls);
  }
  
  return result;
}

// app.post("/api/generateGraph", (req, res) => {
// 	const jsonData = req.body.jsonData;
// 	const edges = req.body.edges;
// 	const nodesSet = new Map();
// 	let edgesArray = []; 
// 	const parentFiledMapping=['functionName','transactionHas','contractAddress','sender','gasUsed','blockNumber','value','inputs','storageState'];
// 	const falltendeObject=flattenTransaction(jsonData);
	
// 	const addNodeIfMissing = (id, label, shape, color, tx, key) => {
// 		if (!nodesSet.has(id.toLowerCase())) {
// 			nodesSet.set(id.toLowerCase(), {
// 				id: id.toLowerCase(),
// 				size: 10,
// 				hidden: false,
// 				label: label,
// 				keyUsed: key,
//                 cluster: key,
// 				x: Math.random() * 100,
// 				y: Math.random() * 100,
// 				color: color,
// 				details: tx,
// 			});
// 		}
// 	};
	
// 	// Modified: Direction matters now - from -> to is different from to -> from
// 	const addEdgeIfMissing = (from, to, colorEdge,edgesCount,alphaLetter) => {
// 		let id = `${from.toLowerCase()}-${to.toLowerCase()}`; // Changed to -> for clarity
// 		if (!edgesArray.some((edge) => edge.id.toLowerCase() === id.toLowerCase())) {
// 			edgesArray.push({
// 				id: id.toLowerCase(),
// 				from: from.toLowerCase(),
// 				to: to.toLowerCase(),
// 				label: `${alphaLetter}-${edgesCount}`,
// 				color: colorEdge,
// 				value: 1,
// 				size: 1,
// 				type: 'arrow', // Added: indicates this is a directed edge
// 			});
// 		} else {
// 			edgesArray.forEach((edge) => {
// 				if (edge.id.toLowerCase() === id.toLowerCase()) {
// 					edge.value++;
// 					edge.size = edge.value;
// 				}
// 			});
// 		}
// 	};
	
// 	const getNodeId = (item) => {
// 		if (typeof item === "object" && item !== null) {
// 			return JSON.stringify(item);
// 		}
// 		return String(item);
// 	};
	
// 	const getRandomColor = () => {
// 		return (
// 			"#" + (((1 << 24) * Math.random()) | 0).toString(16).padStart(6, "0")
// 		);
// 	};
// 	const alpha="ABCDEFGHIJKLMNOPQRSTUVWXYZ";
// 	edges.forEach((edge) => {

// 		let alphaLetter=alpha.charAt(edges.indexOf(edge));
// 		let edgesCount=1;
//         let from = edge.from;
//         let to = edge.to;
// 		const colorFrom = getRandomColor();
// 		const colorTo = getRandomColor();
// 		const colorEdge = getRandomColor();
// 		const flagForMapping = parentFiledMapping.includes(from) || parentFiledMapping.includes(to);
// 		const transactionMapping = flagForMapping ? jsonData : falltendeObject;
		
// 		transactionMapping.forEach((tx) => {.isArray(fromResults) ? fromResults : [fromResults];
// 			const toItems = Array.isArray(toResults) ? toResults : [toResults];
			
// 			fromItems.fo
//             let fromResults = queryJsonPath(tx, from);
//             let toResults = queryJsonPath(tx, to);
// 			const fromItems = ArrayrEach((fromItem) => {
// 				const idFrom = getNodeId(fromItem);
// 				const labelFrom = idFrom.slice(0, 64);
// 				addNodeIfMissing(idFrom, labelFrom, "ellipse", colorFrom, tx, from);

// 				toItems.forEach((toItem) => {
// 					const idTo = getNodeId(toItem);
// 					const labelTo = idTo.slice(0, 64);
// 					addNodeIfMissing(idTo, labelTo, "box", colorTo, tx, to);
// 					addEdgeIfMissing(idFrom, idTo, colorEdge,edgesCount,alphaLetter); // Direction: from -> to
// 					edgesCount++;
// 				});
// 			});
// 		});
// 	});

// 	const nodes = Array.from(nodesSet.values()).map((obj, index) => ({
// 		key: obj.id,
// 		attributes: {
// 			label: `${obj.label}`,
// 			size: 10,
// 			details: obj.details,
// 			keyUsed: obj.keyUsed,
// 			color: obj.color,
//             cluster: obj.cluster,
// 			x: obj.x,
// 			y: obj.y,
// 		},
// 	}));

// 	const colorLegendData = [];
// 	const colorSet = new Set();
// 	nodes.forEach((node) => {
// 		if (node.attributes.color && !colorSet.has(node.attributes.color)) {
// 			colorLegendData.push({
// 				color: node.attributes.color,
// 				keyAssigned: node.attributes.keyUsed,
// 			});
// 			colorSet.add(node.attributes.color);
// 		}
// 	});

// 	const edgeValues = edgesArray.map((edge) => edge.value);
// 	const maxEdgeValue = Math.max(...edgeValues);
// 	const minEdgeValue = Math.min(...edgeValues);
// 	const scaleEdgeValue = (value) => {
// 		if (maxEdgeValue === minEdgeValue) return 1;
// 		return ((value - minEdgeValue) / (maxEdgeValue - minEdgeValue)) * 4 + 1;
// 	};

// 	const newEdges = edgesArray.map((obj, index) => ({
// 		key: obj.id,
// 		source: obj.from,
// 		target: obj.to,
// 		attributes: {
// 			value: obj.value,
// 			size: scaleEdgeValue(obj.value),
// 			color: obj.color,
// 			label:obj.label,
// 			type: 'arrow', 
// 			x: Math.random() * 100,
// 			y: Math.random() * 100,
// 		},
// 	}));

// 	res.send({
// 		nodes,
// 		edges: newEdges,
// 		colorLegend: colorLegendData,
// 		edgeFilter: edgeValues,
// 	});
// });
// app.post("/api/generateGraph", (req, res) => {
// 	const jsonData = req.body.jsonData;
// 	const edges = req.body.edges;
// 	const nodesSet = new Map();
// 	let edgesArray = []; 
// 	const parentFiledMapping=['functionName','transactionHas','contractAddress','sender','gasUsed','blockNumber','value','inputs','storageState'];
// 	const falltendeObject=flattenTransaction(jsonData);
	
// 	const addNodeIfMissing = (id, label, shape, color, tx, key) => {
// 		if (!nodesSet.has(id.toLowerCase())) {
// 			nodesSet.set(id.toLowerCase(), {
// 				id: id.toLowerCase(),
// 				size: 10,
// 				hidden: false,
// 				label: label,
// 				keyUsed: key,
//                 cluster: key,
// 				x: Math.random() * 100,
// 				y: Math.random() * 100,
// 				color: color,
// 				details: tx,
// 			});
// 		}
// 	};
	
// 	// FIXED: For MultiGraph, each edge needs a unique key but can share source/target
// 	const addEdgeIfMissing = (from, to, colorEdge, edgesCount, alphaLetter) => {
// 		let labelId = `${alphaLetter}-${edgesCount}`;
// 		// CRITICAL: Use a unique ID for each edge instance (for MultiGraph)
// 		let uniqueId = `${from.toLowerCase()}-${to.toLowerCase()}-${labelId}`;
		
// 		// Check if there's ANY edge in the same direction (regardless of label)
// 		const sameDirectionEdges = edgesArray.filter(
// 			(edge) => edge.from.toLowerCase() === from.toLowerCase() && 
// 			         edge.to.toLowerCase() === to.toLowerCase()
// 		);
		
// 		// Check if there's ANY edge in the reverse direction
// 		const reverseDirectionEdges = edgesArray.filter(
// 			(edge) => edge.from.toLowerCase() === to.toLowerCase() && 
// 			         edge.to.toLowerCase() === from.toLowerCase()
// 		);
		
// 		// Determine if this edge should be curved
// 		const shouldBeCurved = reverseDirectionEdges.length > 0 || sameDirectionEdges.length > 0;
		
// 		// Calculate curvature based on how many edges already exist in this direction
// 		let curvature = 0;
// 		if (shouldBeCurved) {
// 			// For multiple edges in same direction, spread them out
// 			const edgeIndex = sameDirectionEdges.length;
// 			// Alternate between positive and negative curvature
// 			curvature = edgeIndex % 2 === 0 ? 0.5 + (edgeIndex * 0.15) : -(0.5 + (edgeIndex * 0.15));
// 		}
// 		if(from=="transfer" && to=="0x9b5a5c5800c91af9c965b3bf06ad29caa6d00f9b"){
// 			console.log(labelId)
// 		}
		
// 		edgesArray.push({
// 			id: uniqueId,
// 			from: from.toLowerCase(),
// 			to: to.toLowerCase(),
// 			label: labelId,
// 			color: colorEdge,
// 			value: 1,
// 			size: 1,
// 			type: shouldBeCurved ? 'curved' : 'straight',
// 			curvature: curvature,
// 		});
		
// 		// Update all reverse edges to be curved if they aren't already
// 		if (reverseDirectionEdges.length > 0 && sameDirectionEdges.length === 0) {
// 			reverseDirectionEdges.forEach((reverseEdge, idx) => {
// 				reverseEdge.type = 'curved';
// 				// Give reverse edges opposite curvature
// 				reverseEdge.curvature = idx % 2 === 0 ? -0.3 : 0.3;
// 			});
// 		}
// 	};
	
// 	const getNodeId = (item) => {
// 		if (typeof item === "object" && item !== null) {
// 			return JSON.stringify(item);
// 		}
// 		return String(item);
// 	};
	
// 	const getRandomColor = () => {
// 		return (
// 			"#" + (((1 << 24) * Math.random()) | 0).toString(16).padStart(6, "0")
// 		);
// 	};
	
// 	const alpha="ABCDEFGHIJKLMNOPQRSTUVWXYZ";
// 	edges.forEach((edge) => {
// 		let alphaLetter = alpha.charAt(edges.indexOf(edge));
// 		let edgesCount = 1;
//         let from = edge.from;
//         let to = edge.to;
// 		const colorFrom = getRandomColor();
// 		const colorTo = getRandomColor();
// 		const colorEdge = getRandomColor();
// 		const flagForMapping = parentFiledMapping.includes(from) || parentFiledMapping.includes(to);
// 		const transactionMapping = flagForMapping ? jsonData : falltendeObject;
		
// 		transactionMapping.forEach((tx) => {
//             let fromResults = queryJsonPath(tx, from);
//             let toResults = queryJsonPath(tx, to);
// 			const fromItems = Array.isArray(fromResults) ? fromResults : [fromResults];
// 			const toItems = Array.isArray(toResults) ? toResults : [toResults];
			
// 			fromItems.forEach((fromItem) => {
// 				const idFrom = getNodeId(fromItem);
// 				const labelFrom = idFrom.slice(0, 64);
// 				addNodeIfMissing(idFrom, labelFrom, "ellipse", colorFrom, tx, from);

// 				toItems.forEach((toItem) => {
// 					const idTo = getNodeId(toItem);
// 					const labelTo = idTo.slice(0, 64);
// 					addNodeIfMissing(idTo, labelTo, "box", colorTo, tx, to);
// 					addEdgeIfMissing(idFrom, idTo, colorEdge, edgesCount, alphaLetter);
// 					edgesCount++;
// 				});
// 			});
// 		});
// 	});

// 	const nodes = Array.from(nodesSet.values()).map((obj, index) => ({
// 		key: obj.id,
// 		attributes: {
// 			label: `${obj.label}`,
// 			size: 10,
// 			details: obj.details,
// 			keyUsed: obj.keyUsed,
// 			color: obj.color,
//             cluster: obj.cluster,
// 			x: obj.x,
// 			y: obj.y,
// 		},
// 	}));

// 	const colorLegendData = [];
// 	const colorSet = new Set();
// 	nodes.forEach((node) => {
// 		if (node.attributes.color && !colorSet.has(node.attributes.color)) {
// 			colorLegendData.push({
// 				color: node.attributes.color,
// 				keyAssigned: node.attributes.keyUsed,
// 			});
// 			colorSet.add(node.attributes.color);
// 		}
// 	});

// 	const edgeValues = edgesArray.map((edge) => edge.value);
// 	const maxEdgeValue = Math.max(...edgeValues);
// 	const minEdgeValue = Math.min(...edgeValues);
// 	const scaleEdgeValue = (value) => {
// 		if (maxEdgeValue === minEdgeValue) return 1;
// 		return ((value - minEdgeValue) / (maxEdgeValue - minEdgeValue)) * 4 + 1;
// 	};

// 	const newEdges = edgesArray.map((obj) => ({
// 		key: obj.id, // CRITICAL: Each edge must have unique key for MultiGraph
// 		source: obj.from,
// 		target: obj.to,
// 		attributes: {
// 			value: obj.value,
// 			size: scaleEdgeValue(obj.value),
// 			color: obj.color,
// 			label: obj.label,
// 			type: obj.type, // Preserved from our logic
// 			curvature: obj.curvature, // Preserved from our logic
// 		},
// 	}));

// 	res.send({
// 		nodes,
// 		edges: newEdges,
// 		colorLegend: colorLegendData,
// 		edgeFilter: edgeValues,
// 	});
// });

app.post("/api/generateGraph", (req, res) => {
	const jsonData = req.body.jsonData;
	const edges = req.body.edges;
	//const filters=req.body.filters;
	const nodesSet = new Map();
	let edgesArray = []; 
	const parentFiledMapping=['functionName','transactionHas','contractAddress','sender','gasUsed','blockNumber','value','inputs','storageState'];
	const falltendeObject=flattenTransaction(jsonData);
	const addNodeIfMissing = (id, label, shape, color, tx, key) => {
		if (!nodesSet.has(id.toLowerCase())) {
			nodesSet.set(id.toLowerCase(), {
				id: id.toLowerCase(),
				size: 10,
				hidden: false,
				label: label,
				keyUsed: key,
                cluster: key,
				x: Math.random() * 100,
				y: Math.random() * 100,
				color: color,
				details: tx,
			});
		}
	};
	
	// Modified: Direction matters now - from -> to is different from to -> from
	const addEdgeIfMissing = (from, to, colorEdge, edgesCount, alphaLetter) => {
		let labelId=`${alphaLetter}-${edgesCount}`
		let id = `${from.toLowerCase()}-${to.toLowerCase()}`; 
		let reverseId = `${to.toLowerCase()}-${from.toLowerCase()}`; // Check for reverse edge
		// Check if this exact edge already exists
		const existingEdge = edgesArray.find((edge) => edge.id.toLowerCase() === id.toLowerCase() );
		
		if (existingEdge) {
			// Edge exists in same direction - increment value
			existingEdge.value++;
			existingEdge.size = existingEdge.value;
			existingEdge.label+=", "+labelId;
			
		} else {
			// Check if reverse edge exists
			const reverseEdge = edgesArray.find((edge) => edge.id.toLowerCase() === reverseId.toLowerCase());
			
			// CHANGED: Use 'curved' type when there's a reverse edge, 'straight' otherwise
			
			edgesArray.push({
				id: id.toLowerCase(),
				from: from.toLowerCase(),
				to: to.toLowerCase(),
				label: `${alphaLetter}-${edgesCount}`,
				color: colorEdge,
				value: 1,
				size: 1,
				// Use 'curved' type when bidirectional, 'straight' when unidirectional
				type: reverseEdge ? 'curved' : 'straight',
				// Positive curvature for this direction when bidirectional
				curvature: reverseEdge ? 0.5 : 0,
			});
			
			// If reverse edge exists, also make it curved
			if (reverseEdge) {
				reverseEdge.type = 'curved';
				reverseEdge.curvature = 0.1; // Negative curvature for opposite direction
			}
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
	const alpha="ABCDEFGHIJKLMNOPQRSTUVWXYZ";
	edges.forEach((edge) => {

		let alphaLetter=alpha.charAt(edges.indexOf(edge));
		let edgesCount=1;
        let from = edge.from;
        let to = edge.to;
		const colorFrom = getRandomColor();
		const colorTo = getRandomColor();
		const colorEdge = getRandomColor();
		const flagForMapping = parentFiledMapping.includes(from) || parentFiledMapping.includes(to);
		const transactionMapping = flagForMapping ? jsonData : falltendeObject;
		
		transactionMapping.forEach((tx) => {
			/*if(filters.transactionHash.length===0 || filters.transactionHash.includes(tx.transactionHash)){
				if (tx.internalTxs !== undefined) {
					tx.calls = tx.internalTxs;
					delete tx.internalTxs;
				}*/
				let fromResults = queryJsonPath(tx, from);
				let toResults = queryJsonPath(tx, to);
				const fromItems = Array.isArray(fromResults) ? fromResults : [fromResults];
				const toItems = Array.isArray(toResults) ? toResults : [toResults];
				
				fromItems.forEach((fromItem) => {
					const idFrom = getNodeId(fromItem);
					const labelFrom = idFrom.slice(0, 64);
					addNodeIfMissing(idFrom, labelFrom, "ellipse", colorFrom, tx, from);
	
					toItems.forEach((toItem) => {
						const idTo = getNodeId(toItem);
						const labelTo = idTo.slice(0, 64);
						addNodeIfMissing(idTo, labelTo, "box", colorTo, tx, to);
						addEdgeIfMissing(idFrom, idTo, colorEdge, edgesCount, alphaLetter);
						edgesCount++;
					});
				});
            //}
		});
	});

	const nodes = Array.from(nodesSet.values()).map((obj, index) => ({
		key: obj.id,
		attributes: {
			label: `${obj.label}`,
			size: 10,
			details: obj.details,
			keyUsed: obj.keyUsed,
			color: obj.color,
            cluster: obj.cluster,
			x: obj.x,
			y: obj.y,
		},
	}));

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
			color: obj.color,
			label: obj.label,
			// CRITICAL: Use the type determined by bidirectionality
			type: obj.type, // 'curved' for bidirectional, 'straight' for unidirectional
			curvature: obj.curvature, // Positive/negative for curve direction
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

//OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO

app.post("/api/xes/keys", upload.single("jsonFile"), async (req, res) => {
	console.log("HIT /api/xes/keys");
	try {
		if (!req.file) {
			return res.status(400).json({ message: "Missing jsonFile" });
		}

		// Legge a flusso solo il primo oggetto transazione del file JSON
		const firstItem = await getFirstJsonObject(req.file.path);

		if (!firstItem || typeof firstItem !== "object") {
			return res.status(400).json({ message: "Invalid JSON structure" });
		}

		
		const keys = Array.from(extractKeysFromSample(firstItem)).sort();
		res.json({ keys });

	} catch (error) {
		console.error("Error extracting keys:", error);
		res.status(500).json({
			message: error.message || "Impossible to extract keys from file",
		});
	} finally {
		if (req.file?.path) {
			fs.unlink(req.file.path, () => {});
		}
	}
});

// Funzione helper per la chiamata
function getFirstJsonObject(filePath) {
	return new Promise((resolve, reject) => {
		const rl = readline.createInterface({
			input: fs.createReadStream(filePath),
			crlfDelay: Infinity
		});

		let buffer = "";
		let openBrackets = 0;
		let foundObject = false;

		rl.on('line', (line) => {
			const trimmed = line.trim();
			if (!trimmed) return;

			// Rimuove la parentesi dell'array iniziale se presente sulla prima riga
			if (!foundObject && trimmed.startsWith('[')) {
				buffer += trimmed.substring(1);
			} else {
				buffer += line + "\n";
			}

			// Monitora l'apertura e chiusura delle parentesi graffe
			for (let i = 0; i < line.length; i++) {
				if (line[i] === '{') {
					openBrackets++;
					foundObject = true;
				} else if (line[i] === '}') {
					openBrackets--;
				}
			}

			// Se l'oggetto principale è completo le graffe si azzerano
			if (foundObject && openBrackets === 0) {
				rl.close();
			}
		});

		rl.on('close', () => {
			try {
				let jsonString = buffer.trim();
				
				// Rimuove la virgola finale se lo stream si è interrotto dopo la chiusura del primo oggetto
				if (jsonString.endsWith(',')) {
					jsonString = jsonString.slice(0, -1);
				}

				const parsed = JSON.parse(jsonString);
				resolve(parsed);
			} catch (err) {
				reject(new Error("Impossibile fare il parsing del primo elemento JSON"));
			}
		});

		rl.on('error', (err) => reject(err));
	});
}

 app.post("/api/xes", upload.single("jsonFile"), async (req, res) => {
  try {
    console.log("========== START /api/xes ==========");

    if (!req.file) {
      return res.status(400).json({ message: "Missing jsonFile" });
    }

    console.log("Uploaded file:", req.file.originalname);
    const stats = fs.statSync(req.file.path);
    console.log("File size:", (stats.size / 1024 / 1024).toFixed(2), "MB");

    const objectsToXes = JSON.parse(req.body.objectsToXes || "{}");
    const { caseId, activityKey, timestamp } = objectsToXes;

    console.log("Starting Streaming XES conversion...");

    // Esegue la conversione leggendo direttamente il file in streaming
    const outputPath = await jsonToXes(
      req.file.path,
      caseId?.value,
      activityKey?.value,
      timestamp?.value
    );

    console.log("XES successfully generated:", outputPath);
    
    // Invia il file convertito al client per il download
    res.download(outputPath);

  } catch (error) {
    console.error("Error in /api/xes:", error);
    res.status(500).json({
      message: error.message || "Failed to create XES"
    });
  } finally {
    // Il file viene rimosso solo dopo che res.download ha finito (gestito internamente o nel callback)
    // Per sicurezza con res.download è meglio pulire il file dopo l'invio:
    if (req.file?.path) {
      fs.unlink(req.file.path, () => {});
    }
  }
});
//OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO

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

app.post("/api/uploadDataInDb",async (req,res)=>{
	try{
		try {
			await connectDB("Mainnet")
			// Read JSON file
			
			let documents = JSON.parse(req.body.jsonLog);
			
			// Normalize and insert by contractAddress
			for (const doc of documents) {
				if (!doc.contractAddress) {
					// console.warn("Skipping doc without contractAddress:", doc);
					continue;
				}
				if(doc["_id"]){
					doc["_id"]=doc["_id"]["$oid"]
				}
				if(doc["timestamp"]){
					doc["timestamp"]=doc["timestamp"]["$date"]
				}
				try{
					const collectionName = doc.contractAddress.toLowerCase(); // use lowercase for safety
					const collection = mongoose.connection.db.collection(collectionName);
					await collection.insertOne(doc);
				}catch (e){
					console.log("error: ",e)
				}
			}
		} catch (err) {
			console.error("Error importing documents:", err);
		}
		res.send(200)
		await mongoose.disconnect()
	}catch(error){
		console.error("Error fetching activity data:", error);
		res.status(500).json({ error: error.message });
	}
});

// Route: Home Page
/*app.post("/submit", upload.single("file"), async (req, res) => {
    // Old parameters (standard) con option incluso
    const oldParams = {
        contractName: req.body.contractName,
        contractAddress: req.body.contractAddress,
        implementationContractAddress: req.body.implementationContractAddress,
        fromBlock: req.body.fromBlock,
        toBlock: req.body.toBlock,
        network: req.body.network,
        filters: JSON.parse(req.body.filters),
        extractionType: req.body.extractionType,
        option: {}  // poi verra valorizzato sotto
    };

    // Nuova gestione option in base a extractionType
    switch(oldParams.extractionType){
        case ("0"):
            oldParams.option = {
                default:1,
                internalStorage:1,
                internalTransaction:1
            };
            break;
        case("1"):
            oldParams.option = {
                default:1,
                internalStorage:1,
                internalTransaction:0
            };
            break;
        case("2"):
            oldParams.option = {
                default:0,
                internalStorage:1,
                internalTransaction:1
            };
            break;
        default:
            oldParams.option = {};
    }
    console.log(`Start Block: ${oldParams.fromBlock}`);
    console.log(`End Block: ${oldParams.toBlock}`);
    console.log(`contract Address: ${oldParams.contractAddress}`);
    console.log(`implementation contract Address: ${oldParams.implementationContractAddress}`);
    console.log(`Contract name: ${oldParams.contractName}`);

    let smartContractData = null;
    if (req.file) {
        smartContractData = await fs.promises.readFile(req.file.path, "utf-8");
        await fs.promises.unlink(req.file.path);
    }

    oldParams.smartContract = smartContractData;

    try {
        const logs = await getAllTransactions(oldParams, null);
        res.send(logs);
    } catch(e) {
        console.error(e);
        res.status(500).send(e.message || "Internal Error");
    }
});

app.post("/submitInternal", upload.single("file"), async (req, res) => {
    const newParams = {
        contractAddressesFrom: JSON.parse(req.body.contractAddressesFrom || "[]"),
        contractAddressesTo: JSON.parse(req.body.contractAddressesTo || "[]"),
        fromBlock: req.body.fromBlock,
        toBlock: req.body.toBlock,
        network: req.body.network,
        filters: JSON.parse(req.body.filters), // se ti serve lato interno, altrimenti rimuovi
        contractName: req.body.contractName,
        implementationContractAddress: req.body.implementationContractAddress
    };

    if (!newParams.contractAddressesFrom.length || !newParams.contractAddressesTo.length) {
        return res.status(400).json({ message: "Devi fornire almeno un indirizzo nei campi contractAddressesFrom e contractAddressesTo." });
    }

    console.log("Start Block:", newParams.fromBlock);
    console.log("End Block:", newParams.toBlock);
    console.log("contractAddressesFrom:", newParams.contractAddressesFrom);
    console.log("contractAddressesTo:", newParams.contractAddressesTo);
    console.log("Contract name:", newParams.contractName);

    let smartContractData = null;
    if (req.file) {
        smartContractData = await fs.promises.readFile(req.file.path, "utf-8");
        await fs.promises.unlink(req.file.path);
    }

    newParams.smartContract = smartContractData;

    try {
        const logs = await getAllTransactions(null, newParams);
        res.send(logs);
    } catch(e) {
        console.error(e);
        res.status(500).send(e.message || "Internal Error");
    }
});*/

app.post("/submit", upload.single("file"), async (req, res) => {
    try {
        if (req.body.contractAddress) {
            const params = {
                contractName: req.body.contractName,
                contractAddress: req.body.contractAddress,
                implementationContractAddress: req.body.implementationContractAddress,
                fromBlock: req.body.fromBlock,
                toBlock: req.body.toBlock,
                network: req.body.network,
                filters: JSON.parse(req.body.filters),
                extractionType: req.body.extractionType,
				parameterForExtraction: req.body.parameterForExtraction,
                option: {},
                smartContract: null
            };
			console.log("prima dello swit",params)
            switch (params.extractionType) {
                case "0":
                    params.option = { default: 1, internalStorage: 1, internalTransaction: 1 ,parameterForExtraction:0};
                    break;
                case "1":
                    params.option = { default: 1, internalStorage: 1, internalTransaction: 0,parameterForExtraction:0 };
                    break;
                case "2":
                    params.option = { default: 0, internalStorage: 1, internalTransaction: 1 ,parameterForExtraction:0};
                    break;
				case "3":
					params.option = { default: 1, internalStorage: 1, internalTransaction: 1 ,storageInternalTransactio:1};
					break;
                default:
                    params.option = { default: 1, internalStorage: 1, internalTransaction: 1 ,storageInternalTransactio:0};
            }
			console.log("submint",params.option)
            if (req.file) {
                params.smartContract = await fs.promises.readFile(req.file.path, "utf-8");
                await fs.promises.unlink(req.file.path);
            }

            const logs = await getAllTransactions(params, null);
            return res.send(logs);

        } else if (req.body.contractAddressesFrom) {
            const params = {
                contractAddressesFrom: JSON.parse(req.body.contractAddressesFrom || "[]"),
                contractAddressesTo: JSON.parse(req.body.contractAddressesTo || "[]"),
                fromBlock: req.body.fromBlock,
                toBlock: req.body.toBlock,
                network: req.body.network,
                filters: JSON.parse(req.body.filters),
                contractName: req.body.contractName,
                implementationContractAddress: req.body.implementationContractAddress,
				extractionType: req.body.extractionType,
				parameterForExtraction: req.body.parameterForExtraction,
                option: {},
                smartContract: null
            };
			switch (params.extractionType) {
                case "0":
                    params.option = { default: 1, internalStorage: 1, internalTransaction: 1 ,parameterForExtraction:0};
                    break;
                case "1":
                    params.option = { default: 1, internalStorage: 1, internalTransaction: 0,parameterForExtraction:0 };
                    break;
                case "2":
                    params.option = { default: 0, internalStorage: 1, internalTransaction: 1 ,parameterForExtraction:0};
                    break;
				case "3":
					params.option = { default: 1, internalStorage: 1, internalTransaction: 1 ,storageInternalTransactio:1};
					break;
                default:
                    params.option = { default: 1, internalStorage: 1, internalTransaction: 1 ,storageInternalTransactio:0};
            }
            if (req.file) {
                params.smartContract = await fs.promises.readFile(req.file.path, "utf-8");
                await fs.promises.unlink(req.file.path);
            }

            const logs = await getAllTransactions(null, params);
            return res.send(logs);

        } else {
            return res.status(400).send("Parameters are not given correctly");
        }
    } catch (e) {
        console.error(e);
        res.status(500).send(e.message || "Internal Error");
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

//OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO

function extractKeysFromSample(obj, prefix = "", keys = new Set(), depth = 0) {
	if (obj == null || depth > 3) return keys;

	if (Array.isArray(obj)) {
		if (obj.length > 0) {
			extractKeysFromSample(obj[0], prefix, keys, depth + 1);
		}
		return keys;
	}

	if (typeof obj !== "object") return keys;

	for (const [key, value] of Object.entries(obj)) {
		const fullKey = prefix ? `${prefix}.${key}` : key;
		keys.add(fullKey);

		if (value && typeof value === "object") {
			extractKeysFromSample(value, fullKey, keys, depth + 1);
		}
	}

	return keys;
}

const LIST_OBJECT_FIELDS = new Set(["events", "internalTxs", "inputs", "calls", "storageState"]);

function escapeXmlText(value) {
	return String(value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

// Per attributi XML delimitati con apici singoli.
// Le virgolette doppie restano leggibili dentro il JSON.
// Escapiamo solo gli apostrofi.
function escapeXmlAttrSingleQuoted(value) {
	return escapeXmlText(value).replace(/'/g, "&apos;");
}

function isPlainObject(value) {
	return (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.prototype.toString.call(value) === "[object Object]"
	);
}

function isMongoScalarObject(value) {
	if (!isPlainObject(value)) return false;
	const keys = Object.keys(value);
	if (keys.length !== 1) return false;
	return ["$oid", "$date", "$numberInt", "$numberLong", "$numberDouble", "$numberDecimal"].includes(keys[0]);
}

function normalizeMongoScalar(value) {
	if (!isMongoScalarObject(value)) return value;

	if ("$oid" in value) return value.$oid;
	if ("$date" in value) return value.$date;
	if ("$numberInt" in value) return Number.parseInt(value.$numberInt, 10);
	if ("$numberLong" in value) return Number(value.$numberLong);
	if ("$numberDouble" in value) return Number(value.$numberDouble);
	if ("$numberDecimal" in value) return Number(value.$numberDecimal);

	return value;
}

function normalizeTimestamp(value) {
	if (value == null) return null;

	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value.toISOString();
	}

	if (isPlainObject(value) && value.$date) {
		return normalizeTimestamp(value.$date);
	}

	const s = String(value).trim();
	if (!s) return null;

	if (/^[-+]?\d+$/.test(s)) {
		const n = Number(s);
		const d = Math.abs(n) >= 1e12 ? new Date(n) : new Date(n * 1000);
		return Number.isNaN(d.getTime()) ? null : d.toISOString();
	}

	const d = new Date(s);
	if (!Number.isNaN(d.getTime())) {
		return d.toISOString();
	}

	return null;
}

function serializeCompact(value) {
	if (value == null) return "";
	if (typeof value === "string") return value;
	if (value instanceof Date) return value.toISOString();
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

function xesAttribute(key, value) {
	const normalized = normalizeMongoScalar(value);
	if (normalized == null) return null;

	if (normalized instanceof Date) {
		return `\t\t\t<date key='${escapeXmlAttrSingleQuoted(key)}' value='${escapeXmlAttrSingleQuoted(normalized.toISOString())}'/>`;
	}

	if (typeof normalized === "boolean") {
		return `\t\t\t<boolean key='${escapeXmlAttrSingleQuoted(key)}' value='${String(normalized).toLowerCase()}'/>`;
	}

	if (typeof normalized === "number" && Number.isInteger(normalized)) {
		return `\t\t\t<int key='${escapeXmlAttrSingleQuoted(key)}' value='${normalized}'/>`;
	}

	if (typeof normalized === "number") {
		return `\t\t\t<float key='${escapeXmlAttrSingleQuoted(key)}' value='${normalized}'/>`;
	}

	// Oggetti e array diventano una stringa JSON compatta.
	const compact = serializeCompact(normalized);
	return `\t\t\t<string key='${escapeXmlAttrSingleQuoted(key)}' value='${escapeXmlAttrSingleQuoted(compact)}'/>`;
}

function flattenRowForXes(input, prefix = "", out = {}) {
	const value = normalizeMongoScalar(input);

	if (value == null) return out;

	// Array sempre compattati
	if (Array.isArray(value)) {
		if (prefix) out[prefix] = JSON.stringify(value);
		return out;
	}

	if (value instanceof Date) {
		if (prefix) out[prefix] = value;
		return out;
	}

	if (typeof value !== "object") {
		if (prefix) out[prefix] = value;
		return out;
	}

	// Campi complessi tenuti compatti
	if (prefix && LIST_OBJECT_FIELDS.has(prefix.toLowerCase())) {
		out[prefix] = JSON.stringify(value);
		return out;
	}

	for (const [key, child] of Object.entries(value)) {
		const nextPrefix = prefix ? `${prefix}.${key}` : key;

		if (Array.isArray(child)) {
			out[nextPrefix] = JSON.stringify(child);
			continue;
		}

		if (isPlainObject(child) && !isMongoScalarObject(child)) {
			flattenRowForXes(child, nextPrefix, out);
			continue;
		}

		out[nextPrefix] = normalizeMongoScalar(child);
	}

	return out;
}

function buildRowList(jsonToTranslate) {
	const inputArray = Array.isArray(jsonToTranslate) ? jsonToTranslate : [jsonToTranslate];
	return inputArray.map((row) => flattenRowForXes(row));
}

function getValueByKey(row, key) {
	if (!key) return undefined;
	if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];

	if (key.includes(".")) {
		return key.split(".").reduce((acc, part) => {
			if (acc == null) return undefined;
			return acc[part];
		}, row);
	}

	return undefined;
}

function jsonToXes(filePath, caseIdKey, activityKey, timestampKey = "") {
    return new Promise((resolve, reject) => {
        console.log("jsonToXes START. Memory:", process.memoryUsage().heapUsed / 1024 / 1024, "MB");

        const traces = new Map();
        
        const rl = readline.createInterface({
            input: fs.createReadStream(filePath),
            crlfDelay: Infinity
        });

        let currentObjectBuffer = "";
        let openBrackets = 0;
        let foundObject = false;

        rl.on('line', (line) => {
            const trimmed = line.trim();
            if (!trimmed) return;

            // Rimuove la parentesi quadra dell'array iniziale `[`
            if (!foundObject && trimmed.startsWith('[')) {
                currentObjectBuffer += trimmed.substring(1) + "\n";
            } else {
                currentObjectBuffer += line + "\n";
            }

            // Conta l'apertura e chiusura delle parentesi per isolare il singolo blocco transazione
            for (let i = 0; i < line.length; i++) {
                if (line[i] === '{') {
                    openBrackets++;
                    foundObject = true;
                } else if (line[i] === '}') {
                    openBrackets--;
                }
            }

            // Abbiamo un singolo oggetto transazione completo e isolato
            if (foundObject && openBrackets === 0) {
                try {
                    let jsonString = currentObjectBuffer.trim();
                    if (jsonString.endsWith(',')) {
                        jsonString = jsonString.slice(0, -1); // Rimuove la virgola di separazione dell'array
                    }

                    const rawRow = JSON.parse(jsonString);
                    
                    // IMPORTANTE: Applichiamo la tua funzione di flattening originale su una singola riga
                    const flattenedRow = flattenRowForXes(rawRow);

                    const caseValue = getValueByKey(flattenedRow, caseIdKey);
                    const activityValue = getValueByKey(flattenedRow, activityKey);
                    const timestampValue = timestampKey ? getValueByKey(flattenedRow, timestampKey) : null;

                    if (caseValue != null && activityValue != null) {
                        const traceKey = typeof caseValue === "object" ? JSON.stringify(caseValue) : String(caseValue);

                        if (!traces.has(traceKey)) {
                            traces.set(traceKey, []);
                        }

                        traces.get(traceKey).push({
                            row: flattenedRow,
                            activityValue,
                            timestampValue,
                        });
                    }
                } catch (e) {
                    // Salta record corrotti o righe di formattazione senza interrompere il flusso di 1GB
                }

                // Reset per la transazione successiva
                currentObjectBuffer = "";
                foundObject = false;
            }
        });

        rl.on('close', () => {
            console.log("File parsed. Sorting traces... Total unique traces:", traces.size);

            // Ordinamento temporale delle tracce
            for (const [traceKey, events] of traces.entries()) {
                events.sort((a, b) => {
                    const ta = normalizeTimestamp(a.timestampValue);
                    const tb = normalizeTimestamp(b.timestampValue);
                    if (!ta && !tb) return 0;
                    if (!ta) return 1;
                    if (!tb) return -1;
                    return new Date(ta).getTime() - new Date(tb).getTime();
                });
            }

            console.log("Writing XES File to disk...");
            const outputPath = path.join(os.tmpdir(), `xes-${Date.now()}.xes`);
            const stream = fs.createWriteStream(outputPath);

            stream.write(`<?xml version="1.0" encoding="UTF-8"?>\n`);
            stream.write(`<log xmlns="http://xes-standard.org" xes.version="1.0" xes.features="nested-attributes">\n`);

            let traceCounter = 0;

            for (const [traceKey, events] of traces.entries()) {
                traceCounter++;
                
                stream.write(`\t<trace>\n`);
                stream.write(`\t\t<string key='concept:name' value='${escapeXmlAttrSingleQuoted(traceKey)}'/>\n`);

                events.forEach((event) => {
                    stream.write(`\t\t<event>\n`);

                    const conceptName = typeof event.activityValue === "object"
                        ? JSON.stringify(event.activityValue)
                        : String(event.activityValue);

                    stream.write(`\t\t\t<string key='concept:name' value='${escapeXmlAttrSingleQuoted(conceptName)}'/>\n`);

                    const normalizedTimestamp = normalizeTimestamp(event.timestampValue);
                    if (normalizedTimestamp) {
                        stream.write(`\t\t\t<date key='time:timestamp' value='${escapeXmlAttrSingleQuoted(normalizedTimestamp)}'/>\n`);
                    }

                    // Esporta tutti gli attributi appiattiti
                    for (const [key, value] of Object.entries(event.row)) {
                        if (key === caseIdKey || key === activityKey || key === timestampKey) continue;

                        const attr = xesAttribute(key, value);
                        if (attr) {
                            stream.write(`${attr}\n`);
                        }
                    }

                    stream.write(`\t\t</event>\n`);
                });

                stream.write(`\t</trace>\n`);
            }

            stream.write(`</log>\n`);
            stream.end();

            stream.on('finish', () => {
                console.log("XES Stream process completed.");
                resolve(outputPath);
            });

            stream.on('error', (err) => reject(err));
        });

        rl.on('error', (err) => reject(err));
    });
}

//OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO

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

app.post("/api/data/activities", async (req, res) => {
	const activity = req.query.activity;
	const query = req.body;
	try {
		await connectDB("Mainnet");
		const txs = await fetchTransactions(query);
		const result = [];
		txs.forEach((tx) => {
			const activityName = tx.activity || tx.functionName || "unknown";
			if (activityName === activity) {
				result.push({
					smartContract: tx.contractAddress || tx.contractName || "",
					txHash: tx.transactionHash || "",
					activity: activityName,
					timestamp: tx.timestamp || "",
					gasUsed: tx.gasUsed || 0,
					blockNumber: tx.blockNumber || 0,
					inputs: tx.inputs
						? tx.inputs.map((i) => i.inputName || "").join(", ")
						: "",
					events: tx.events
						? tx.events.map((e) => e.eventName || "").join(", ")
						: "",
				});
			}
		});
		await mongoose.disconnect();
		return res.json(result);
	} catch (error) {
		console.error("Error fetching activity data:", error);
		return res.status(500).json({ error: error.message });
	}
});

app.post("/api/data/txs", async (req, res) => {
	const sender = req.query.sender;
	const query = req.body;
	try {
		await connectDB("Mainnet");
		const txs = await fetchTransactions(query);
		const senderTxs = txs.filter(
			(tx) => tx.sender && tx.sender.toLowerCase() === sender.toLowerCase()
		);
		const formattedTxs = senderTxs.map(formatTransactionForTreeView);
		await mongoose.disconnect();
		return res.json(formattedTxs);
	} catch (error) {
		console.error("Error fetching activity data:", error);
		return res.status(500).json({ error: error.message });
	}
});

app.post("/api/data/events", async (req, res) => {
	const eventName = req.query.eventName;
	const query = req.body;
	try {
		await connectDB("Mainnet");
		const txs = await fetchTransactions(query);
		const formattedEvents = [];

		txs.forEach((tx) => {
			if (tx.events && Array.isArray(tx.events)) {
				// Filter events to only include matching eventName
				const matchingEvents = tx.events.filter(
					(event) => event.eventName === eventName
				);
				if (matchingEvents.length > 0) {
					// Create a modified tx object with only matching events
					const filteredTx = { ...tx, events: matchingEvents };
					formattedEvents.push(...extractEventDataAsJson(filteredTx));
				}
			}
		});

		await mongoose.disconnect();
		return res.json(formattedEvents);
	} catch (error) {
		console.error("Error fetching activity data:", error);
		res.status(500).json({ error: error.message });
	}
});

app.post("/api/data/internalTxs",async (req, res) => {
    const query = req.body;
    const {txHash,callId,page=0,limit=20} = req.query;
    try{
        await connectDB("Mainnet");
        const txs = await fetchTransactions(query);
        const tx = txs.find((tx)=> tx.transactionHash === txHash);
        const formattedTransaction = formatCallForTreeView(tx,callId);
        const startIndex = parseInt(page) * parseInt(limit);
        const endIndex = startIndex + parseInt(limit);
        const paginatedCalls = formattedTransaction.slice(startIndex, endIndex);
        await mongoose.disconnect();
        return res.json({
            items: paginatedCalls,
            total: formattedTransaction.length,
            page: parseInt(page),
            totalPages: Math.ceil(formattedTransaction.length / parseInt(limit)),
        });
    } catch (error) {
        console.error("Error fetching activity data:", error);
        res.status(500).json({ error: error.message });
    }
})

app.post("/api/data/internalTxsTree", async (req,res)=>{
    const {txHash,page,limit} = req.query;
    const query = req.body;
    try{
        await connectDB("Mainnet");
        const txs = await fetchTransactions(query);
        const tx = txs.find((tx) => tx.transactionHash === txHash);
        const allFormattedTransaction = formatInternalTransactionsForTreeView(tx);
        const startIndex = parseInt(page) * parseInt(limit);
        const endIndex = startIndex + parseInt(limit);
        const paginatedCalls = allFormattedTransaction.slice(startIndex, endIndex);
        await mongoose.disconnect();
        return res.json({
            items: paginatedCalls,
            total: allFormattedTransaction.length,
            page: parseInt(page),
            totalPages: Math.ceil(allFormattedTransaction.length / parseInt(limit)),
        });
    } catch (error) {
        console.error("Error fetching activity data:", error);
        res.status(500).json({ error: error.message });
    }
});

app.post("/api/data/calls", async (req, res) => {
	const { callType, page = 0, limit = 10 } = req.query;
	const query = req.body;

	try {
		await connectDB("Mainnet");
		const txs = await fetchTransactions(query);
		const allFormattedCalls = formatCallsForTreeView(callType, txs);
		const startIndex = parseInt(page) * parseInt(limit);
		const endIndex = startIndex + parseInt(limit);
		const paginatedCalls = allFormattedCalls.slice(startIndex, endIndex);
		await mongoose.disconnect();
		return res.json({
			items: paginatedCalls,
			total: allFormattedCalls.length,
			page: parseInt(page),
			totalPages: Math.ceil(allFormattedCalls.length / parseInt(limit)),
		});
	} catch (error) {
		console.error("Error fetching activity data:", error);
		res.status(500).json({ error: error.message });
	}
});

app.post("/api/data/storageState", async (req, res) => {
	const { variableName, limit = 1000, page = 1, sampleRate = 1 } = req.query;
	const query = req.body;

	try {
		await connectDB("Mainnet");
		const txs = await fetchTransactions(query);

		const historyData = formatStorageHistoryForVisualization(
			variableName,
			txs,
			{
				limit: parseInt(limit),
				page: parseInt(page),
				sampleRate: parseInt(sampleRate),
			}
		);
		await mongoose.disconnect();
		return res.json(historyData);
	} catch (error) {
		console.error("Error fetching activity data:", error);
		res.status(500).json({ error: error.message });
	}
});

app.get("/api/collections", async(req,res)=>{
    try {
        await connectDB("Mainnet");
        const collections = await mongoose.connection.db.listCollections().toArray();
        const names = collections.map((c)=>c.name);
        res.json(names);
    }catch(error){
        console.error(error);
        res.status(500).json("Failed to fetch collections");
    }
});

app.post("/api/transactions", async (req,res)=>{
    try{
        await connectDB("Mainnet");
        const {selectedCollection,contractAddress,dateFrom,dateTo,fromBlock,toBlock,funName,sender,minGasUsed,maxGasUsed} = req.body;
        const queryFilter = {};
        if(contractAddress && Array.isArray(contractAddress) && contractAddress.length > 0){
            queryFilter.contractAddress = {$in:contractAddress};
        }
        if(sender)
            queryFilter.sender = sender;
        if(funName)
            queryFilter.functionName = funName;
        if(dateFrom)
            queryFilter.timestamp = {
                ...queryFilter.timestamp,
                $gte: new Date(dateFrom),
            }
        if(dateTo)
            queryFilter.timestamp = {
                ...queryFilter.timestamp,
                $lte: new Date(dateTo)
            }
        if(fromBlock)
            queryFilter.blockNumber = {
                ...queryFilter.blockNumber,
                $gte:Number(fromBlock)
            }
        if(toBlock)
            queryFilter.blockNumber = {
                ...queryFilter.blockNumber,
                $lte:Number(toBlock)
            }
        if(minGasUsed)
            queryFilter.gasUsed = {
                ...queryFilter.gasUsed,
                $gte:Number(minGasUsed)
            }
        if(maxGasUsed)
            queryFilter.gasUsed = {
                ...queryFilter.gasUsed,
                $lte:Number(maxGasUsed)
            }
        const collections = await mongoose.connection.db
            .listCollections()
            .toArray();
        let results = [];
        const allCollectionNames = collections.map(collection=>collection.name);
        let validSelectedCollections;
        if(selectedCollection && Array.isArray(selectedCollection) && selectedCollection.length > 0) {
            validSelectedCollections = selectedCollection.filter(collectionName =>
                allCollectionNames.includes(collectionName)
            );
        }
        else
            validSelectedCollections = allCollectionNames;
        for (const c of validSelectedCollections) {
            const collection = mongoose.connection.db.collection(c);
            const transactions = await collection
                .find(queryFilter, { projection: { _id: 0 } })
                .toArray();
            // .skip(skip)
            // .limit(limit)
            results = results.concat(transactions);
        }
        res.json(results);
    }catch(error){
        console.error(error);
        res.status(500).json("Failed to fetch collections");
    }
});

app.post("/api/simulate", async (req, res) => {
	try {
		await connectDB("Mainnet");
		const params = req.body.params;

		if (!params || !Array.isArray(params) || params.length === 0 || !params[0]) {
			return res.status(400).json({ error: "Parametri non validi", logs: [] });
		}

		const txObject = params[0];

		const targetAddress = txObject.to || null;

		const networkData = {
            web3Endpoint: process.env.WEB3_ALCHEMY_MAINNET_URL,
            apiKey: process.env.API_KEY_ETHERSCAN,
            endpoint: process.env.ETHERSCAN_MAINNET_ENDPOINT,
            networkName: "Mainnet"
        };

		const result = await processSimulation(params, targetAddress, networkData);

		return res.status(200).json(result);
	}
	catch (err){
		console.error("Simulation error: " + err);
		return res.status(400).json({
            error: err.message,
            logs: err.logs || [] 
        });
	}
	finally {
		if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
	}
});

app.get("/api/get-mempool-txs", async (req, res) => {
    try {
        await connectDB("Mainnet");

        const requestedLimit = req.query.limit ? parseInt(req.query.limit, 10) : 100;
        const safeLimit = Math.min(requestedLimit, 500);

        // Accesso diretto alla variabile WebSocket corretta
        const wsUrl = process.env.WS_ALCHEMY_MAINNET_URL;

        if (!wsUrl || !wsUrl.startsWith('ws')) {
            return res.status(500).json({ 
                success: false, 
                error: "Configurazione URL WebSocket mancante o non valida nel file .env" 
            });
        }


        const transactions = await getMempoolTxs(wsUrl, safeLimit);

        return res.status(200).json({
            success: true,
            network: "Mainnet",
            count: transactions.length,
            data: transactions
        });

    } catch (err) {
        console.error("Errore snapshot mempool:", err);
        return res.status(500).json({
            success: false,
            error: "Impossibile recuperare la mempool",
            details: err.message || err
        });
    }
});

app.post("/api/simulate/mempool-txs", async (req, res) => {
	try {
		await connectDB("Mainnet");

		// array proveniente dal frontend
		const transactions = req.body.transactions;

		const networkData = {
            web3Endpoint: process.env.WEB3_ALCHEMY_MAINNET_URL,
            apiKey: process.env.API_KEY_ETHERSCAN,
            endpoint: process.env.ETHERSCAN_MAINNET_ENDPOINT,
            networkName: "Mainnet"
        };

		const results = await simulateMempoolTxs(transactions, networkData);

		return res.status(200).json({
            success: true,
            totalProcessed: results.length,
            data: results
        });
	}
	catch (err) {
		console.error("Errore critico nel controller batch:", err);
        return res.status(500).json({
            success: false,
            error: "Fallimento dell'orchestrazione batch",
            details: err.message
        });
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


