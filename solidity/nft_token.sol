import "./library/spl_token.sol";
import "./library/system_instruction.sol";

struct Position {
    address whirlpool;      // 32
    address position_mint;  // 32
    uint128 liquidity;      // 16
    int32 tick_lower_index; // 4
    int32 tick_upper_index; // 4
}

@program_id("DPvSokZKEAYqh6jjmGDUyd4L881uAWg4rFVeA6rec2fr")
contract nft_token {
    address public orca;
    address public whirlpool;
    address public pdaProgram;
    address public mintErc20;
    address public pdaERC20Account;
    // TODO: Change for the latter one in production
    uint64 public pdaHeader = 0x55bdfe33;//0xd0f7407ae48fbcaa;
    // PDA seed
    bytes public constant pdaProgramSeed = "pdaProgram";
    // PDA bump
    bytes1 public pdaBump;
    //address constant tokenProgram = address"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

    @payer(payer)
    @seed("pdaProgram")
    constructor(
        address _orca,
        address _whirlpool,
        address _pdaProgram,
        address _mintErc20,
        address _pdaERC20Account,
        @bump bytes1 _bump
    ) {
        orca = _orca;
        whirlpool = _whirlpool;
        mintErc20 = _mintErc20;
        pdaERC20Account = _pdaERC20Account;

        // Independently derive the PDA address from the seeds, bump, and programId
        (address pda, bytes1 bump) = try_find_program_address(["pdaProgram"], type(nft_token).program_id);

        // Verify that the bump passed to the constructor matches the bump derived from the seeds and programId
        // This ensures that only the canonical pda address can be used to create the account (first bump that generates a valid pda address)
        if (bump != _bump) {
            revert("Invalid bump");
        }

        if (pda != _pdaProgram) {
            revert("Invalid PDA");
        }

        pdaBump = _bump;
        pdaProgram = _pdaProgram;
    }

    function getPositionData(address positionDataAccount, address positionMint) public view returns (Position position) {
        // Check for the
        for (uint64 i = 0; i < tx.accounts.length; i++) {
            AccountInfo ai = tx.accounts[i];
            if (ai.key == positionDataAccount) {
                // TODO Shift everything left by 8 bytes in production
                position = Position({
                    whirlpool: ai.data.readAddress(16),
                    position_mint: ai.data.readAddress(48),
                    liquidity: ai.data.readUint128LE(80),
                    tick_lower_index: ai.data.readInt32LE(96),
                    tick_upper_index: ai.data.readInt32LE(100)
                });

                // Check the whirlpool
                if (position.whirlpool != whirlpool) {
                    revert("Wrong whirlpool address");
                }

                // Check the NFT address
                if (position.position_mint != positionMint) {
                    revert("Wrong NFT address");
                }

                // Check the PDA ownership
                // TODO: Uncomment following lines in production
//                if (ai.owner != orca) {
//                    revert("Wrong pda owner");
//                }

                // Check the PDA header data
                uint64 header = ai.data.readUint64LE(0);
                if (header != pdaHeader) {
                    revert("Wrong pda header");
                }

                // Check the PDA address correctness
                (address pdaPosition, ) = try_find_program_address(["position", position.position_mint], orca);
                // TODO: Uncomment following lines in production
//                if (pdaPosition != positionDataAccount) {
//                    revert("Wrong position pdaPosition");
//                }

                return position;
            }
        }

        revert("account missing");
    }

    @mutableAccount(fromTokenAccount)
    @mutableAccount(pdaTokenAccount)
    @mutableAccount(toErc20)
    @mutableAccount(mintERC20)
    @account(positionDataAccount)
    @signer(fromWallet)
    function deposit(address positionMint) external {
        AccountInfo ai = tx.accounts.positionDataAccount;
        // TODO Shift everything left by 8 bytes in production
        Position position = Position({
            whirlpool: ai.data.readAddress(16),
            position_mint: ai.data.readAddress(48),
            liquidity: ai.data.readUint128LE(80),
            tick_lower_index: ai.data.readInt32LE(96),
            tick_upper_index: ai.data.readInt32LE(100)
        });

        // Check the whirlpool
        if (position.whirlpool != whirlpool) {
            revert("Wrong whirlpool address");
        }

        // Check the NFT address
        if (position.position_mint != positionMint) {
            revert("Wrong NFT address");
        }

        // Check the PDA ownership
        // TODO: Uncomment following lines in production
//                if (ai.owner != orca) {
//                    revert("Wrong pda owner");
//                }

        // Check the PDA header data
        uint64 header = ai.data.readUint64LE(0);
        if (header != pdaHeader) {
            revert("Wrong pda header");
        }

        // Check the PDA address correctness
        (address pdaPosition, ) = try_find_program_address(["position", position.position_mint], orca);
        // TODO: Uncomment following lines in production
//                if (pdaPosition != positionDataAccount) {
//                    revert("Wrong position pda");
//                }

        // TODO: Do the liquidity check for max(uint64) value as it is provided as uint128 from the LP provider

        // Transfer the NFT to the pdaTokenAccount address of this program
        SplToken.transfer(
            tx.accounts.fromTokenAccount.key,
            tx.accounts.pdaTokenAccount.key,
            tx.accounts.fromWallet.key,
            1);

        // Transfer ERC20 tokens to the user
        SplToken.mint_to_pda(
            mintErc20,
            tx.accounts.toErc20.key,
            pdaProgram,
            uint64(position.liquidity),
            pdaProgramSeed,
            pdaBump);
    }

    @mutableAccount(fromERC20Account)
    @mutableAccount(pdaERC20Account)
    @mutableAccount(fromWallet)
    @mutableAccount(pdaTokenAccount)
    @mutableAccount(fromTokenAccount)
    @mutableAccount(mintERC20)
    @signer(sig)
    // Transfer with PDA
    function withdraw(uint64 amount) external {
        // Transfer ERC20 tokens to the pdaERC20Account address of this program
        SplToken.transfer(
            tx.accounts.fromERC20Account.key,
            tx.accounts.pdaERC20Account.key,
            tx.accounts.fromWallet.key,
            amount);

        // Transfer NFT to the user associated token account
        SplToken.transfer_pda(
            tx.accounts.pdaTokenAccount.key,
            tx.accounts.fromTokenAccount.key,
            pdaProgram,
            1,
            pdaProgramSeed,
            pdaBump);

        // Burn acquired ERC20 tokens
        SplToken.burn_pda(tx.accounts.pdaERC20Account.key, mintErc20, pdaProgram, amount, pdaProgramSeed, pdaBump);
    }

//    @mutableAccount(toErc20)
//    @mutableAccount(mintERC20)
//    @mutableAccount(pdaProgram)
//    @signer(owner)
//    function mint(uint64 amount, bytes bump) external {
//        // Transfer ERC20 tokens to the user
//        SplToken.mint_to_pda(
//            mintErc20,
//            tx.accounts.toErc20.key,
//            pdaProgram,
//            amount,
//            pdaProgramSeed,
//            bump);
//    }

    @account(account)
    function get_balance() external view returns (uint64) {
        return SplToken.get_balance(tx.accounts.account);
    }

    @account(account)
    function totalSupply() external view returns (uint64) {
        return SplToken.total_supply(tx.accounts.account);
    }
}
