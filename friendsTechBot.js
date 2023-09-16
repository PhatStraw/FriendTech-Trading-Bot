const ethers = require('ethers');
const fs = require('fs');
require("dotenv").config();

/*
  Main trading bot which buys shares as soon as someone signs up
  Some quality checks to prevent anti-frontrunner bots based on
  previously seen account balances.
  Also checks users wallet balance and buys up to 3 shares
  depending on how much funds they have in their wallet.
  Price checks to prevent getting frontrun.
*/

const friendsAddress = '0xCF205808Ed36593aa40a44F10c7f7C2F67d4A4d4';
const provider = new ethers.JsonRpcProvider(`https://mainnet.base.org`); // https://base.blockpi.network/v1/rpc/public

const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
const account = wallet.connect(provider);
const friends = new ethers.Contract(
    friendsAddress,
    [
      'function buyShares(address arg0, uint256 arg1)',
      'function getBuyPriceAfterFee(address sharesSubject, uint256 amount) public view returns (uint256)',
      'function sharesBalance(address sharesSubject, address holder) public view returns (uint256)',
      'function sharesSupply(address sharesSubject) public view returns (uint256)',
      'function sellShares(address sharesSubject, uint256 amount) public payable',
      'event Trade(address trader, address subject, bool isBuy, uint256 shareAmount, uint256 ethAmount, uint256 protocolEthAmount, uint256 subjectEthAmount, uint256 supply)',
    ],
    account
);
const gasPrice = ethers.parseUnits('0.000000000000049431', 'ether');

const balanceArray = [];

const buyCosts = {};

const trade = async () => {
  let filter = friends.filters.Trade(null,null,null,null,null,null,null,null);
  friends.on(filter, async (event) => {
    console.log("========HELLO==========")
    const amigo = event.args[1];
    const isBuy = event.args[2];
    const weiBalance = await provider.getBalance(amigo);

    if (isBuy) {
      console.log("========isBUY==========")
      // Check if the share amount is less than or equal to 1 or if the share amount is less than or equal to 4 and the trader and subject addresses are the same
      if (event.args[7] <= 1n || (event.args[7] <= 4n && event.args[0] == event.args[1]))  {
        const amigo = event.args[1];
        const weiBalance = await provider.getBalance(amigo);
        // Bot check - compare the trader's balance with the balances in the balanceArray
        for (const botBalance in balanceArray) {
          if (weiBalance > botBalance - 300000000000000 && weiBalance < botBalance + 300000000000000) {
            console.log('Bot detected: ', amigo);
            return false;
          }
        }
        // Bot check 2 - check if the trader's balance is between 0.095 ETH and 0.105 ETH
        if (weiBalance > 95000000000000000 && weiBalance < 105000000000000000) return false; // 0.1
        balanceArray.push(weiBalance);
        if (balanceArray.length < 10) return false;
        if (balanceArray.length > 20) balanceArray.shift();

        if (weiBalance >= 30000000000000000) { // 0.03 ETH
          let qty = 1;
          if (weiBalance >= 90000000000000000) qty = 2;
          if (weiBalance >= 900000000000000000) qty = 3;

          // Get the buy price after fee for the specified quantity of shares
          const buyPrice = await friends.getBuyPriceAfterFee(amigo, qty);
          buyCosts[amigo] = buyPrice; // Store the buy cost
          console.log(`BUY PRICE: ${buyPrice} ${event.args[7]}`)
          if (qty < 2 && buyPrice > 2000000000000000) return false; // 0.001
          if (buyPrice > 10000000000000000) return false; // 0.01
          console.log('### BUY ###', amigo, buyPrice);
          // Buy the shares and append the trader's address to the buys.txt file
          const tx = await friends.buyShares(amigo, qty, {value: buyPrice, gasPrice});
          fs.appendFileSync('./buys.txt', amigo+"\n");
          try {
            const receipt = await tx.wait();
            console.log('Transaction Mined:', receipt.blockNumber);
          } catch (error) {
            console.log('Transaction Failed:', error);
          }
        } else {
          console.log(`No Money No Honey: ${amigo} ${weiBalance}`);
        }
      }
    } else {
      const bal = await friends.sharesBalance(amigo, wallet.address);
      if (bal >= 1) {
        const supply = await friends.sharesSupply(amigo);
        const sellPrice = await friends.getBuyPriceAfterFee(amigo, 1); // Get the current sell price

        // Check if the supply is greater than 1, the trader is not a specific address, and the sell price is greater than 1.3 times the buy cost
        if (supply > 1 && amigo !== '0x1a310A95F2350d80471d298f54571aD214C2e157' && sellPrice > buyCosts[amigo] * 1.3) {
          console.log(`Selling: ${amigo}`);
          try {
            const tx = await friends.sellShares(amigo, 1, {gasPrice});
            const receipt = await tx.wait();
            console.log('Transaction Mined:', receipt.blockNumber);
          } catch (error) {
            console.log('Transaction Failed:', error);
          }
        } else {
          console.log(`Bag holder: ${amigo}`);
        }
      } else {
        console.log(`No Balance: ${amigo}`);
      }
    }
  });
}

try {
  trade();
} catch (error) {
  console.error('ERR:', error);
}

process.on('uncaughtException', error => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Promise Rejection:', reason);
});