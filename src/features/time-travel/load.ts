import type { TimeTravelQueryResult, TimeTravelView } from "@/features/time-travel/view";

/**
 * Adapts the Server Action's discriminated result to the plain
 * `Promise<TimeTravelView>` the query scheduler expects, turning the recoverable
 * error codes into messages the slider can show. Kept separate from the
 * component so both halves stay unit-testable.
 */

const ERROR_MESSAGES: Record<string, string> = {
  invalid_timestamp: "That timestamp could not be parsed.",
  invalid_service: "That service filter is not valid.",
};

export type TimeTravelLoader = (asOfIso: string) => Promise<TimeTravelView>;

export function createLoader(
  action: (asOfIso: string) => Promise<TimeTravelQueryResult>,
): TimeTravelLoader {
  return async (asOfIso: string) => {
    const result = await action(asOfIso);
    if (!result.ok) {
      throw new Error(ERROR_MESSAGES[result.error] ?? "Time-travel query failed");
    }
    return result.view;
  };
}
