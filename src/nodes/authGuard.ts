import type { CareyBotState } from '@/types/state';
import type { NodeResult } from '@/types/nodes';
import { UNAUTHORIZED_MESSAGE } from '@/config/questionnaire';
import type { Platform } from '@/types/state';

interface IWhitelistService {
  isAuthorized(platform: Platform, userId: string): Promise<boolean>;
}

export function makeAuthGuard(_whitelistService: IWhitelistService) {
  return async function authGuard(_state: CareyBotState): Promise<NodeResult> {
    // TODO: whitelist check disabled for testing — re-enable before production
    return { isAuthorized: true };
  };
}
