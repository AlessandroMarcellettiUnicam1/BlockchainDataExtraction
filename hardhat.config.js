require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  networks: {
    hardhat: {
      forking: {
        url: "https://mainnet.infura.io/v3/f3851e4d467341f1b5927b6546d9f30c",
        blockNumber: 16924137
      }
    }
  },
  solidity: "0.8.19",
};
