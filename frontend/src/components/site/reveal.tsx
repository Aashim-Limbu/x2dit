"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { useMotionReady } from "@/lib/use-anim";

type Props = {
  children: React.ReactNode;
  className?: string;
  /** stagger index — delays this reveal by index * 60ms */
  index?: number;
  as?: "div" | "li" | "section";
};

/**
 * Translate-only scroll reveal. Opacity never gates meaning: under reduced
 * motion (or no JS) the content renders at its final, fully-visible state.
 * Use the `index` prop to stagger siblings at 60ms.
 */
export function Reveal({ children, className, index = 0, as = "div" }: Props) {
  const animate = useMotionReady();

  // SSR + first client render emit the plain element at its final, visible state
  // — identical on both sides, so no hydration mismatch. After mount we opt into
  // the translate-only reveal when motion is allowed.
  if (!animate) {
    const Tag = as;
    return <Tag className={className}>{children}</Tag>;
  }

  const MotionTag = motion[as];
  return (
    <MotionTag
      className={cn(className)}
      initial={{ y: 10 }}
      whileInView={{ y: 0 }}
      viewport={{ once: true, margin: "-15%" }}
      transition={{
        duration: 0.45,
        delay: index * 0.06,
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      {children}
    </MotionTag>
  );
}
