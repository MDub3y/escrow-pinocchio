use crate::state::MakeOfferArgs;
use pinocchio::cpi::{Seed, Signer};
use pinocchio::sysvars::Sysvar;
use pinocchio::{AccountView, Address, ProgramResult, error::ProgramError};
use pinocchio_associated_token_account::instructions::Create;
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::instructions::Transfer;

pub fn process_make_offer(
    program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let args = MakeOfferArgs::from_bytes(instruction_data)?;

    let [
        maker,
        token_mint_a,
        token_mint_b,
        maker_token_account_a,
        offer_pda,
        vault,
        system_program,
        token_program,
        associated_token_program,
        ..,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !maker.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let (expected_offer_pda, bump) =
        Address::find_program_address(&[b"offer".as_ref(), &args.id.to_le_bytes()], program_id);

    if expected_offer_pda != *offer_pda.address() {
        return Err(ProgramError::InvalidSeeds);
    }

    let rent = pinocchio::sysvars::rent::Rent::get()?;
    let lamports_required = rent.try_minimum_balance(crate::state::Offer::LEN)?;

    let id_bytes = args.id.to_le_bytes();
    let bump_slice = core::slice::from_ref(&bump);

    let seeds = [
        Seed::from(b"offer"),
        Seed::from(id_bytes.as_ref()),
        Seed::from(bump_slice),
    ];

    let signer = Signer::from(&seeds);

    CreateAccount {
        from: maker,
        to: offer_pda,
        lamports: lamports_required,
        space: crate::state::Offer::LEN as u64,
        owner: program_id,
    }
    .invoke_signed(&[signer])?;

    Create {
        funding_account: maker,
        account: vault,
        wallet: offer_pda,
        mint: token_mint_a,
        system_program,
        token_program,
    }
    .invoke()?;

    Transfer::new(
        maker_token_account_a,
        vault,
        maker,
        args.token_a_offered_amount,
    )
    .invoke()?;

    unsafe {
        let data = offer_pda.borrow_unchecked_mut();
        data[0..8].copy_from_slice(&args.id.to_le_bytes());
        data[8..40].copy_from_slice(maker.address().as_ref());
        data[40..72].copy_from_slice(token_mint_a.address().as_ref());
        data[72..104].copy_from_slice(token_mint_b.address().as_ref());
        data[104..112].copy_from_slice(&args.token_b_wanted_amount.to_le_bytes());
        data[112] = bump;
    }

    Ok(())
}
