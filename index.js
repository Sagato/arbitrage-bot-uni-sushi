require('dotenv').config()
const { Fetcher, Token, ChainId, WETH, TokenAmount } = require('@uniswap/sdk')
const { Fetcher: SushiFetcher } = require('@sushiswap/sdk')
const { Wallet, getDefaultProvider, Contract, utils } = require('ethers')
const Web3 = require('web3')
const colors = require('colors')
const { request, gql } = require('graphql-request')
// const tokens = require('./addresses/tokens.json')

const Arbitrage = require('./build/contracts/Arbitrage.json')

const web3 = new Web3()
const provider = getDefaultProvider(process.env.PROVIDER_URL)
const wallet = new Wallet(process.env.PRIVATE_KEY, provider)

const chainId = ChainId.MAINNET

const ONE_WEI = web3.utils.toBN(web3.utils.toWei('1'))
const ETHEREUM_AMOUNT = web3.utils.toBN(web3.utils.toWei('5'))
// const arbitrage = new Contract(Arbitrage.networks[ChainId], Arbitrage.abi)

// Getting populated by interval every 15 seconds
let ethPrice = null

// Only once the session starts.
// TODO: proper errorhandling & fetch again after x hours
let tokens = []

const getEthPrice = async () => {
  const query = gql`
    {
      bundles(first: 5) {
        id
        ethPrice
      }
    }
  `
  try {
    const graphResponse = await request(process.env.SUSHISWAP_GRAPH, query)
    ethPrice = web3.utils.toBN(parseInt(graphResponse.bundles[0].ethPrice))
    console.log('[CURRENT ETH PRICE ON SUSHI]: ', ethPrice.toString())
  } catch (error) {
    console.error('[ERROR FETCHING  ETHPRICE]: ', error)
  }
}

const getAllTokens = async () => {
  const pairQuery = gql`
    {
      pairs(
        first: 1000
        orderBy: reserveUSD
        orderDirection: desc
        where: { volumeUSD_gte: 20000000 }
      ) {
        id
        volumeUSD
        reserveUSD
        token0 {
          id
          name
          symbol
          decimals
        }
      }
    }
  `

  try {
    const tokensSushiswap = await request(
      process.env.SUSHISWAP_GRAPH,
      pairQuery
    )
    const tokensUniswap = await request(process.env.UNISWAP_GRAPH, pairQuery)

    const filteredTokens = tokensSushiswap.pairs
      .filter(
        (pair) => pair.token0.symbol !== 'WETH' && pair.token0.decimals === '18'
      )
      .filter((pair) =>
        tokensUniswap.pairs.some((p) => p.token0.id === pair.token0.id)
      )
      .map((p) => ({
        ...p.token0,
        volumeUSD: p.volumeUSD,
        reserveUSD: p.reserveUSD
      }))

    console.log(`observing ${filteredTokens.length} tokens`)

    tokens = filteredTokens

    console.log(
      `Observing:\n==========\n${filteredTokens
        .map((tkn) => tkn.symbol)
        .join('\n\n')}\n==========`.yellow
    )
  } catch (error) {
    // Still need to restart after error
    console.log(`[ERROR RETRIEVING TOKENS]: ${error}`.red)
  }
}

const checkArbitrageOpportunity = (wethPairs) => {}

const initArbitrage = async () => {
  await getEthPrice()
  await getAllTokens()

  console.log('Tokens fetched...Start observing'.cyan)

  setInterval(getEthPrice, 15000)

  // listen for new blocks they indicate potential price changes
  // with latest transactions
  provider.on('block', async (block) => {
    console.log(`New Block received: ${block}`)

    // start scanning for arbitrage opportunities by spotting price differences
    // on sushi and uni by analyzing the eth ratios on pairs
    const wethPairs = await Promise.all(
      tokens.map(async (token) => {
        const tkn = new Token(
          chainId,
          utils.getAddress(token.id),
          token.decimals,
          token.symbol
        )
        try {
          /*
           * Fetching the uniswap pair after initializing
           * the token instance
           */
          const [uniPair, sushiPair] = await Promise.all([
            Fetcher.fetchPairData(tkn, WETH[tkn.chainId], provider),
            SushiFetcher.fetchPairData(tkn, WETH[tkn.chainId], provider)
          ])

          /*
           * Asking for the exact output Amount on uni and sushi,
           * inputing 100 ETH
           */
          const tokenAmountUni = uniPair.getOutputAmount(
            new TokenAmount(WETH[chainId], ETHEREUM_AMOUNT)
          )
          const tokenAmountSushi = sushiPair.getOutputAmount(
            new TokenAmount(WETH[chainId], ETHEREUM_AMOUNT)
          )

          const tokensUniBN = web3.utils.toBN(tokenAmountUni[0].raw.toString())
          const tokensSushiBN = web3.utils.toBN(
            tokenAmountSushi[0].raw.toString()
          )

          const ethAmountUni = uniPair.getOutputAmount(
            new TokenAmount(tkn, tokensSushiBN)
          )

          const ethOnUniAfterArbitrageInWei = web3.utils.toBN(
            ethAmountUni[0].raw.toString()
          )

          console.log(
            `${
              `Calc ${tkn.symbol.toUpperCase()}`.blue
            }\nReserves USD:             ${
              token.reserveUSD
            }\nVolume USD:               ${
              token.volumeUSD
            } \n[UNI] Tokens after fee:   ${web3.utils.fromWei(
              tokensUniBN
            )}\n[SUSHI] Tokens after fee: ${web3.utils.fromWei(tokensSushiBN)}`
              .blue
          )
          console.log(
            `ETH from UNI:             ${web3.utils.fromWei(
              ETHEREUM_AMOUNT
            )}\nETH after Arb:            ${web3.utils.fromWei(ethAmountUni)}\n`
              .red
          )

          if (ethOnUniAfterArbitrageInWei.gt(ETHEREUM_AMOUNT)) {
            console.log(
              `Found Arbitrage op ${token.symbol} ${web3.utils.fromWei(
                ethOnUniAfterArbitrageInWei.sub(ETHEREUM_AMOUNT).mul(ethPrice)
              )}`.blue
            )
          }
        } catch (error) {
          // Nice catch all :)
          console.error(`[ERROR]: ${error}`.red)
        }
      })
    )
  })

  provider.on('error', (error) => {
    console.log(`[EVENT SUBSCRIPTION ERROR]: ${error}`)
  })
}

initArbitrage()
