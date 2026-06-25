use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    JobExists = 3,
    JobNotFound = 4,
    JobNotOpen = 5,
    JobNotProven = 6,
    ChallengeWindowOpen = 7,
    InvalidAmount = 8,
}
