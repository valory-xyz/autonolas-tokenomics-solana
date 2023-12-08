import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { NftToken } from "../target/types/nft_token";
import { Positions } from "../target/types/positions";
import { createMint, mintTo, transfer, getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";

describe("nft_token", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const dataAccount = anchor.web3.Keypair.generate();

  const program = anchor.workspace.NftToken as Program<NftToken>;

  const positionDataAccount = anchor.web3.Keypair.generate();
  const positionProgram = anchor.workspace.Positions as Program<Positions>;

  const whirlpool = new anchor.web3.PublicKey("7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm");
  const positionMint = new anchor.web3.PublicKey("J98dgio6XX2rnizUcb8ZQbFhGhqmrYYh3x8Jgza9KYfV");
  const orca = new anchor.web3.PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");

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
      .accounts({ dataAccount: positionDataAccount.publicKey })
      .signers([positionDataAccount])
      .rpc();
    console.log("Your transaction signature", tx2);

    const ret = await program.methods
      .getPositionData(positionDataAccount.publicKey, positionMint)
      .accounts({ dataAccount: dataAccount.publicKey })
        .remainingAccounts([
            { pubkey: positionDataAccount.publicKey}
        ])
        .view();
    console.log(ret.position);
    //console.log(ret.header.toNumber());
    //console.log(ret.position.liquidity.toNumber());

    const accountInfo = await provider.connection.getAccountInfo(positionDataAccount.publicKey);
    console.log(accountInfo);
  });

  it.only("NFT wrap and unwrap", async () => {
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
    const mintERC20 = await createMint(provider.connection, fromWallet, pdaProgram, null, 9);
    console.log("ERC20 token mint:", mintERC20.toBase58());

    // Get the ATA of the fromWallet address, and if it does not exist, create it
    // This account will have ERC20 tokens
    const pdaERC20Account = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        fromWallet,
        mintERC20,
        pdaProgram,
        true // allowOwnerOfCurve - allow pda accounts to be have associated token account
    );
    console.log("ATA PDA for ERC20:", pdaERC20Account.address.toBase58());

    let signature = await program.methods
      .new(orca, whirlpool, mintERC20, pdaERC20Account.address, bumpBytes)
      .accounts({ dataAccount: pdaProgram })
      .rpc();
    //console.log("Your transaction signature", signature);
    // Wait for program creation confirmation
    await provider.connection.confirmTransaction({
        signature: signature,
        ...(await provider.connection.getLatestBlockhash()),
    });

    // Create new NFT token mint
    const mint = await createMint(provider.connection, fromWallet, fromWallet.publicKey, null, 0);
    console.log("NFT token mint:", mint.toBase58());
    let accountInfo = await provider.connection.getAccountInfo(mint);
//    console.log(accountInfo);

    // Get the ATA of the fromWallet address, and if it does not exist, create it
    // This account will have an NFT token
    const fromTokenAccount = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        fromWallet,
        mint,
        fromWallet.publicKey
    );
    console.log("ATA from for NFT:", fromTokenAccount.address.toBase58());

    // Get the ATA of the fromWallet address, and if it does not exist, create it
    // This account will have ERC20 tokens
    const fromERC20Account = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        fromWallet,
        mintERC20,
        fromWallet.publicKey
    );
    console.log("ATA from for ERC20:", fromERC20Account.address.toBase58());

//    accountInfo = await provider.connection.getAccountInfo(fromTokenAccount.address);
//    console.log(accountInfo);
//    return;

    // Mint 1 new NFT token to the "fromTokenAccount" account we just created
    signature = await mintTo(
        provider.connection,
        fromWallet,
        mint,
        fromTokenAccount.address,
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
      .new(whirlpool, mint)
      .accounts({ dataAccount: positionDataAccount.publicKey })
      .signers([positionDataAccount])
      .rpc();

    let balance = await program.methods.getBalance()
      .accounts({account: fromTokenAccount.address})
      .view();
    console.log("ATA from is minted one NFT, balance:", balance.toNumber());

    // ATA for the PDA to store the NFT
    const pdaTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      fromWallet,
      mint,
      pdaProgram,
      true // allowOwnerOfCurve - allow pda accounts to be have associated token account
    );
    console.log("ATA PDA", pdaTokenAccount.address.toBase58());

    console.log("\nSending NFT to the program in exchange of ERC20 tokens");

    let liquidity = await positionProgram.methods.getLiquidity()
      .accounts({dataAccount: positionDataAccount.publicKey})
      .view();
    console.log("NFT holding liquidity amount:", liquidity.toNumber());

    await program.methods.deposit(mint)
      .accounts(
          {
            dataAccount: pdaProgram,
            fromTokenAccount: fromTokenAccount.address,
            pdaTokenAccount: pdaTokenAccount.address,
            toErc20: fromERC20Account.address,
            mintERC20: mintERC20,
            positionDataAccount: positionDataAccount.publicKey,
            fromWallet: fromWallet.publicKey
          }
      )
      .signers([fromWallet])
      .rpc();

    balance = await program.methods.getBalance()
      .accounts({account: pdaTokenAccount.address})
      .view();
    console.log("ATA PDA is transfered the NFT, balance:", balance.toNumber());

    balance = await program.methods.getBalance()
      .accounts({account: fromTokenAccount.address})
      .view();
    console.log("ATA from NFT balance now:", balance.toNumber());

    balance = await program.methods.getBalance()
      .accounts({account: fromERC20Account.address})
      .view();
    console.log("ATA from ERC20 balance now:", balance.toNumber());

    let totalSupply = await program.methods.totalSupply()
      .accounts({account: mintERC20})
      .view();
    console.log("Total supply now:", totalSupply.toNumber());

    console.log("\nSending ERC20 tokens back to the program in exchange of the NFT");
    // Transfer ERC20 tokens from the user to the program, and the NFT - back to the user
    signature = await program.methods.withdraw(balance)
      .accounts(
          {
            dataAccount: pdaProgram,
            fromERC20Account: fromERC20Account.address,
            pdaERC20Account: pdaERC20Account.address,
            fromWallet: fromWallet.publicKey,
            pdaTokenAccount: pdaTokenAccount.address,
            fromTokenAccount: fromTokenAccount.address,
            mintERC20: mintERC20,
            sig: fromWallet.publicKey
          }
      )
      .signers([fromWallet])
      .rpc();

    balance = await program.methods.getBalance()
      .accounts({account: pdaERC20Account.address})
      .view();
    console.log("ATA PDA ERC20 balance now:", balance.toNumber());

    balance = await program.methods.getBalance()
      .accounts({account: fromERC20Account.address})
      .view();
    console.log("ATA from ERC20 balance now:", balance.toNumber());

    balance = await program.methods.getBalance()
      .accounts({account: pdaTokenAccount.address})
      .view();
    console.log("ATA PDA NFT balance now:", balance.toNumber());

    balance = await program.methods.getBalance()
      .accounts({account: fromTokenAccount.address})
      .view();
    console.log("ATA from NFT balance now:", balance.toNumber());

    totalSupply = await program.methods.totalSupply()
      .accounts({account: mintERC20})
      .view();
    console.log("Total supply now:", totalSupply.toNumber());

//    await program.methods.mint(new anchor.BN(10), bumpBytes)
//      .accounts(
//          {
//            dataAccount: dataAccount.publicKey,
//            toErc20: fromERC20Account.address,
//            mintERC20: mintERC20,
//            pda: pda,
//            owner: fromWallet.publicKey
//          }
//      )
//      .signers([fromWallet])
//      .rpc();


//    // Transfer the new token to the "pdaTokenAccount" we just created
//    signature = await transfer(
//        provider.connection,
//        fromWallet,
//        fromTokenAccount.address,
//        pdaTokenAccount.address,
//        fromWallet.publicKey,
//        1,
//        []
//    );
//    console.log('transfer tx:', signature);
//    // Wait for transfer confirmation
//    await provider.connection.confirmTransaction({
//        signature: signature,
//        ...(await provider.connection.getLatestBlockhash()),
//    });

    //accountInfo = await provider.connection.getAccountInfo(pdaTokenAccount.address);
    //console.log(accountInfo);
    //console.log(accountInfo.data)

//    const balance = await program.getBalance(pdaTokenAccount.address)
//        .accounts({dataAccount: dataAccount.publicKey})
//        .view();
    //console.log(balance.toNumber());

//    // Create another associated token account for fromWallet
//    const toTokenAccount = await getOrCreateAssociatedTokenAccount(
//        provider.connection,
//        fromWallet,
//        mint,
//        fromWallet.publicKey
//    );
//
//    // Transfer NFT back to the user
//    signature = await program.methods.withdraw(bumpBytesToken)
//      .accounts(
//          {
//            dataAccount: dataAccount.publicKey,
//            from: pdaTokenAccount.address,
//            to: toTokenAccount.address,
//            owner: pdaTokenWallet,
//            sig: fromWallet.publicKey
//          }
//      )
//      .signers([fromWallet])
//      .rpc();
//
//      console.log('Withdraw tx:', signature);
  });
});
