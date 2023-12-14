import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { NftToken } from "../target/types/nft_token";
import { createMint, mintTo, transfer, getOrCreateAssociatedTokenAccount, unpackAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  WhirlpoolContext, buildWhirlpoolClient, ORCA_WHIRLPOOL_PROGRAM_ID,
  PDAUtil, PoolUtil, PriceMath, increaseLiquidityQuoteByInputTokenWithParams,
  decreaseLiquidityQuoteByLiquidityWithParams
} from "@orca-so/whirlpools-sdk";
import { DecimalUtil, Percentage } from "@orca-so/common-sdk";
import Decimal from "decimal.js";
import expect from "expect";

describe("nft_token", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  console.log("Provider wallet:", provider.wallet.payer.publicKey.toBase58());
  const program = anchor.workspace.NftToken as Program<NftToken>;

  const orca = new anchor.web3.PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
  const whirlpool = new anchor.web3.PublicKey("7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm");
  const sol = new anchor.web3.PublicKey("So11111111111111111111111111111111111111112");
  const usdc = new anchor.web3.PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const tokenVaultA = new anchor.web3.PublicKey("9RfZwn2Prux6QesG1Noo4HzMEBv3rPndJ2bN2Wwd6a7p");
  const tokenVaultB = new anchor.web3.PublicKey("BVNo8ftg2LkkssnWT4ZWdtoFaevnfD6ExYeramwM27pe");
  const tickArrayLower = new anchor.web3.PublicKey("DJBLVHo3uTQBYpSHbVdDq8LoRsSiYV9EVhDUguXszvCi");
  const tickArrayUpper = new anchor.web3.PublicKey("ZPyVkTuj9TBr1ER4Fnubyz1w7bm5LsXctLiZb8Fs2Do");

  it("Adding and removing liquidity", async () => {
    // User wallet is the provider payer
    const userWallet = provider.wallet.payer;
    console.log("User wallet:", userWallet.publicKey.toBase58());

      const ctx = WhirlpoolContext.withProvider(provider, orca);
      const client = buildWhirlpoolClient(ctx);
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
      let quote = increaseLiquidityQuoteByInputTokenWithParams({
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
      let latest_blockhash = await ctx.connection.getLatestBlockhash();
      await ctx.connection.confirmTransaction({signature, ...latest_blockhash}, "confirmed");

    // Find a PDA account for the program
    const [pdaProgram, bump] = await anchor.web3.PublicKey.findProgramAddress([Buffer.from("pdaProgram", "utf-8")], program.programId);
    const bumpBytes = Buffer.from(new Uint8Array([bump]));
    console.log("Program PDA:", pdaProgram.toBase58());

    // Create new bridged token mint with the pda mint authority
    const bridgedTokenMint = await createMint(provider.connection, userWallet, pdaProgram, null, 9);
    console.log("Bridged token mint:", bridgedTokenMint.toBase58());

    // Get the ATA of the userWallet address, and if it does not exist, create it
    // This account will have bridged tokens
    const pdaBridgedTokenAccount = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        userWallet,
        bridgedTokenMint,
        pdaProgram,
        true // allowOwnerOfCurve - allow pda accounts to be have associated token account
    );
    console.log("PDA ATA for bridged token:", pdaBridgedTokenAccount.address.toBase58());

    try {
        signature = await program.methods
          .new(whirlpool, bridgedTokenMint, pdaBridgedTokenAccount.address, bumpBytes)
          .accounts({ dataAccount: pdaProgram })
          .rpc();
    } catch (error) {
        if (error instanceof Error && "message" in error) {
            console.error("Program Error:", error);
            console.error("Error Message:", error.message);
        } else {
            console.error("Transaction Error:", error);
        }
    }
    //console.log("Your transaction signature", signature);
    // Wait for program creation confirmation
    await provider.connection.confirmTransaction({
        signature: signature,
        ...(await provider.connection.getLatestBlockhash()),
    });

    // Get all token accounts
    const token_accounts = (await ctx.connection.getTokenAccountsByOwner(ctx.wallet.publicKey, {programId: TOKEN_PROGRAM_ID})).value;

    let parsed;
    let position;
    for (let i = 0; i < token_accounts.length; i++) {
        const ta = token_accounts[i];
        parsed = unpackAccount(ta.pubkey, ta.account);
        if (parsed.amount.toString() === "1") {
            position = PDAUtil.getPosition(ctx.program.programId, parsed.mint);
            break;
        }
    }


    // NFT position mint
    let accountInfo = await provider.connection.getAccountInfo(positionMint);
    //console.log(accountInfo);

    // Get the ATA of the userWallet address, and if it does not exist, create it
    // This account has an NFT token
    const userPositionAccount = parsed.address;
    console.log("User ATA for NFT:", userPositionAccount.toBase58());

    // Get the ATA of the userWallet address, and if it does not exist, create it
    // This account will have bridged tokens
    const userBridgedTokenAccount = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        userWallet,
        bridgedTokenMint,
        userWallet.publicKey
    );
    console.log("User ATA for bridged:", userBridgedTokenAccount.address.toBase58());

//    accountInfo = await provider.connection.getAccountInfo(userPositionAccount);
//    console.log(accountInfo);

    let balance = await program.methods.getBalance()
      .accounts({account: userPositionAccount})
      .view();
    console.log("User ATA must have one NFT, balance:", balance.toNumber());

    // ATA for the PDA to store the position NFT
    const pdaPositionAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      userWallet,
      positionMint,
      pdaProgram,
      true // allowOwnerOfCurve - allow pda accounts to be have associated token account
    );
    console.log("PDA ATA", pdaPositionAccount.address.toBase58());

    // Get the tokenA ATA of the userWallet address, and if it does not exist, create it
    // This account will have bridged tokens
    const userTokenAccountA = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        userWallet,
        token_a.mint,
        userWallet.publicKey
    );
    console.log("User ATA for tokenA:", userTokenAccountA.address.toBase58());

    // Get the tokenA ATA of the userWallet address, and if it does not exist, create it
    // This account will have bridged tokens
    const userTokenAccountB = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        userWallet,
        token_b.mint,
        userWallet.publicKey
    );
    console.log("User ATA for tokenB:", userTokenAccountB.address.toBase58());

    // Get the status of the position
    const positionSDK = await client.getPosition(position.publicKey);
    const data = positionSDK.getData();

    // Get the price range of the position
    const lower_price = PriceMath.tickIndexToPrice(data.tickLowerIndex, token_a.decimals, token_b.decimals);
    const upper_price = PriceMath.tickIndexToPrice(data.tickUpperIndex, token_a.decimals, token_b.decimals);

    // Calculate the amount of tokens that can be withdrawn from the position
    const amounts = PoolUtil.getTokenAmountsFromLiquidity(
      data.liquidity,
      whirlpoolClient.getData().sqrtPrice,
      PriceMath.tickIndexToSqrtPriceX64(data.tickLowerIndex),
      PriceMath.tickIndexToSqrtPriceX64(data.tickUpperIndex),
      true
    );

    // Output the status of the position
    console.log("position:", position.publicKey.toBase58());
    console.log("\twhirlpool address:", data.whirlpool.toBase58());
    console.log("\ttokenA:", token_a.mint.toBase58());
    console.log("\ttokenB:", token_b.mint.toBase58());
    console.log("\tliquidity:", data.liquidity.toNumber());
    console.log("\tlower:", data.tickLowerIndex, lower_price.toFixed(token_b.decimals));
    console.log("\tupper:", data.tickUpperIndex, upper_price.toFixed(token_b.decimals));
    console.log("\tamountA:", DecimalUtil.fromBN(amounts.tokenA, token_a.decimals).toString());
    console.log("\tamountB:", DecimalUtil.fromBN(amounts.tokenB, token_b.decimals).toString());

//  // Set the percentage of liquidity to be withdrawn (30%)
//  const delta_liquidity = data.liquidity.mul(new anchor.BN(30)).div(new anchor.BN(100));
//  console.log(delta_liquidity.toNumber());
//
//  quote = decreaseLiquidityQuoteByLiquidityWithParams({
//    // Pass the pool state as is
//    sqrtPrice: whirlpool_data.sqrtPrice,
//    tickCurrentIndex: whirlpool_data.tickCurrentIndex,
//    // Pass the price range of the position as is
//    tickLowerIndex: data.tickLowerIndex,
//    tickUpperIndex: data.tickUpperIndex,
//    // Liquidity to be withdrawn
//    liquidity: delta_liquidity,
//    // Acceptable slippage
//    slippageTolerance: slippage,
//  });
//  console.log(quote);
//
//  // Create a transaction
//  const decrease_liquidity_tx = await positionSDK.decreaseLiquidity(quote);
//  console.log(decrease_liquidity_tx.instructions[2].instructions);
//  console.log(decrease_liquidity_tx.instructions[2].instructions[0].keys);
//
//  // Send the transaction
//  signature = await decrease_liquidity_tx.buildAndExecute();
//  console.log("signature:", signature);
//
//  // Wait for the transaction to complete
//  latest_blockhash = await ctx.connection.getLatestBlockhash();
//  await ctx.connection.confirmTransaction({signature, ...latest_blockhash}, "confirmed");
//
//  // Output the liquidity after transaction execution
//  console.log("liquidity(after):", (await positionSDK.refreshData()).liquidity.toString());

//    const bBalalnce = new anchor.BN("20000000");
//    try {
//        signature = await program.methods.decreaseLiquidity(bBalalnce)
//          .accounts(
//              {
//                dataAccount: pdaProgram,
//                whirlpool_programId: orca,
//                pool: decrease_liquidity_tx.instructions[2].instructions[0].keys[0].pubkey,
//                tokenProgramId: decrease_liquidity_tx.instructions[2].instructions[0].keys[1].pubkey,
//                position: decrease_liquidity_tx.instructions[2].instructions[0].keys[3].pubkey,
//                userWallet: decrease_liquidity_tx.instructions[2].instructions[0].keys[2].pubkey,
//                pdaPositionAccount: decrease_liquidity_tx.instructions[2].instructions[0].keys[4].pubkey,
//                userTokenAccountA: decrease_liquidity_tx.instructions[2].instructions[0].keys[5].pubkey,
//                userTokenAccountB: decrease_liquidity_tx.instructions[2].instructions[0].keys[6].pubkey,
//                tokenVaultA: decrease_liquidity_tx.instructions[2].instructions[0].keys[7].pubkey,
//                tokenVaultB: decrease_liquidity_tx.instructions[2].instructions[0].keys[8].pubkey,
//                tickArrayLower: decrease_liquidity_tx.instructions[2].instructions[0].keys[9].pubkey,
//                tickArrayUpper: decrease_liquidity_tx.instructions[2].instructions[0].keys[10].pubkey
//              }
//          )
//          .signers([userWallet])
//          .rpc();
//    } catch (error) {
//        if (error instanceof Error && "message" in error) {
//            console.error("Program Error:", error);
//            console.error("Error Message:", error.message);
//        } else {
//            console.error("Transaction Error:", error);
//        }
//    }
//  return;

    // ############################## DEPOSIT ##############################
    console.log("\nSending position NFT to the program in exchange of bridged tokens");
    await program.methods.deposit()
      .accounts(
          {
            dataAccount: pdaProgram,
            userPositionAccount: userPositionAccount,
            pdaPositionAccount: pdaPositionAccount.address,
            userBridgedTokenAccount: userBridgedTokenAccount.address,
            bridgedTokenMint: bridgedTokenMint,
            position: position.publicKey,
            positionMint: positionMint,
            userWallet: userWallet.publicKey
          }
      )
      .signers([userWallet])
      .rpc();

    balance = await program.methods.getBalance()
      .accounts({account: pdaPositionAccount.address})
      .view();
    console.log("PDA ATA is transfered the NFT, balance:", balance.toNumber());

    balance = await program.methods.getBalance()
      .accounts({account: userPositionAccount})
      .view();
    console.log("User ATA NFT balance now:", balance.toNumber());

    balance = await program.methods.getBalance()
      .accounts({account: userBridgedTokenAccount.address})
      .view();
    console.log("User ATA bridged balance now:", balance.toNumber());
    expect(data.liquidity.toNumber()).toEqual(balance.toNumber());

    let totalSupply = await program.methods.totalSupply()
      .accounts({account: bridgedTokenMint})
      .view();
    console.log("Bridged token total supply now:", totalSupply.toNumber());


    // ############################## WITHDRAW ##############################
    console.log("\nSending bridged tokens back to the program in exchange of the NFT");
    // Transfer bridged tokens from the user to the program, decrease the position and send tokens back to the user
    const tBalalnce = new anchor.BN("20000000");
    try {
        signature = await program.methods.withdraw(tBalalnce)
          .accounts(
              {
                dataAccount: pdaProgram,
                whirlpool_programId: orca,
                pool: whirlpool,
                tokenProgramId: TOKEN_PROGRAM_ID,
                position: position.publicKey,
                userBridgedTokenAccount: userBridgedTokenAccount.address,
                pdaBridgedTokenAccount: pdaBridgedTokenAccount.address,
                userWallet: userWallet.publicKey,
                userPositionAccount: userPositionAccount,
                bridgedTokenMint: bridgedTokenMint,
                pdaPositionAccount: pdaPositionAccount.address,
                userTokenAccountA: userTokenAccountA.address,
                userTokenAccountB: userTokenAccountB.address,
                tokenVaultA: tokenVaultA,
                tokenVaultB: tokenVaultB,
                tickArrayLower: tickArrayLower,
                tickArrayUpper: tickArrayUpper,
                positionMint: positionMint,
                sig: userWallet.publicKey
              }
          )
          .signers([userWallet])
          .rpc();
    } catch (error) {
        if (error instanceof Error && "message" in error) {
            console.error("Program Error:", error);
            console.error("Error Message:", error.message);
        } else {
            console.error("Transaction Error:", error);
        }
    }

//    balance = await program.methods.getBalance()
//      .accounts({account: pdaBridgedTokenAccount.address})
//      .view();
//    console.log("PDA ATA bridged balance now:", balance.toNumber());
//
//    balance = await program.methods.getBalance()
//      .accounts({account: userBridgedTokenAccount.address})
//      .view();
//    console.log("User ATA bridged balance now:", balance.toNumber());
//
//    balance = await program.methods.getBalance()
//      .accounts({account: pdaPositionAccount.address})
//      .view();
//    console.log("PDA ATA NFT balance now:", balance.toNumber());
//
//    totalSupply = await program.methods.totalSupply()
//      .accounts({account: bridgedTokenMint})
//      .view();
//    console.log("Bridged token total supply now:", totalSupply.toNumber());
  });
});
