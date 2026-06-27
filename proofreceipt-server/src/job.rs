use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize)]
pub enum JobStatus { Pending, Done, Error }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Receipt {
    pub seal: String,           // hex
    pub image_id: String,       // hex
    pub journal: String,        // hex (raw 36-byte journal)
    pub journal_digest: String, // hex (sha256 of journal)
    pub verdict: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct Job {
    pub status: JobStatus,
    pub receipt: Option<Receipt>,
    pub error: Option<String>,
}

pub type JobStore = Arc<Mutex<HashMap<String, Job>>>;

pub fn new_store() -> JobStore { Arc::new(Mutex::new(HashMap::new())) }

pub fn insert_pending(store: &JobStore) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    store.lock().unwrap().insert(id.clone(), Job { status: JobStatus::Pending, receipt: None, error: None });
    id
}

pub fn set_done(store: &JobStore, id: &str, receipt: Receipt) {
    if let Some(j) = store.lock().unwrap().get_mut(id) {
        j.status = JobStatus::Done;
        j.receipt = Some(receipt);
    }
}

pub fn set_error(store: &JobStore, id: &str, err: String) {
    if let Some(j) = store.lock().unwrap().get_mut(id) {
        j.status = JobStatus::Error;
        j.error = Some(err);
    }
}

/// Run m0-host on the artifact bytes and parse its proof.json into a Receipt.
/// Bounded by `timeout_secs`: a hung prove is killed (kill_on_drop) and returns an error
/// instead of leaving the job Pending forever.
pub async fn run_prover(m0_host_path: &str, artifact: Vec<u8>, timeout_secs: u64) -> Result<Receipt> {
    let dir = std::env::temp_dir().join(format!("m2job-{}", uuid::Uuid::new_v4()));
    let result = run_prover_in_dir(m0_host_path, artifact, timeout_secs, &dir).await;
    // Clean up the temp dir on ALL exit paths (success, error, timeout).
    let _ = std::fs::remove_dir_all(&dir);
    result
}

async fn run_prover_in_dir(host: &str, artifact: Vec<u8>, timeout_secs: u64, dir: &std::path::Path) -> Result<Receipt> {
    std::fs::create_dir_all(dir)?;
    let in_path = dir.join("artifact.bin");
    let out_path = dir.join("proof.json");
    std::fs::write(&in_path, &artifact).context("write artifact")?;

    let child = tokio::process::Command::new(host)
        .arg("--input").arg(&in_path)
        .arg("--out").arg(&out_path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true) // if the timeout fires, dropping the future SIGKILLs m0-host
        .spawn()
        .with_context(|| format!("spawn m0-host at {host}"))?;

    let dur = std::time::Duration::from_secs(timeout_secs);
    let out = match tokio::time::timeout(dur, child.wait_with_output()).await {
        Ok(res) => res.context("await m0-host")?,
        Err(_) => return Err(anyhow!("m0-host timed out after {timeout_secs}s")),
    };
    if !out.status.success() {
        return Err(anyhow!("m0-host failed: {}", String::from_utf8_lossy(&out.stderr)));
    }
    let json = std::fs::read_to_string(&out_path).context("read proof.json")?;
    let r: Receipt = serde_json::from_str(&json).context("parse proof.json")?;
    Ok(r)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_transitions() {
        let store = new_store();
        let id = insert_pending(&store);
        assert!(matches!(store.lock().unwrap().get(&id).unwrap().status, JobStatus::Pending));
        let r = Receipt { seal: "01".into(), image_id: "02".into(), journal: "03".into(), journal_digest: "04".into(), verdict: 1 };
        set_done(&store, &id, r);
        let g = store.lock().unwrap();
        let j = g.get(&id).unwrap();
        assert!(matches!(j.status, JobStatus::Done));
        assert_eq!(j.receipt.as_ref().unwrap().verdict, 1);
    }

    #[test]
    fn set_error_sets_status() {
        let store = new_store();
        let id = insert_pending(&store);
        set_error(&store, &id, "boom".into());
        let g = store.lock().unwrap();
        let j = g.get(&id).unwrap();
        assert!(matches!(j.status, JobStatus::Error));
        assert_eq!(j.error, Some("boom".to_string()));
    }

    #[tokio::test]
    async fn run_prover_parses_fake_host_output() {
        // Fake m0-host: a shell script that ignores --input and writes a canned proof.json to --out.
        let dir = std::env::temp_dir().join(format!("m2test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let host = dir.join("fake-host.sh");
        std::fs::write(&host, "#!/usr/bin/env bash\nset -e\nout=\"\"\nwhile [ $# -gt 0 ]; do if [ \"$1\" = \"--out\" ]; then out=\"$2\"; shift; fi; shift; done\ncat > \"$out\" <<'JSON'\n{\"seal\":\"aa\",\"image_id\":\"bb\",\"journal\":\"cc\",\"journal_digest\":\"dd\",\"verdict\":1}\nJSON\n").unwrap();
        std::fs::set_permissions(&host, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();

        let r = run_prover(host.to_str().unwrap(), b"hello".to_vec(), 30).await.unwrap();
        assert_eq!(r.seal, "aa");
        assert_eq!(r.journal_digest, "dd");
        assert_eq!(r.verdict, 1);
    }

    #[tokio::test]
    async fn run_prover_times_out_on_hung_host() {
        // Fake m0-host that sleeps far longer than the timeout — must error, not hang.
        let dir = std::env::temp_dir().join(format!("m2timeout-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let host = dir.join("hang-host.sh");
        std::fs::write(&host, "#!/usr/bin/env bash\nsleep 30\n").unwrap();
        std::fs::set_permissions(&host, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();

        let err = run_prover(host.to_str().unwrap(), b"x".to_vec(), 1).await.unwrap_err();
        assert!(err.to_string().contains("timed out"), "got: {err}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
