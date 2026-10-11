import type { Stage } from "@voidaccess/engine-client";
import { STAGE_WEIGHTS as CONFIG_STAGE_WEIGHTS, type Stage as ConfigStage } from "@voidaccess/config";

/** Re-exported from @voidaccess/config (the single source). The checks below fail
 *  the typecheck if the engine contract's stage list and the config drift apart. */
export const STAGE_WEIGHTS: Record<Stage, number> = CONFIG_STAGE_WEIGHTS;
const _configCoversContract: Record<ConfigStage, number> = {} as Record<Stage, number>;
void _configCoversContract;
