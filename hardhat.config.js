require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  networks: {
    hardhat: {
      forking: {
        url: "https://eth-mainnet.g.alchemy.com/v2/ISHV03DLlGo2K1-dqE6EnsyrP2GF44Gt",
        // url: "https://eth-sepolia.g.alchemy.com/v2/6mnvPmDfijyOL2xG05-M6lkoYZwU_d9X",
        // url: "https://sepolia.infura.io/v3/1c4f94e02a9c4c5383c7d660f342cc5b",
        blockNumber: 12427648,
        // blockNumber: 5713214,
      },
      chainId: 1
      // chainId: 11155111
    }
  },
  solidity: "0.8.25",
};
