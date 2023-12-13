# autonolas-tokenomics-solana
Autonolas tokenomics contracts on Solana

## Pre-requisites
- Solang version: `v0.3.3`;
- Solana version: `solana-cli 1.17.7 (src:fca44b78; feat:3073089885, client:SolanaLabs)`;
- Anchor version: `anchor-cli 0.29.0`.

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

Then, execute the testing script:
```
solana airdrop 10000 9fit3w7t6FHATDaZWotpWqN7NpqgL3Lm1hqUop4hAy8h --url localhost && anchor test --skip-local-validator
```

If the `@programId` in nft_token.sol does not match with the deployed one, update it and re-run
```
anchor build
```