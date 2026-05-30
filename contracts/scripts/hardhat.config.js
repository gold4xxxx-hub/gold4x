require('@nomiclabs/hardhat-ethers');

module.exports = {
  solidity: '0.8.20',
  networks: {
    hardhat: {},
    bscTestnet: {
      url: 'https://data-seed-prebsc-1-s1.binance.org:8545/',
      accounts: [process.env.DEPLOYER_PRIVATE_KEY]
    }
  }
};
