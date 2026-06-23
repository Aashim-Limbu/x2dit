"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ClipboardPaste,
  Info,
  Loader2,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { CtaButton } from "@/components/site/cta-button";
import { GlowOrb } from "@/components/site/glow-orb";
import { cn } from "@/lib/utils";
import { STELLAR, stellarExpert, truncate } from "@/lib/site";
import { NOTE_PREFIX, decodeNote } from "@/lib/crypto/note";
import { connectFreighter as connectStellar } from "@/lib/stellar/wallet";
import { hasZusdcTrustline, addZusdcTrustline } from "@/lib/stellar/trustline";
import { runWithdraw } from "@/lib/withdraw/run";
import { ActRail } from "./act-rail";
import { StageStep } from "./stage-step";
import { StatusList } from "./status-list";
import { RevealClimax } from "./reveal-climax";

type Step =
  | "idle"
  | "validating"
  | "invalidNote"
  | "ready"
  | "proving"
  | "addressing"
  | "revealing"
  | "revealed"
  | "error";

const RAIL = [
  { n: 1, label: "Your note" },
  { n: 2, label: "Prove" },
  { n: 3, label: "Destination" },
  { n: 4, label: "Reveal" },
];

// which rail index is active for a given step
function railIndex(step: Step): number {
  switch (step) {
    case "idle":
    case "validating":
    case "invalidNote":
      return 0;
    case "ready":
    case "proving":
    case "error":
      return 1;
    case "addressing":
      return 2;
    case "revealing":
    case "revealed":
      return 3;
  }
}

const PROOF_STAGES = [
  "Fetching your Merkle path",
  "Building the witness",
  "Generating Groth16 proof",
  "Proof ready",
];

function decodeOk(v: string): { denom: number; leafIndex: number } | null {
  try { const n = decodeNote(v); return { denom: n.denom, leafIndex: n.leafIndex }; }
  catch { return null; }
}

function friendlyWithdrawError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (m.includes("UnknownRoot")) return "The relayer hasn't anchored your deposit's root on Stellar yet. Wait ~a minute after depositing and try again.";
  if (m.includes("NullifierAlreadyUsed")) return "This note has already been withdrawn. Each note withdraws once.";
  if (m.includes("InvalidProof")) return "Proof rejected. Double-check you pasted the exact note from your deposit.";
  return m || "Withdrawal failed.";
}

function looksLikeStellarAddr(v: string): boolean {
  const t = v.trim();
  return /^G[A-Z2-7]{55}$/.test(t);
}

// ── small shared bits ─────────────────────────────────────────────────────────
function SummaryRow({
  children,
  icon = "check",
  tone = "default",
}: {
  children: React.ReactNode;
  icon?: "check" | "shield" | "info";
  tone?: "default" | "muted";
}) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <span className="mt-0.5 shrink-0">
        {icon === "shield" ? (
          <ShieldCheck className="size-4 text-success" aria-hidden />
        ) : icon === "info" ? (
          <Info className="size-4 text-cyan" aria-hidden />
        ) : (
          <Check className="size-4 text-success" aria-hidden />
        )}
      </span>
      <span className={tone === "muted" ? "text-muted-ink" : "text-ink"}>
        {children}
      </span>
    </li>
  );
}

function ExplorerLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-sm font-mono underline decoration-hairline underline-offset-2 transition-colors hover:text-cyan focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      {children}
    </a>
  );
}

function StepHeading({
  title,
  lead,
}: {
  title: string;
  lead?: string;
}) {
  return (
    <div className="text-center">
      <h1
        aria-live="polite"
        className="font-display text-[clamp(1.6rem,3.4vw,2.25rem)] font-semibold tracking-[-0.025em] text-balance text-ink"
      >
        {title}
      </h1>
      {lead && (
        <p className="mx-auto mt-3 max-w-[48ch] text-pretty text-muted-ink">
          {lead}
        </p>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
export function WithdrawFlow() {
  const [step, setStep] = useState<Step>("idle");
  const [note, setNote] = useState("");
  const [proofDone, setProofDone] = useState(0);
  const [decoded, setDecoded] = useState<{ denom: number; leafIndex: number } | null>(null);
  const [destAddr, setDestAddr] = useState<string>("");
  const [trustlineReady, setTrustlineReady] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // destination
  const [destMode, setDestMode] = useState<"connected" | "fresh">("connected");
  const [freighterConnected, setFreighterConnected] = useState(false);
  const [connectingFreighter, setConnectingFreighter] = useState(false);
  const [pasteAddr, setPasteAddr] = useState("");
  const [addrTouched, setAddrTouched] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const timers = useRef<number[]>([]);

  // clear any pending timers on unmount
  useEffect(() => {
    const t = timers.current;
    return () => t.forEach((id) => window.clearTimeout(id));
  }, []);

  function later(fn: () => void, ms: number) {
    const id = window.setTimeout(fn, ms);
    timers.current.push(id);
  }

  // ── actions ────────────────────────────────────────────────────────────────
  function onValidate() {
    setStep("validating");
    const d = decodeOk(note);
    later(() => {
      if (d) { setDecoded(d); setStep("ready"); }
      else setStep("invalidNote");
    }, 300);
  }

  async function onPaste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setNote(text);
    } catch {
      /* clipboard blocked — user can type/paste manually */
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "").trim();
      if (text) setNote(text);
    };
    reader.readAsText(f);
    // allow re-selecting the same file
    e.target.value = "";
  }

  async function onProve(recipient: string) {
    setStep("proving"); setProofDone(0); setErrMsg(null);
    try {
      const stageToIdx: Record<string, number> = { path: 1, witness: 2, proof: 3, submit: 4 };
      const { txHash: hash } = await runWithdraw(note, recipient, (s) => setProofDone(stageToIdx[s]));
      setTxHash(hash);
      setStep("revealing");
    } catch (e) {
      setErrMsg(friendlyWithdrawError(e));
      setStep("error");
    }
  }

  async function connectFreighter() {
    if (connectingFreighter) return;
    setConnectingFreighter(true); setErrMsg(null);
    try {
      const addr = await connectStellar();
      setDestAddr(addr);
      const ok = await hasZusdcTrustline(addr);
      setTrustlineReady(ok);
      setFreighterConnected(true);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Freighter connection failed.");
    } finally {
      setConnectingFreighter(false);
    }
  }

  async function addTrustline() {
    setErrMsg(null);
    try { await addZusdcTrustline(destAddr); setTrustlineReady(true); }
    catch (e) { setErrMsg(e instanceof Error ? e.message : "Could not add trustline."); }
  }

  const destReady =
    destMode === "connected"
      ? freighterConnected && trustlineReady
      : looksLikeStellarAddr(pasteAddr);

  function onReveal() {
    if (!destReady) return;
    const recipient = destMode === "connected" ? destAddr : pasteAddr.trim();
    setDestAddr(recipient);
    onProve(recipient);
  }

  function reset() {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
    setNote("");
    setProofDone(0);
    setDecoded(null);
    setDestAddr("");
    setTrustlineReady(false);
    setTxHash(null);
    setErrMsg(null);
    setDestMode("connected");
    setFreighterConnected(false);
    setConnectingFreighter(false);
    setPasteAddr("");
    setAddrTouched(false);
    setStep("idle");
  }

  const railActive = railIndex(step);

  return (
    <main
      id="main"
      className="relative mx-auto flex min-h-screen max-w-xl flex-col px-6 pt-28 pb-24"
    >
      {/* dimmed orb behind the whole stage */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 flex items-center justify-center"
      >
        <GlowOrb size="lg" intensity={0.18} />
      </div>

      <ActRail steps={RAIL} active={railActive} className="mb-12" />

      <div className="flex-1">
        <StageStep stepKey={step}>
          {/* ── 1 · IDLE: paste / restore note ──────────────────────────── */}
          {step === "idle" && (
            <section className="space-y-7">
              <StepHeading
                title="Bring your secret note."
                lead="It's the only key that can withdraw your deposit. Paste it, or restore it from the file you saved."
              />

              <div className="space-y-3">
                <label htmlFor="note" className="sr-only">
                  Your secret note
                </label>
                <textarea
                  id="note"
                  aria-label="Your secret note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  spellCheck={false}
                  placeholder={`${NOTE_PREFIX}…`}
                  className="w-full resize-none rounded-lg border border-hairline bg-surface px-4 py-3 font-mono text-[0.95rem] leading-relaxed break-all text-ink placeholder:text-faint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <CtaButton variant="ghost" size="sm" onClick={onPaste}>
                    <ClipboardPaste className="size-4" aria-hidden />
                    Paste
                  </CtaButton>
                  <CtaButton
                    variant="ghost"
                    size="sm"
                    onClick={() => fileRef.current?.click()}
                  >
                    <Upload className="size-4" aria-hidden />
                    Restore from file
                  </CtaButton>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".txt,text/plain"
                    onChange={onFile}
                    className="sr-only"
                    tabIndex={-1}
                    aria-hidden
                  />
                  <Link
                    href="/deposit"
                    className="ml-auto rounded-sm text-xs text-faint underline decoration-hairline underline-offset-2 transition-colors hover:text-muted-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    No note yet?
                  </Link>
                </div>
              </div>

              <p className="flex items-center justify-center gap-2 text-xs text-muted-ink">
                <ShieldCheck className="size-3.5 text-success" aria-hidden />
                Your note never leaves your browser — the proof is generated locally.
              </p>

              <div className="flex flex-col items-center gap-2">
                <CtaButton
                  size="lg"
                  onClick={onValidate}
                  disabled={note.trim().length === 0}
                >
                  Check this note
                  <ArrowRight className="size-4" aria-hidden />
                </CtaButton>
                {note.trim().length === 0 && (
                  <p className="text-xs text-faint">Paste your note first.</p>
                )}
              </div>
            </section>
          )}

          {/* ── VALIDATING ──────────────────────────────────────────────── */}
          {step === "validating" && (
            <section className="space-y-7">
              <StepHeading title="Reading your note…" />
              <div className="mx-auto max-w-sm rounded-xl border border-hairline bg-surface p-6 shadow-panel">
                <StatusList steps={["Checking note format"]} done={0} />
              </div>
            </section>
          )}

          {/* ── INVALID NOTE ────────────────────────────────────────────── */}
          {step === "invalidNote" && (
            <section className="space-y-7">
              <StepHeading title="That note didn't read." />
              <div className="mx-auto max-w-md rounded-xl border border-[var(--danger)] bg-surface p-5 shadow-panel">
                <div className="flex items-start gap-3">
                  <AlertTriangle
                    className="mt-0.5 size-5 shrink-0 text-[var(--danger)]"
                    aria-hidden
                  />
                  <div className="space-y-1.5">
                    <p className="font-medium text-ink">
                      This doesn&rsquo;t look like a zk-houdini note.
                    </p>
                    <p className="text-sm text-muted-ink">
                      A valid note starts with{" "}
                      <code className="font-mono text-ink">{NOTE_PREFIX}</code>.
                      Check you copied the whole thing — your text is kept below
                      so you can fix it.
                    </p>
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                <label htmlFor="note-retry" className="sr-only">
                  Your secret note
                </label>
                <textarea
                  id="note-retry"
                  aria-label="Your secret note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  spellCheck={false}
                  className="w-full resize-none rounded-lg border border-hairline bg-surface px-4 py-3 font-mono text-[0.95rem] leading-relaxed break-all text-ink placeholder:text-faint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                />
              </div>
              <div className="flex justify-center">
                <CtaButton size="lg" onClick={onValidate}>
                  Try again
                  <ArrowRight className="size-4" aria-hidden />
                </CtaButton>
              </div>
            </section>
          )}

          {/* ── READY: decoded summary ──────────────────────────────────── */}
          {step === "ready" && (
            <section className="space-y-7">
              <StepHeading
                title="Your note checks out."
                lead="Here's what it unlocks. Next we'll build the zero-knowledge proof that you own it — without revealing which deposit it was."
              />
              <div className="glass-surface rounded-xl p-5">
                <ul className="space-y-3">
                  <SummaryRow>
                    <span className="font-mono text-ink">
                      {decoded?.denom} USDC
                    </span>{" "}
                    <span className="text-muted-ink">→</span>{" "}
                    <span className="font-mono text-ink">{decoded?.denom} zUSDC</span>
                  </SummaryRow>
                  <SummaryRow>
                    Stellar pool{" "}
                    <ExplorerLink href={stellarExpert.contract(STELLAR.pool)}>
                      {truncate(STELLAR.pool)}
                    </ExplorerLink>
                  </SummaryRow>
                  <SummaryRow icon="shield">
                    Membership: provable
                  </SummaryRow>
                </ul>
              </div>
              <div className="flex justify-center">
                <CtaButton size="lg" onClick={() => setStep("addressing")}>
                  Choose destination
                  <ArrowRight className="size-4" aria-hidden />
                </CtaButton>
              </div>
            </section>
          )}

          {/* ── PROVING: the labor (quiet, substantial) ─────────────────── */}
          {step === "proving" && (
            <section className="space-y-7">
              <StepHeading
                title="Building your proof."
                lead="A Groth16 proof that your note is in the pool — and nothing else."
              />
              <div className="mx-auto max-w-sm space-y-5 rounded-xl border border-hairline bg-surface p-6 shadow-panel">
                {/* progress fill — gradient on the BAR, never on text */}
                <div
                  className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-2)]"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={PROOF_STAGES.length}
                  aria-valuenow={proofDone}
                  aria-label="Proof generation progress"
                >
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[var(--primary)] to-[var(--cyan)] transition-[width] duration-[var(--dur-ui)] ease-[var(--ease-out-expo)]"
                    style={{
                      width: `${(proofDone / PROOF_STAGES.length) * 100}%`,
                    }}
                  />
                </div>
                <StatusList steps={PROOF_STAGES} done={proofDone} />
              </div>
            </section>
          )}

          {/* ── ADDRESSING: choose a fresh destination ──────────────────── */}
          {step === "addressing" && (
            <section className="space-y-7">
              <StepHeading
                title="Where should it reappear?"
                lead="A brand-new address keeps the trick clean — nothing on-chain links it to the address you deposited from."
              />

              <div role="radiogroup" aria-label="Destination address" className="space-y-3">
                {/* connected wallet option */}
                <label
                  className={cn(
                    "block cursor-pointer rounded-xl border bg-surface p-4 transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus",
                    destMode === "connected"
                      ? "border-primary ring-1 ring-primary/40"
                      : "border-hairline hover:bg-surface-2",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="radio"
                      name="dest"
                      className="sr-only"
                      checked={destMode === "connected"}
                      onChange={() => setDestMode("connected")}
                    />
                    <span
                      aria-hidden
                      className={cn(
                        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                        destMode === "connected"
                          ? "border-primary"
                          : "border-hairline",
                      )}
                    >
                      {destMode === "connected" && (
                        <span className="size-2 rounded-full bg-primary-bright" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink">
                        Use my connected Stellar wallet
                      </p>
                      {freighterConnected ? (
                        <div className="mt-1 space-y-1.5">
                          <p className="flex items-center gap-1.5 font-mono text-xs text-ink">
                            <Check className="size-3.5 text-success" aria-hidden />
                            {truncate(destAddr)}
                          </p>
                          {!trustlineReady && (
                            <button
                              type="button"
                              onClick={addTrustline}
                              className="rounded-sm text-xs text-primary-bright underline decoration-primary/40 underline-offset-2 transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                            >
                              Add zUSDC trustline
                            </button>
                          )}
                          {trustlineReady && (
                            <p className="flex items-center gap-1.5 text-xs text-success">
                              <Check className="size-3.5" aria-hidden />
                              zUSDC trustline active
                            </p>
                          )}
                        </div>
                      ) : connectingFreighter ? (
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-ink">
                          <Loader2
                            className="size-3.5 animate-spin motion-reduce:animate-none"
                            aria-hidden
                          />
                          Summoning Freighter…
                        </p>
                      ) : (
                        <button
                          type="button"
                          onClick={connectFreighter}
                          className="mt-1.5 rounded-sm text-xs text-primary-bright underline decoration-primary/40 underline-offset-2 transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                        >
                          Connect Freighter
                        </button>
                      )}
                    </div>
                  </div>
                </label>

                {/* fresh address option */}
                <label
                  className={cn(
                    "block cursor-pointer rounded-xl border bg-surface p-4 transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus",
                    destMode === "fresh"
                      ? "border-primary ring-1 ring-primary/40"
                      : "border-hairline hover:bg-surface-2",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="radio"
                      name="dest"
                      className="sr-only"
                      checked={destMode === "fresh"}
                      onChange={() => setDestMode("fresh")}
                    />
                    <span
                      aria-hidden
                      className={cn(
                        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                        destMode === "fresh" ? "border-primary" : "border-hairline",
                      )}
                    >
                      {destMode === "fresh" && (
                        <span className="size-2 rounded-full bg-primary-bright" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink">
                        Paste a fresh address
                      </p>
                      <input
                        type="text"
                        inputMode="text"
                        spellCheck={false}
                        aria-label="Fresh Stellar address"
                        aria-invalid={
                          destMode === "fresh" &&
                          addrTouched &&
                          pasteAddr.length > 0 &&
                          !looksLikeStellarAddr(pasteAddr)
                        }
                        placeholder="G…"
                        value={pasteAddr}
                        onFocus={() => setDestMode("fresh")}
                        onBlur={() => setAddrTouched(true)}
                        onChange={(e) => setPasteAddr(e.target.value)}
                        className={cn(
                          "mt-2 w-full rounded-lg border bg-[var(--bg-2)] px-3 py-2 font-mono text-xs text-ink placeholder:text-faint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                          destMode === "fresh" &&
                            addrTouched &&
                            pasteAddr.length > 0 &&
                            !looksLikeStellarAddr(pasteAddr)
                            ? "border-[var(--danger)]"
                            : "border-hairline",
                        )}
                      />
                      {destMode === "fresh" &&
                        addrTouched &&
                        pasteAddr.length > 0 &&
                        !looksLikeStellarAddr(pasteAddr) && (
                          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-[var(--danger)]">
                            <AlertTriangle className="size-3.5" aria-hidden />
                            That isn&rsquo;t a valid Stellar address (G… , 56
                            chars).
                          </p>
                        )}
                    </div>
                  </div>
                </label>
              </div>

              <p className="flex items-center justify-center gap-2 text-center text-xs text-muted-ink">
                <ShieldCheck className="size-3.5 text-success" aria-hidden />
                Nothing connects this to the address you deposited from.
              </p>

              <div className="flex flex-col items-center gap-2">
                <CtaButton size="lg" onClick={onReveal} disabled={!destReady}>
                  Reveal my value
                  <ArrowRight className="size-4" aria-hidden />
                </CtaButton>
                {!destReady && (
                  <p className="text-xs text-faint">
                    {destMode === "connected"
                      ? freighterConnected
                        ? "Add the zUSDC trustline to continue."
                        : "Connect a wallet, or paste a fresh address."
                      : "Enter a valid Stellar address first."}
                  </p>
                )}
              </div>
            </section>
          )}

          {/* ── REVEALING: the climax ───────────────────────────────────── */}
          {step === "revealing" && (
            <RevealClimax
              figure={`${decoded?.denom ?? ""} zUSDC`}
              onDone={() => setStep("revealed")}
            />
          )}

          {/* ── REVEALED: success ───────────────────────────────────────── */}
          {step === "revealed" && (
            <section className="space-y-7">
              <div className="text-center">
                <ShieldCheck
                  className="mx-auto size-8 text-success"
                  aria-hidden
                />
                <h1
                  aria-live="polite"
                  className="mt-4 font-display text-[clamp(1.75rem,3.6vw,2.5rem)] font-semibold tracking-[-0.025em] text-balance text-ink"
                >
                  The reveal is complete.
                </h1>
                <p className="mx-auto mt-3 max-w-[46ch] text-pretty text-muted-ink">
                  Your value reappeared — with no trace of where it came from.
                </p>
              </div>

              <div className="rounded-xl border border-hairline bg-surface p-5 shadow-panel">
                <ul className="space-y-3">
                  <SummaryRow icon="shield">
                    Received{" "}
                    <span className="font-mono text-ink">{decoded?.denom} zUSDC</span>
                  </SummaryRow>
                  <SummaryRow>
                    At{" "}
                    <ExplorerLink
                      href={stellarExpert.account(destAddr)}
                    >
                      {truncate(destAddr)}
                    </ExplorerLink>{" "}
                    <span className="text-muted-ink">— a fresh address</span>
                  </SummaryRow>
                  <SummaryRow>
                    Asset zUSDC SAC{" "}
                    <ExplorerLink
                      href={stellarExpert.contract(STELLAR.zusdcSac)}
                    >
                      {truncate(STELLAR.zusdcSac)}
                    </ExplorerLink>
                  </SummaryRow>
                  {txHash && (
                    <SummaryRow>
                      Stellar tx{" "}
                      <ExplorerLink href={stellarExpert.tx(txHash)}>
                        {truncate(txHash)}
                      </ExplorerLink>
                    </SummaryRow>
                  )}
                </ul>
              </div>

              <p className="rounded-lg border border-hairline bg-[var(--bg-2)] px-4 py-3 text-center text-sm text-muted-ink">
                On-chain, this address has no connection to your Sepolia deposit.
                That&rsquo;s the whole trick.
              </p>

              <div className="flex flex-col items-center gap-3">
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <CtaButton href="/" size="lg">
                    Done
                  </CtaButton>
                  <CtaButton variant="glass" size="lg" onClick={reset}>
                    Withdraw another note
                  </CtaButton>
                </div>
                <p className="flex items-center gap-2 text-xs text-muted-ink">
                  <Info className="size-3.5 text-cyan" aria-hidden />
                  This note has been used. Each note withdraws once.
                </p>
              </div>
            </section>
          )}

          {/* ── ERROR ───────────────────────────────────────────────────── */}
          {step === "error" && (
            <section className="space-y-7">
              <StepHeading title="Something went wrong." />
              <div className="mx-auto max-w-md rounded-xl border border-[var(--danger)] bg-surface p-5 shadow-panel">
                <div className="flex items-start gap-3">
                  <AlertTriangle
                    className="mt-0.5 size-5 shrink-0 text-[var(--danger)]"
                    aria-hidden
                  />
                  <p className="text-sm text-ink">{errMsg}</p>
                </div>
              </div>
              <div className="flex justify-center">
                <CtaButton size="lg" onClick={() => setStep("addressing")}>
                  Try again
                  <ArrowRight className="size-4" aria-hidden />
                </CtaButton>
              </div>
            </section>
          )}
        </StageStep>
      </div>

      {/* footer hint always present for orientation */}
      {(step === "idle" || step === "invalidNote") && (
        <p className="mt-10 text-center text-xs text-faint">
          No note yet?{" "}
          <Link
            href="/deposit"
            className="rounded-sm underline decoration-hairline underline-offset-2 transition-colors hover:text-muted-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Make a deposit first
          </Link>
          .
        </p>
      )}
    </main>
  );
}
