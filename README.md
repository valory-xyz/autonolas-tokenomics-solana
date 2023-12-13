# autonolas-tokenomics-solana
Autonolas tokenomics contracts on Solana

## Pre-requisites
Solana version: `solana-cli 1.17.7 (src:fca44b78; feat:3073089885, client:SolanaLabs)`;
Anchor version: `anchor-cli 0.29.0`.

## Development
Install the dependencies
```
yarn
```

Build the code with
```
anchor build
```

Run the validator in a separate window:
```
./validator.sh
```

Update the `@programId` in nft_token.sol, and re-run
```
anchor build
```

Then, execute the testing script (make sure to pass the PROVIDER_WALLET_ADDRESS):
```
solana airdrop 10000 PROVIDER_WALLET_ADDRESS --url localhost && anchor test --skip-local-validator
```
