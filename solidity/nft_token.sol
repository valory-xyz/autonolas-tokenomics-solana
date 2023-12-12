import "./library/spl_token.sol";
import "./library/system_instruction.sol";
import "./interfaces/whirlpool.sol";

struct Position {
    address whirlpool;      // 32
    address position_mint;  // 32
    uint128 liquidity;      // 16
    int32 tick_lower_index; // 4
    int32 tick_upper_index; // 4
}

@program_id("2cptovuGx5eyxkbdC6g3C1m3a4W7gJ7KemjBBB2Cthx8")
contract nft_token {
    address public pool;
    address public pdaProgram;
    address public mintErc20;
    address public pdaERC20Account;
    // PDA header for position account
    uint64 public pdaHeader = 0xd0f7407ae48fbcaa;
    // Program PDA seed
    bytes public constant pdaProgramSeed = "pdaProgram";
    // Program PDA bump
    bytes1 public pdaBump;
    int32 public constant min_tick_lower_index = -443632;
    int32 public constant max_tick_lower_index = 443632;

    // Total number of token accounts (even those that hold no positions anymore)
    uint64 public numPositionAccounts;
    // First available account index in the set of accounts;
    uint64 public firstAvailablePositionAccountIndex;

    mapping(address => uint64) public mapPositionAccountLiquidity;
    address[type(uint32).max] public positionAccounts;

    @space(10000)
    @payer(payer)
    @seed("pdaProgram")
    constructor(
        address _pool,
        address _mintErc20,
        address _pdaERC20Account,
        @bump bytes1 _bump
    ) {
        pool = _pool;
        mintErc20 = _mintErc20;
        pdaERC20Account = _pdaERC20Account;

        // Independently derive the PDA address from the seeds, bump, and programId
        (address pda, bytes1 bump) = try_find_program_address(["pdaProgram"], type(nft_token).program_id);

        // Verify that the bump passed to the constructor matches the bump derived from the seeds and programId
        if (bump != _bump) {
            revert("Invalid bump");
        }

        pdaBump = bump;
        pdaProgram = pda;
    }

    /// @dev Gets the position data.
    function _getPositionData(AccountInfo position, address positionMint) internal view returns (Position positionData) {
        positionData = Position({
            whirlpool: position.data.readAddress(8),
            position_mint: position.data.readAddress(40),
            liquidity: position.data.readUint128LE(72),
            tick_lower_index: position.data.readInt32LE(88),
            tick_upper_index: position.data.readInt32LE(92)
        });

        // Check the whirlpool
        if (positionData.whirlpool != pool) {
            revert("Wrong pool address");
        }

        // Check the NFT address
        if (positionData.position_mint != positionMint) {
            revert("Wrong NFT address");
        }

        // Check tick values
        if (positionData.tick_lower_index != min_tick_lower_index || positionData.tick_upper_index != max_tick_lower_index) {
            revert("Wrong ticks");
        }

        // Check the PDA ownership
        if (position.owner != type(whirlpool).program_id) {
            revert("Wrong pda owner");
        }

        // Check the PDA header data
        uint64 header = position.data.readUint64LE(0);
        if (header != pdaHeader) {
            revert("Wrong pda header");
        }

        // Check the PDA address correctness
        (address pdaPosition, ) = try_find_program_address(["position", positionData.position_mint], type(whirlpool).program_id);
        if (pdaPosition != position.key) {
            revert("Wrong position PDA");
        }

        return positionData;
    }

    @mutableAccount(fromPositionAccount)
    @mutableAccount(pdaPositionAccount)
    @mutableAccount(toErc20)
    @mutableAccount(mintERC20)
    @account(position)
    @account(positionMint)
    @signer(fromWallet)
    function deposit() external {
        // Get the position data based on provided accounts
        Position positionData = _getPositionData(tx.accounts.position, tx.accounts.positionMint.key);

        // TODO: Do the liquidity check for max(uint64) value as it is provided as uint128 from the LP provider
        uint64 positionLiquidity = uint64(positionData.liquidity);

        // Transfer the position NFT to the pdaPositionAccount address of this program
        SplToken.transfer(
            tx.accounts.fromPositionAccount.key,
            tx.accounts.pdaPositionAccount.key,
            tx.accounts.fromWallet.key,
            1);

        // Transfer ERC20 tokens to the user
        SplToken.mint_to_pda(
            mintErc20,
            tx.accounts.toErc20.key,
            pdaProgram,
            positionLiquidity,
            pdaProgramSeed,
            pdaBump);

        // Record position liquidity amount and its correspondent account address
        address positionAddress = tx.accounts.position.key;
        mapPositionAccountLiquidity[positionAddress] = positionLiquidity;
        positionAccounts[numPositionAccounts] = positionAddress;
        numPositionAccounts++;
    }

    @mutableAccount(pool)
    @mutableAccount(tokenProgramId)
    @mutableAccount(position)
    @mutableAccount(fromERC20Account)
    @mutableAccount(pdaERC20Account)
    @mutableAccount(fromWallet)
    @mutableAccount(fromPositionAccount)
    @mutableAccount(mintERC20)
    @mutableAccount(pdaPositionAccount)
    @mutableAccount(fromTokenAccountA)
    @mutableAccount(fromTokenAccountB)
    @mutableAccount(tokenVaultA)
    @mutableAccount(tokenVaultB)
    @mutableAccount(tickArrayLower)
    @mutableAccount(tickArrayUpper)
    @mutableAccount(positionMint)
    @signer(sig)
    // Transfer with PDA
    function withdraw(uint64 amount) external {
        address positionAddress = positionAccounts[firstAvailablePositionAccountIndex];
        if (positionAddress != tx.accounts.position.key) {
            revert("Wrong liquidity token account");
        }

        uint64 positionLiquidity = mapPositionAccountLiquidity[positionAddress];
        // Check that the token account exists
        if (positionLiquidity == 0) {
            revert("No liquidity on a provided token account");
        }

        // Check the requested amount to be smaller or equal than the position liquidity
        if (amount > positionLiquidity) {
            revert("Amount exceeds the position liquidity");
        }

        // Transfer ERC20 tokens to the pdaERC20Account address of this program
        SplToken.transfer(
            tx.accounts.fromERC20Account.key,
            tx.accounts.pdaERC20Account.key,
            tx.accounts.fromWallet.key,
            amount);

        // Burn acquired ERC20 tokens
        SplToken.burn_pda(tx.accounts.pdaERC20Account.key, mintErc20, pdaProgram, amount, pdaProgramSeed, pdaBump);

        // Decrease the position liquidity
        AccountMeta[11] metasDecreaseLiquidity = [
            AccountMeta({pubkey: pool, is_writable: true, is_signer: false}),
            AccountMeta({pubkey: SplToken.tokenProgramId, is_writable: false, is_signer: false}),
            AccountMeta({pubkey: pdaProgram, is_writable: false, is_signer: true}),
            AccountMeta({pubkey: tx.accounts.position.key, is_writable: true, is_signer: false}),
            AccountMeta({pubkey: tx.accounts.pdaPositionAccount.key, is_writable: false, is_signer: false}),
            AccountMeta({pubkey: tx.accounts.fromTokenAccountA.key, is_writable: true, is_signer: false}),
            AccountMeta({pubkey: tx.accounts.fromTokenAccountB.key, is_writable: true, is_signer: false}),
            AccountMeta({pubkey: tx.accounts.tokenVaultA.key, is_writable: true, is_signer: false}),
            AccountMeta({pubkey: tx.accounts.tokenVaultB.key, is_writable: true, is_signer: false}),
            AccountMeta({pubkey: tx.accounts.tickArrayLower.key, is_writable: true, is_signer: false}),
            AccountMeta({pubkey: tx.accounts.tickArrayUpper.key, is_writable: true, is_signer: false})
        ];
        whirlpool.decreaseLiquidity{accounts: metasDecreaseLiquidity, seeds: [[pdaProgramSeed, pdaBump]]}(amount, 0, 0);

        // Update the token remainder
        uint64 remainder = positionLiquidity - amount;
        // Update liquidity and its associated position account
        mapPositionAccountLiquidity[positionAddress] = remainder;

        // If requested amount can be fully covered by the current position liquidity, close the position
        if (remainder == 0) {
            // Update fees for the position
            AccountMeta[4] metasUpdateFees = [
                AccountMeta({pubkey: pool, is_writable: true, is_signer: false}),
                AccountMeta({pubkey: tx.accounts.position.key, is_writable: true, is_signer: false}),
                AccountMeta({pubkey: tx.accounts.tickArrayLower.key, is_writable: false, is_signer: false}),
                AccountMeta({pubkey: tx.accounts.tickArrayUpper.key, is_writable: false, is_signer: false})
            ];
            whirlpool.updateFeesAndRewards{accounts: metasUpdateFees, seeds: [[pdaProgramSeed, pdaBump]]}();

            // Collect fees from the position
            AccountMeta[9] metasCollectFees = [
                AccountMeta({pubkey: pool, is_writable: true, is_signer: false}),
                AccountMeta({pubkey: pdaProgram, is_writable: false, is_signer: true}),
                AccountMeta({pubkey: tx.accounts.position.key, is_writable: true, is_signer: false}),
                AccountMeta({pubkey: tx.accounts.pdaPositionAccount.key, is_writable: false, is_signer: false}),
                AccountMeta({pubkey: tx.accounts.fromTokenAccountA.key, is_writable: true, is_signer: false}),
                AccountMeta({pubkey: tx.accounts.tokenVaultA.key, is_writable: true, is_signer: false}),
                AccountMeta({pubkey: tx.accounts.fromTokenAccountB.key, is_writable: true, is_signer: false}),
                AccountMeta({pubkey: tx.accounts.tokenVaultB.key, is_writable: true, is_signer: false}),
                AccountMeta({pubkey: SplToken.tokenProgramId, is_writable: false, is_signer: false})
            ];
            whirlpool.collectFees{accounts: metasCollectFees, seeds: [[pdaProgramSeed, pdaBump]]}();

            // Close the position
            AccountMeta[6] metasClosePosition = [
                AccountMeta({pubkey: pdaProgram, is_writable: false, is_signer: true}),
                AccountMeta({pubkey: tx.accounts.fromWallet.key, is_writable: true, is_signer: false}),
                AccountMeta({pubkey: tx.accounts.position.key, is_writable: true, is_signer: false}),
                AccountMeta({pubkey: tx.accounts.positionMint.key, is_writable: true, is_signer: false}),
                AccountMeta({pubkey: tx.accounts.pdaPositionAccount.key, is_writable: true, is_signer: false}),
                AccountMeta({pubkey: SplToken.tokenProgramId, is_writable: false, is_signer: false})
            ];
            whirlpool.closePosition{accounts: metasClosePosition, seeds: [[pdaProgramSeed, pdaBump]]}();

            // Increase the first available position account index
            firstAvailablePositionAccountIndex++;
        }
    }

    @account(position)
    @account(positionMint)
    function getPositionData() external view returns (Position) {
        return _getPositionData(tx.accounts.position, tx.accounts.positionMint.key);
    }

    function getLiquidityAmountsAndPositions(uint64 amount) external view returns (uint64[], address[]) {
        uint64 totalLiquidity = 0;
        uint64 numPositions = 0;

        // Get the number of allocated positions
        for (uint64 i = firstAvailablePositionAccountIndex; i < numPositionAccounts; ++i) {
            address positionAddress = positionAccounts[i];
            uint64 positionLiquidity = mapPositionAccountLiquidity[positionAddress];
            totalLiquidity += positionLiquidity;
            numPositions++;
            if (totalLiquidity >= amount) {
                break;
            }
        }

        // Allocate the necessary arrays and fill the values
        address[] positionAddresses = new address[](numPositions);
        uint64[] positionAmounts = new uint64[](numPositions);
        for (uint64 i = 0; i < numPositions; ++i) {
            positionAddresses[i] = positionAccounts[firstAvailablePositionAccountIndex + i];
            positionAmounts[i] = mapPositionAccountLiquidity[positionAddresses[i]];
        }
    }

    @account(account)
    function getBalance() external view returns (uint64) {
        return SplToken.get_balance(tx.accounts.account);
    }

    @account(account)
    function totalSupply() external view returns (uint64) {
        return SplToken.total_supply(tx.accounts.account);
    }
}
