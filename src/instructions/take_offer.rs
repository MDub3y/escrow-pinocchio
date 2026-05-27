use crate::state::Offer;
use pinocchio::cpi::{Seed, Signer};
use pinocchio::{AccountView, Address, ProgramResult, error::ProgramError};
use pinocchio_associated_token_account::instructions::CreateIdempotent;
use pinocchio_token::instructions::{CloseAccount, Transfer};

pub fn process_take_offer(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [
        taker,
        maker,
        token_mint_a,
        token_mint_b,
        taker_token_account_a,
        taker_token_account_b,
        maker_token_account_b,
        offer_pda,
        vault,
        system_program,
        token_program,
        _associated_token_program,
        ..,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !taker.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if offer_pda.owner() != program_id {
        return Err(ProgramError::IllegalOwner);
    }

    let offer_pda_data = unsafe { offer_pda.borrow_unchecked() };
    let offer_data = Offer::from_bytes(offer_pda_data)?;

    if offer_data.maker != *maker.address() || offer_data.token_mint_b != *token_mint_b.address() {
        return Err(ProgramError::InvalidArgument);
    }

    let id_bytes = offer_data.id.to_le_bytes();
    let bump_slice = core::slice::from_ref(&offer_data.bump);

    let seeds = [
        Seed::from(b"offer"),
        Seed::from(id_bytes.as_ref()),
        Seed::from(bump_slice),
    ];
    let signer = Signer::from(&seeds);

    CreateIdempotent {
        funding_account: taker,
        account: taker_token_account_a,
        wallet: taker,
        mint: token_mint_a,
        system_program,
        token_program,
    }
    .invoke()?;

    CreateIdempotent {
        funding_account: taker,
        account: maker_token_account_b,
        wallet: maker,
        mint: token_mint_b,
        system_program,
        token_program,
    }
    .invoke()?;

    Transfer::new(
        taker_token_account_b,
        maker_token_account_b,
        taker,
        offer_data.token_b_wanted_amount,
    )
    .invoke()?;

    let vault_data = unsafe { vault.borrow_unchecked() };
    if vault_data.len() < 72 {
        return Err(ProgramError::InvalidAccountData);
    }
    let vault_amount = u64::from_le_bytes(vault_data[64..72].try_into().unwrap());

    Transfer::new(vault, taker_token_account_a, offer_pda, vault_amount)
        .invoke_signed(&[signer.clone()])?;

    CloseAccount::new(vault, taker, offer_pda).invoke_signed(&[signer])?;

    let offer_lamports = offer_pda.lamports();
    maker.set_lamports(maker.lamports() + offer_lamports);
    offer_pda.set_lamports(0);

    unsafe {
        let data = offer_pda.borrow_unchecked_mut();
        data.fill(0);
    }

    Ok(())
}
