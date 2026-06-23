import type { Metadata } from "next";
import { TopBar } from "@/components/site/top-bar";
import { WithdrawFlow } from "@/components/site/withdraw/withdraw-flow";

export const metadata: Metadata = {
  title: "Act II · The Reveal — zk-houdini",
  description:
    "Bring your secret note, prove membership with a zero-knowledge proof, and claim your value at a fresh Stellar address.",
};

export default function WithdrawPage() {
  return (
    <>
      <TopBar />
      <WithdrawFlow />
    </>
  );
}
