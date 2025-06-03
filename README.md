# Getting Started with the Data Extraction on Blockchain

This tool consists of a web application to extract data from contract transactions using the Etherscan API to store them in a MongoDB database.
The purpose of this application is simplify the data analysis on Blockchain since that is possibile to retrieve information like (in addition to the _transaction hash_ or _gas used_): _internal transactions_, _storage state_, _events_ and so on for each transaction.

___

## Requirements
- [NodeJs](https://nodejs.org/en) for the JavaScript environment
- [Express](https://expressjs.com/) for the backend
- [React](https://react.dev/) and [Material UI](https://mui.com/material-ui/) for the frontend
- A [MongoDB](https://www.mongodb.com/) istance
- API key of [Etherscan](https://etherscan.io/apis)
- API key of a Web3 Provider like [Infura](https://www.infura.io/) or [Alchemy](https://www.alchemy.com/)

___

## How to run

In the same folder you have to clone two repositories:

### Backend
```
git clone https://github.com/lollobeach/BlockchainProcessMining_backend.git
```

In the root folder of `BlockchainProcessMining_backend` you have to add a `.env` file like this:
```
WEB3_ALCHEMY_MAINNET_URL=https://eth-mainnet.g.alchemy.com/v2/<alchemy_api>
WEB3_ALCHEMY_SEPOLIA_URL=https://eth-sepolia.g.alchemy.com/v2/<alchemy_api>

API_KEY_ETHERSCAN=<etherscan_api>
ETHERSCAN_MAINNET_ENDPOINT=https://api.etherscan.io/api
ETHERSCAN_SEPOLIA_ENDPOINT=https://api-sepolia.etherscan.io/api

MONGODB_URL=<connection_string>
LOG_DB_NAME=backlog
```
In this case the Alchemy provider has been used, but you are free to use whatever you want for the Web3 provider.

> [!NOTE]
> To work with the Polygon blockchain you have to use [PolygonScan API](https://polygonscan.com/apis) instead of Etherscan

and then run:
```
npm install
npm run dev
```

### Frontend
```
git clone https://github.com/lollobeach/BlockchainProcessMining_frontend.git
```

Then, in both projects run:
```
npm install
```

And in `BlockchainProcessMining_frontend` run:
```
npm run dev
```

This script will execute Express backend and React frontend together.

> [!WARNING]
> According to the `package.json` in `BlockchainProcessMining_frontend` both Frontend and Backend project must be in a same folder and they must keep these names: **BlockchainProcessMining_frontend** and **BlockchainProcessMining_backend**. If you want to change the path of the projects or their names you must update the `start script` in the `package.json` of `BlockchainProcessMining_frontend`.
