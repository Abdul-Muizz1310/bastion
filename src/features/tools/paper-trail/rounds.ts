import * as z from "zod/mini";

/**
 * paper-trail's rounds as the workbench shows them while a debate runs (spec 21 §5). `DebateOut`
 * carries the graph's raw round entries (`list[dict]`), so each is parsed on its own: an entry
 * bastion cannot read stays in place as unreadable rather than vanishing.
 */

const citation = z.object({ type: z.string(), ref: z.string(), title: z.string() });

const entry = z.object({
  side: z.string().check(z.minLength(1)),
  round: z.number().check(z.int(), z.positive()),
  argument: z.optional(z.string()),
  argument_md: z.optional(z.string()),
  citations: z.optional(z.array(citation)),
});

export type RoundView =
  | {
      ok: true;
      side: string;
      round: number;
      argument: string;
      citations: z.infer<typeof citation>[];
    }
  | { ok: false };

export function readRounds(rounds: readonly unknown[]): RoundView[] {
  return rounds.map((raw) => {
    const parsed = entry.safeParse(raw);
    if (!parsed.success) return { ok: false };
    const argument = parsed.data.argument ?? parsed.data.argument_md;
    if (argument === undefined) return { ok: false };
    return {
      ok: true,
      side: parsed.data.side,
      round: parsed.data.round,
      argument,
      citations: parsed.data.citations ?? [],
    };
  });
}
