use pinocchio::{Address, error::ProgramError};

#[repr(C)]
#[derive(Clone, Copy)]
pub struct MakeOfferArgs {
    pub id: u64,
    pub token_a_offered_amount: u64,
    pub token_b_wanted_amount: u64,
}

impl MakeOfferArgs {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, ProgramError> {
        if bytes.len() < 24 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let id = u64::from_le_bytes(bytes[0..8].try_into().unwrap());
        let token_a_offered_amount = u64::from_le_bytes(bytes[8..16].try_into().unwrap());
        let token_b_wanted_amount = u64::from_le_bytes(bytes[16..24].try_into().unwrap());

        Ok(Self {
            id,
            token_a_offered_amount,
            token_b_wanted_amount,
        })
    }
}

#[repr(C)]
#[derive(Clone)]
pub struct Offer {
    pub id: u64,
    pub maker: Address,
    pub token_mint_a: Address,
    pub token_mint_b: Address,
    pub token_b_wanted_amount: u64,
    pub bump: u8,
}

impl Offer {
    pub const LEN: usize = 113; // 8 + 32 + 32 + 32 + 8 + 1

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, ProgramError> {
        if bytes.len() < Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }

        let id = u64::from_le_bytes(bytes[0..8].try_into().unwrap());
        let maker = Address::new_from_array(bytes[8..40].try_into().unwrap());
        let token_mint_a = Address::new_from_array(bytes[40..72].try_into().unwrap());
        let token_mint_b = Address::new_from_array(bytes[72..104].try_into().unwrap());
        let token_b_wanted_amount = u64::from_le_bytes(bytes[104..112].try_into().unwrap());
        let bump = bytes[112];

        Ok(Self {
            id,
            maker,
            token_mint_a,
            token_mint_b,
            token_b_wanted_amount,
            bump,
        })
    }
}
