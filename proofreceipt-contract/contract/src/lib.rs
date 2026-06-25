#![no_std]
mod error;
mod storage;
#[cfg(test)]
mod test;

use error::Error;
use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, Bytes, BytesN, Env};
use storage::{DataKey, Job, Status};
use risc0_interface::RiscZeroVerifierClient;

#[contract]
pub struct ProofReceipt;

#[contractimpl]
impl ProofReceipt {
    pub fn initialize(env: Env, verifier: Address) {
        if env.storage().instance().has(&DataKey::Verifier) {
            soroban_sdk::panic_with_error!(&env, Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Verifier, &verifier);
    }

    pub fn get_verifier(env: Env) -> Result<Address, Error> {
        storage::get_verifier(&env)
    }

    pub fn get_job(env: Env, job_id: BytesN<32>) -> Result<Job, Error> {
        storage::get_job(&env, &job_id)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn open_job(
        env: Env,
        job_id: BytesN<32>,
        buyer: Address,
        seller: Address,
        token_addr: Address,
        amount: i128,
        expected_input_hash: BytesN<32>,
        expected_image_id: BytesN<32>,
        challenge_secs: u64,
    ) -> Result<(), Error> {
        buyer.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if storage::has_job(&env, &job_id) {
            return Err(Error::JobExists);
        }

        token::TokenClient::new(&env, &token_addr)
            .transfer(&buyer, &env.current_contract_address(), &amount);

        let job = Job {
            buyer,
            seller,
            token: token_addr,
            amount,
            expected_input_hash,
            expected_image_id,
            challenge_secs,
            verdict: 0,
            claimable_at: 0,
            status: Status::Open,
        };
        storage::set_job(&env, &job_id, &job);
        env.events().publish((symbol_short!("opened"), job_id), amount);
        Ok(())
    }

    pub fn submit_proof(
        env: Env,
        job_id: BytesN<32>,
        seal: Bytes,
        verdict: u32,
    ) -> Result<(), Error> {
        let mut job = storage::get_job(&env, &job_id)?;
        if job.status != Status::Open {
            return Err(Error::JobNotOpen);
        }
        job.seller.require_auth();

        // Reconstruct the journal from the buyer's PINNED input hash + verdict.
        // verify() only succeeds if the guest committed exactly these bytes, so
        // a valid proof IS the proof the seller ran on the buyer's exact input.
        let mut buf = Bytes::from_array(&env, &job.expected_input_hash.to_array());
        buf.extend_from_array(&verdict.to_le_bytes());
        let journal_digest: BytesN<32> = env.crypto().sha256(&buf).to_bytes();

        let verifier = storage::get_verifier(&env)?;
        RiscZeroVerifierClient::new(&env, &verifier)
            .verify(&seal, &job.expected_image_id, &journal_digest);

        job.verdict = verdict;
        job.claimable_at = env.ledger().timestamp().saturating_add(job.challenge_secs);
        job.status = Status::Proven;
        storage::set_job(&env, &job_id, &job);
        env.events().publish((symbol_short!("proven"), job_id), (verdict, job.claimable_at));
        Ok(())
    }

    pub fn claim(env: Env, job_id: BytesN<32>) -> Result<(), Error> {
        let mut job = storage::get_job(&env, &job_id)?;
        if job.status != Status::Proven {
            return Err(Error::JobNotProven);
        }
        if env.ledger().timestamp() < job.claimable_at {
            return Err(Error::ChallengeWindowOpen);
        }
        job.seller.require_auth();

        token::TokenClient::new(&env, &job.token)
            .transfer(&env.current_contract_address(), &job.seller, &job.amount);

        job.status = Status::Claimed;
        storage::set_job(&env, &job_id, &job);
        env.events().publish((symbol_short!("claimed"), job_id), job.amount);
        Ok(())
    }
}
