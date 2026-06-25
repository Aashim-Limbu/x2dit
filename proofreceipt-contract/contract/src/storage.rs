use soroban_sdk::{contracttype, Address, BytesN, Env};
use crate::error::Error;

#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Status {
    Open,
    Proven,
    Claimed,
}

#[contracttype]
#[derive(Clone)]
pub struct Job {
    pub buyer: Address,
    pub seller: Address,
    pub token: Address,
    pub amount: i128,
    pub expected_input_hash: BytesN<32>,
    pub expected_image_id: BytesN<32>,
    pub challenge_secs: u64,
    pub verdict: u32,
    pub claimable_at: u64,
    pub status: Status,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Verifier,
    Job(BytesN<32>),
}

pub fn get_verifier(env: &Env) -> Result<Address, Error> {
    env.storage().instance().get(&DataKey::Verifier).ok_or(Error::NotInitialized)
}
pub fn has_job(env: &Env, id: &BytesN<32>) -> bool {
    env.storage().persistent().has(&DataKey::Job(id.clone()))
}
pub fn get_job(env: &Env, id: &BytesN<32>) -> Result<Job, Error> {
    env.storage().persistent().get(&DataKey::Job(id.clone())).ok_or(Error::JobNotFound)
}
pub fn set_job(env: &Env, id: &BytesN<32>, job: &Job) {
    env.storage().persistent().set(&DataKey::Job(id.clone()), job);
}
