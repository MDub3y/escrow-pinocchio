#![no_std]

use pinocchio::{
    AccountView, Address, ProgramResult, default_panic_handler, error::ProgramError, no_allocator,
    nostd_panic_handler, program_entrypoint,
};

pub mod instructions;
pub mod state;

program_entrypoint!(process_instruction);
nostd_panic_handler!();
no_allocator!();

pub fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let (discriminator, rest) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;

    match discriminator {
        0 => instructions::make_offer::process_make_offer(program_id, accounts, rest),
        1 => instructions::take_offer::process_take_offer(program_id, accounts),
        // 2 => instructions::refund_offer::process_refund_offer(program_id, accounts),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
