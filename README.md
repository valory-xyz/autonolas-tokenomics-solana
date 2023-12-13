# autonolas-tokenomics-solana
Autonolas tokenomics contracts on Solana

## Pre-requisites
Solana version: `solana-cli 1.17.7 (src:fca44b78; feat:3073089885, client:SolanaLabs)`;
Anchor version: `anchor-cli 0.29.0`.

## Development
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
solana airdrop 10000 8jc5LWDTAYf4bco6VVVx6YrLKN8dvEd6LbdBwJMUFhUJ --url localhost && anchor test --skip-local-validator
```
