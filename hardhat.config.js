const {extendEnvironment} = require("hardhat/config")
const {createProvider} = require("hardhat/internal/core/providers/construction")
const {HardhatEthersProvider} = require("@nomicfoundation/hardhat-ethers/internal/hardhat-ethers-provider");

require("dotenv").config()

extendEnvironment((hre) => {

  /**
   * To use this method you have to add another network to your hardhat.config.js
   */
  // hre.changeNetwork = async function changeNetwork(network) {
  //   if (!hre.config.networks[network]) {
  //     throw new Error(`Network ${network} not found in hardhat.config.js`)
  //   }
  //
  //   hre.network.name = network
  //   hre.network.config = hre.config.networks[network]
  //   hre.network.provider = await createProvider(hre.config, network)
  //
  //   if (hre.ethers) {
  //     hre.ethers.provider = new HardhatEthersProvider(hre.network.provider, hre.network.name)
  //   }
  // }

  /**
   * With this method is not necessary to add another network to your hardhat.config.js
   * it will change the "hardhat" network configuration
   */
  hre.changeNetwork = async function changeNetwork(network, blockNumber) {

    let url = ""
    let chainId = 0

    switch (network) {
      case "Mainnet":
        url = process.env.WEB3_ALCHEMY_MAINNET_URL
        chainId = 1
        break
      case "Sepolia":
        url = process.env.WEB3_ALCHEMY_SEPOLIA_URL
        chainId = 11155111
        break
      case "Polygon":
        url = process.env.WEB3_ALCHEMY_POLYGON_URL
        chainId = 137
        break
      case "Amoy":
        url = process.env.WEB3_ALCHEMY_AMOY_URL
        chainId = 80002
        break
    }

    hre.config.networks.hardhat.forking.url = url
    hre.config.networks.hardhat.forking.blockNumber = blockNumber
    hre.config.networks.hardhat.chainId = chainId
    hre.network.provider = await createProvider(hre.config, "hardhat")

    if (hre.ethers) {
      hre.ethers.provider = new HardhatEthersProvider(hre.network.provider, hre.network.name)
    }
  }

})

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {
      // Imposta "cancun" per avere il supporto a TSTORE, MCOPY ecc.
      hardfork: "cancun",
      chains: {
        1: {
          hardforkHistory: {
            shanghai: 17034870,
            cancun: 19426587
          },
        },
        137: {
          hardforkHistory: {
            berlin: 10000000,
            london: 20000000,
          },
        },
        80002: {
          hardforkHistory: {
            berlin: 10000000,
            london: 20000000,
          },
        }
      },
      forking: {
        url: process.env.WEB3_ALCHEMY_MAINNET_URL,
        enabled: true
      },
      chainId: 1
    }
  },
  solidity: "0.8.26",
};
