# arbitrage-bot-uni-sushi

## Dependencies

Using truffle for contract stuff. Using ethers and web3, especially for the convenient utils lib.
Also using the uniswap/sushiswap js sdk for token/pair operations.

## Fetching tokens to observe
Currently scanning the uniswap/suhsiswap subgraphs for
tokens with liquidity > 1 mio. $, maybe we need to adjust the query
to filter for tokens with higher volume as well
