#!/bin/bash

RUSTVER="1.60"
SOLANAVER="1.14.12"
ANCHORVER="0.26.0"

curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup install $RUSTVER
rustup default $RUSTVER

curl -sSfL https://release.solana.com/v${SOLANAVER}/install | sh

cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install $ANCHORVER
avm use $ANCHORVER

