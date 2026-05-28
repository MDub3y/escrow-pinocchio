# Pinocchio Escrow Program

## LiteSVM Benchmarks

The following Compute Units (CUs) were measured during execution using the local `LiteSVM` test runner:
    
    -   **Make Offer:** 35,337 CUs
        
    -   **Take Offer:** 59,842 CUs
        
    -   **Refund Offer:** 9,937 CUs
        

## Performance Breakdown

### Make Offer (35,337 CUs)

The compute footprint here is primarily driven by the on-chain `Address::find_program_address` seed iteration loop. The remaining cost accounts for a System Program `CreateAccount` CPI and an SPL Token `Transfer`.
    

### Take Offer (59,842 CUs)

This is the heaviest instruction in the lifecycle. It executes two separate `CreateIdempotent` CPI paths to guarantee the initialization of the associated token accounts for both parties, followed by an asset `Transfer` and a vault `CloseAccount` CPI.
    

### Refund Offer (9,937 CUs)

This represents the leanest execution path in the program. Because it completely bypasses the ATA creation infrastructure, it only executes a token `Transfer` and a vault `CloseAccount` CPI before reclaiming the state lamports.
    

## Key Implementation Differences

### Zero-Copy Memory Access

Instead of relying on heavy deserialization libraries or heap collection wrappers, account data reads use direct byte slice windows (`data[0..8]`, `data[8..40]`). This allows the program to look straight at the raw SVM memory layout via `AccountView`.
    

### Stack-Allocated Signers

To avoid allocating dynamic vectors during signed Cross-Program Invocations (CPIs), this implementation uses pointer-based `Seed` and `Signer` structures mapped directly into fixed-size stack arrays.
    

### CPI Constructor Primitives

Instead of manual struct declarations that require defining optional multi-signature arrays, instructions utilize `Transfer::new(...)` and `CloseAccount::new(...)` to map low-level fields cleanly.
    

### Manual State Closure

Account drainage and state termination use the `AccountView::set_lamports` mutation API. This allows the program to explicitly clear the state and transfer balances while fully satisfying borrow-checker constraints.