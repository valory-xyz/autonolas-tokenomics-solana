import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { NftToken } from "../target/types/nft_token";
import { Positions } from "../target/types/positions";
import { createMint, mintTo, transfer, getOrCreateAssociatedTokenAccount, unpackAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Whirlpool } from "../target/types/whirlpool";
import {
  WhirlpoolContext, buildWhirlpoolClient, ORCA_WHIRLPOOL_PROGRAM_ID,
  PDAUtil, PriceMath, increaseLiquidityQuoteByInputTokenWithParams
} from "@orca-so/whirlpools-sdk";
import { DecimalUtil, Percentage } from "@orca-so/common-sdk";
import Decimal from "decimal.js";

describe("nft_token", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const dataAccount = anchor.web3.Keypair.generate();

  const program = anchor.workspace.NftToken as Program<NftToken>;

  const position = anchor.web3.Keypair.generate();
  const positionProgram = anchor.workspace.Positions as Program<Positions>;

  const realWhirlpool = anchor.workspace.Whirlpool as Program<Whirlpool>;

  const orca = new anchor.web3.PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
  const whirlpool = new anchor.web3.PublicKey("7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm");
  const positionMint = new anchor.web3.PublicKey("J98dgio6XX2rnizUcb8ZQbFhGhqmrYYh3x8Jgza9KYfV");
  const usdc = new anchor.web3.PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const sol = new anchor.web3.PublicKey("So11111111111111111111111111111111111111112");
  const ataUSDC = new anchor.web3.PublicKey("BP9YEAAKjJ7doxeTyPVnDdR3WcvQCRzJ1pD1JqTu9BNi");

  it("Is initialized!", async () => {
    // Add your test here.
    const tx = await program.methods
      .new(orca, whirlpool)
      .accounts({ dataAccount: dataAccount.publicKey })
      .signers([dataAccount])
      .rpc();
    console.log("Your transaction signature", tx);

    const val1 = await program.methods
      .get(orca, positionMint)
      .accounts({ dataAccount: dataAccount.publicKey })
      .view();

    console.log("value", val1);
  });

  it("Check position", async () => {
    const tx = await program.methods
      .new(orca, whirlpool)
      .accounts({ dataAccount: dataAccount.publicKey })
      .signers([dataAccount])
      .rpc();
    console.log("Your transaction signature", tx);

    const tx2 = await positionProgram.methods
      .new(whirlpool, positionMint)
      .accounts({ dataAccount: position.publicKey })
      .signers([position])
      .rpc();
    console.log("Your transaction signature", tx2);

    const ret = await program.methods
      .getPositionData(position.publicKey, positionMint)
      .accounts({ dataAccount: dataAccount.publicKey })
        .remainingAccounts([
            { pubkey: position.publicKey}
        ])
        .view();
    console.log(ret.positionData);
    //console.log(ret.header.toNumber());
    //console.log(ret.positionData.liquidity.toNumber());

    const accountInfo = await provider.connection.getAccountInfo(position.publicKey);
    console.log(accountInfo);
  });

  it("NFT wrap and unwrap", async () => {
    console.log("Program ID", program.programId.toBase58());

    // Find a PDA account for the program
    const [pdaProgram, bump] = await anchor.web3.PublicKey.findProgramAddress([Buffer.from("pdaProgram", "utf-8")], program.programId);
    const bumpBytes = Buffer.from(new Uint8Array([bump]));
    console.log("Program PDA:", pdaProgram.toBase58());

    // Generate a new wallet keypair and airdrop SOL
    const fromWallet = anchor.web3.Keypair.generate();
    let fromAirdropSignature = await provider.connection.requestAirdrop(fromWallet.publicKey, anchor.web3.LAMPORTS_PER_SOL);
    // Wait for airdrop confirmation
    await provider.connection.confirmTransaction({
        signature: fromAirdropSignature,
        ...(await provider.connection.getLatestBlockhash()),
    });
    console.log("Wallet from:", fromWallet.publicKey.toBase58());

    // Create new ERC20 token mint with the pda mint authority
    const bridgedTokenMint = await createMint(provider.connection, fromWallet, pdaProgram, null, 9);
    console.log("ERC20 token mint:", bridgedTokenMint.toBase58());

    // Get the ATA of the fromWallet address, and if it does not exist, create it
    // This account will have ERC20 tokens
    const pdaBridgedTokenAccount = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        fromWallet,
        bridgedTokenMint,
        pdaProgram,
        true // allowOwnerOfCurve - allow pda accounts to be have associated token account
    );
    console.log("ATA PDA for ERC20:", pdaBridgedTokenAccount.address.toBase58());

    let signature = await program.methods
      .new(orca, whirlpool, bridgedTokenMint, pdaBridgedTokenAccount.address, bumpBytes)
      .accounts({ dataAccount: pdaProgram })
      .rpc();
    //console.log("Your transaction signature", signature);
    // Wait for program creation confirmation
    await provider.connection.confirmTransaction({
        signature: signature,
        ...(await provider.connection.getLatestBlockhash()),
    });

    // Create new NFT position mint
    const positionMint = await createMint(provider.connection, fromWallet, fromWallet.publicKey, null, 0);
    console.log("NFT position mint:", positionMint.toBase58());
    let accountInfo = await provider.connection.getAccountInfo(positionMint);
//    console.log(accountInfo);

    // Get the ATA of the fromWallet address, and if it does not exist, create it
    // This account will have an NFT token
    const fromPositionAccount = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        fromWallet,
        positionMint,
        fromWallet.publicKey
    );
    console.log("ATA from for NFT:", fromPositionAccount.address.toBase58());

    // Get the ATA of the fromWallet address, and if it does not exist, create it
    // This account will have ERC20 tokens
    const fromERC20Account = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        fromWallet,
        bridgedTokenMint,
        fromWallet.publicKey
    );
    console.log("ATA from for ERC20:", fromERC20Account.address.toBase58());

//    accountInfo = await provider.connection.getAccountInfo(fromPositionAccount.address);
//    console.log(accountInfo);
//    return;

    // Mint 1 new NFT token to the "fromPositionAccount" account we just created
    signature = await mintTo(
        provider.connection,
        fromWallet,
        positionMint,
        fromPositionAccount.address,
        fromWallet.publicKey,
        1,
        []
    );
    //console.log('mint tx:', signature);
    // Wait for mint confirmation
    await provider.connection.confirmTransaction({
        signature: signature,
        ...(await provider.connection.getLatestBlockhash()),
    });

    // Create pseudo-position corresponding to the NFT
    await positionProgram.methods
      .new(whirlpool, positionMint)
      .accounts({ dataAccount: position.publicKey })
      .signers([position])
      .rpc();

    let balance = await program.methods.getBalance()
      .accounts({account: fromPositionAccount.address})
      .view();
    console.log("ATA from is minted one NFT, balance:", balance.toNumber());

    // ATA for the PDA to store the NFT
    const pdaPositionAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      fromWallet,
      positionMint,
      pdaProgram,
      true // allowOwnerOfCurve - allow pda accounts to be have associated token account
    );
    console.log("ATA PDA", pdaPositionAccount.address.toBase58());

    console.log("\nSending NFT to the program in exchange of ERC20 tokens");

    let liquidity = await positionProgram.methods.getLiquidity()
      .accounts({dataAccount: position.publicKey})
      .view();
    console.log("NFT holding liquidity amount:", liquidity.toNumber());

    await program.methods.deposit()
      .accounts(
          {
            dataAccount: pdaProgram,
            fromPositionAccount: fromPositionAccount.address,
            pdaPositionAccount: pdaPositionAccount.address,
            toErc20: fromERC20Account.address,
            bridgedTokenMint: bridgedTokenMint,
            position: position.publicKey,
            positionMint: positionMint,
            fromWallet: fromWallet.publicKey
          }
      )
      .signers([fromWallet])
      .rpc();

    balance = await program.methods.getBalance()
      .accounts({account: pdaPositionAccount.address})
      .view();
    console.log("ATA PDA is transfered the NFT, balance:", balance.toNumber());

    balance = await program.methods.getBalance()
      .accounts({account: fromPositionAccount.address})
      .view();
    console.log("ATA from NFT balance now:", balance.toNumber());

    balance = await program.methods.getBalance()
      .accounts({account: fromERC20Account.address})
      .view();
    console.log("ATA from ERC20 balance now:", balance.toNumber());

    let totalSupply = await program.methods.totalSupply()
      .accounts({account: bridgedTokenMint})
      .view();
    console.log("Total supply now:", totalSupply.toNumber());

    console.log("\nSending ERC20 tokens back to the program in exchange of the NFT");
    // Transfer ERC20 tokens from the user to the program, and the NFT - back to the user
    signature = await program.methods.withdraw(balance)
      .accounts(
          {
            dataAccount: pdaProgram,
            fromERC20Account: fromERC20Account.address,
            pdaBridgedTokenAccount: pdaBridgedTokenAccount.address,
            fromWallet: fromWallet.publicKey,
            pdaPositionAccount: pdaPositionAccount.address,
            fromPositionAccount: fromPositionAccount.address,
            bridgedTokenMint: bridgedTokenMint,
            sig: fromWallet.publicKey
          }
      )
      .signers([fromWallet])
      .rpc();

    balance = await program.methods.getBalance()
      .accounts({account: pdaBridgedTokenAccount.address})
      .view();
    console.log("ATA PDA ERC20 balance now:", balance.toNumber());

    balance = await program.methods.getBalance()
      .accounts({account: fromERC20Account.address})
      .view();
    console.log("ATA from ERC20 balance now:", balance.toNumber());

    balance = await program.methods.getBalance()
      .accounts({account: pdaPositionAccount.address})
      .view();
    console.log("ATA PDA NFT balance now:", balance.toNumber());

    balance = await program.methods.getBalance()
      .accounts({account: fromPositionAccount.address})
      .view();
    console.log("ATA from NFT balance now:", balance.toNumber());

    totalSupply = await program.methods.totalSupply()
      .accounts({account: bridgedTokenMint})
      .view();
    console.log("Total supply now:", totalSupply.toNumber());
  });

  it.only("Adding and removing liquidity", async () => {
      const ctx = WhirlpoolContext.withProvider(provider, orca);
      const client = buildWhirlpoolClient(ctx);

      const tick_spacing = 64;
      const whirlpoolClient = await client.getPool(whirlpool);

      // Get the current price of the pool
      const sqrt_price_x64 = whirlpoolClient.getData().sqrtPrice;
      const price = PriceMath.sqrtPriceX64ToPrice(sqrt_price_x64, 9, 6);
      console.log("price:", price.toFixed(6));

      // Set price range, amount of tokens to deposit, and acceptable slippage
      const usdc_amount = DecimalUtil.toBN(new Decimal("10" /* usdc */), 6);
      const slippage = Percentage.fromFraction(10, 1000); // 1%
      // Full range price
      const lower_tick_index = -443632;
      const upper_tick_index = 443632;

      // Adjust price range (not all prices can be set, only a limited number of prices are available for range specification)
      // (prices corresponding to InitializableTickIndex are available)
      const whirlpool_data = whirlpoolClient.getData();
      const token_a = whirlpoolClient.getTokenAInfo();
      const token_b = whirlpoolClient.getTokenBInfo();

      console.log("lower & upper tick_index:", lower_tick_index, upper_tick_index);
      console.log("lower & upper price:",
        PriceMath.tickIndexToPrice(lower_tick_index, token_a.decimals, token_b.decimals).toFixed(token_b.decimals),
        PriceMath.tickIndexToPrice(upper_tick_index, token_a.decimals, token_b.decimals).toFixed(token_b.decimals)
      );

      // Obtain deposit estimation
      const quote = increaseLiquidityQuoteByInputTokenWithParams({
        // Pass the pool definition and state
        tokenMintA: token_a.mint,
        tokenMintB: token_b.mint,
        sqrtPrice: whirlpool_data.sqrtPrice,
        tickCurrentIndex: whirlpool_data.tickCurrentIndex,
        // Price range
        tickLowerIndex: lower_tick_index,
        tickUpperIndex: upper_tick_index,
        // Input token and amount
        inputTokenMint: usdc,
        inputTokenAmount: usdc_amount,
        // Acceptable slippage
        slippageTolerance: slippage,
      });

      // Output the estimation
      console.log("SOL max input:", DecimalUtil.fromBN(quote.tokenMaxA, token_a.decimals).toFixed(token_a.decimals));
      console.log("USDC max input:", DecimalUtil.fromBN(quote.tokenMaxB, token_b.decimals).toFixed(token_b.decimals));

      // Create a transaction
      // Use openPosition method instead of openPositionWithMetadata method
      const open_position_tx = await whirlpoolClient.openPosition(
        lower_tick_index,
        upper_tick_index,
        quote
      );
      //console.log(quote);


      // Send the transaction
      let signature = await open_position_tx.tx.buildAndExecute();
      console.log("signature:", signature);
      console.log("position NFT:", open_position_tx.positionMint.toBase58());
      const positionMint = open_position_tx.positionMint;

      // Wait for the transaction to complete
      const latest_blockhash = await ctx.connection.getLatestBlockhash();
      await ctx.connection.confirmTransaction({signature, ...latest_blockhash}, "confirmed");

    // Find a PDA account for the program
    const [pdaProgram, bump] = await anchor.web3.PublicKey.findProgramAddress([Buffer.from("pdaProgram", "utf-8")], program.programId);
    const bumpBytes = Buffer.from(new Uint8Array([bump]));
    console.log("Program PDA:", pdaProgram.toBase58());

    // Generate a new wallet keypair and airdrop SOL
    const fromWallet = provider.wallet.payer;
    console.log("Wallet from:", fromWallet.publicKey.toBase58());

    // Create new bridged ERC20 token mint with the pda mint authority
    const bridgedTokenMint = await createMint(provider.connection, fromWallet, pdaProgram, null, 9);
    console.log("Bridged token mint:", bridgedTokenMint.toBase58());

    // Get the ATA of the fromWallet address, and if it does not exist, create it
    // This account will have bridged ERC20 tokens
    const pdaBridgedTokenAccount = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        fromWallet,
        bridgedTokenMint,
        pdaProgram,
        true // allowOwnerOfCurve - allow pda accounts to be have associated token account
    );
    console.log("ATA PDA for bridged token:", pdaBridgedTokenAccount.address.toBase58());

    signature = await program.methods
      .new(whirlpool, bridgedTokenMint, pdaBridgedTokenAccount.address, bumpBytes)
      .accounts({ dataAccount: pdaProgram })
      .rpc();
    //console.log("Your transaction signature", signature);
    // Wait for program creation confirmation
    await provider.connection.confirmTransaction({
        signature: signature,
        ...(await provider.connection.getLatestBlockhash()),
    });

    // Get all token accounts
    const token_accounts = (await ctx.connection.getTokenAccountsByOwner(ctx.wallet.publicKey, {programId: TOKEN_PROGRAM_ID})).value;

    // Get candidate addresses for the position
    let parsed;
    const whirlpool_position_candidate_pubkeys = token_accounts.map((ta) => {
        const parsed = unpackAccount(ta.pubkey, ta.account);
        console.log("parsed", parsed);

        // Derive the address of Whirlpool's position from the mint address (whether or not it exists)
        const pda = PDAUtil.getPosition(ctx.program.programId, parsed.mint);
        //console.log("Calculated PDA", pda);
        //console.log("programId", ctx.program.programId);

        // Returns the address of the Whirlpool position only if the number of tokens is 1 (ignores empty token accounts and non-NFTs)
        return new anchor.BN(parsed.amount.toString()).eq(new anchor.BN(1)) ? pda.publicKey : undefined;
    }).filter(pubkey => pubkey !== undefined);

    console.log(whirlpool_position_candidate_pubkeys);
//    // Create new NFT position mint
//    const positionMint = await createMint(provider.connection, fromWallet, fromWallet.publicKey, null, 0);
//    console.log("NFT position mint:", positionMint.toBase58());
//    let accountInfo = await provider.connection.getAccountInfo(positionMint);
////    console.log(accountInfo);
//
//    // Get the ATA of the fromWallet address, and if it does not exist, create it
//    // This account will have an NFT token
//    const fromPositionAccount = await getOrCreateAssociatedTokenAccount(
//        provider.connection,
//        fromWallet,
//        positionMint,
//        fromWallet.publicKey
//    );
//    console.log("ATA from for NFT:", fromPositionAccount.address.toBase58());
//
//    // Get the ATA of the fromWallet address, and if it does not exist, create it
//    // This account will have ERC20 tokens
//    const fromERC20Account = await getOrCreateAssociatedTokenAccount(
//        provider.connection,
//        fromWallet,
//        bridgedTokenMint,
//        fromWallet.publicKey
//    );
//    console.log("ATA from for ERC20:", fromERC20Account.address.toBase58());
//
////    accountInfo = await provider.connection.getAccountInfo(fromPositionAccount.address);
////    console.log(accountInfo);
////    return;
//
//    // Mint 1 new NFT token to the "fromPositionAccount" account we just created
//    signature = await mintTo(
//        provider.connection,
//        fromWallet,
//        positionMint,
//        fromPositionAccount.address,
//        fromWallet.publicKey,
//        1,
//        []
//    );
//    //console.log('mint tx:', signature);
//    // Wait for mint confirmation
//    await provider.connection.confirmTransaction({
//        signature: signature,
//        ...(await provider.connection.getLatestBlockhash()),
//    });
//
//    // Create pseudo-position corresponding to the NFT
//    await positionProgram.methods
//      .new(whirlpool, positionMint)
//      .accounts({ dataAccount: position.publicKey })
//      .signers([position])
//      .rpc();
//
//    let balance = await program.methods.getBalance()
//      .accounts({account: fromPositionAccount.address})
//      .view();
//    console.log("ATA from is minted one NFT, balance:", balance.toNumber());
//
//    // ATA for the PDA to store the NFT
//    const pdaPositionAccount = await getOrCreateAssociatedTokenAccount(
//      provider.connection,
//      fromWallet,
//      positionMint,
//      pdaProgram,
//      true // allowOwnerOfCurve - allow pda accounts to be have associated token account
//    );
//    console.log("ATA PDA", pdaPositionAccount.address.toBase58());
//
//    console.log("\nSending NFT to the program in exchange of ERC20 tokens");
//
//    let liquidity = await positionProgram.methods.getLiquidity()
//      .accounts({dataAccount: position.publicKey})
//      .view();
//    console.log("NFT holding liquidity amount:", liquidity.toNumber());
//
//    await program.methods.deposit()
//      .accounts(
//          {
//            dataAccount: pdaProgram,
//            fromPositionAccount: fromPositionAccount.address,
//            pdaPositionAccount: pdaPositionAccount.address,
//            toErc20: fromERC20Account.address,
//            bridgedTokenMint: bridgedTokenMint,
//            position: position.publicKey,
//            positionMint: positionMint,
//            fromWallet: fromWallet.publicKey
//          }
//      )
//      .signers([fromWallet])
//      .rpc();
  });
});
