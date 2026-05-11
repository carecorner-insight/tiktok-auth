import type { CareyBotState } from '@/types/state';
import type { NodeResult } from '@/types/nodes';
import { UNAUTHORIZED_MESSAGE } from '@/config/questionnaire';
import type { Platform } from '@/types/state';

interface IWhitelistService {
  isAuthorized(platform: Platform, userId: string): Promise<boolean>;
}

export function makeAuthGuard(whitelistService: IWhitelistService) {
  return async function authGuard(state: CareyBotState): Promise<NodeResult> {
    const authorized = await whitelistService.isAuthorized(state.platform, state.userId);

    if (!authorized) {
      const message = UNAUTHORIZED_MESSAGE
        .replace('{USER_ID}', state.userId)
        .replace('{REGISTRATION_URL}', process.env.REGISTRATION_URL ?? '');

      return { isAuthorized: false, pendingResponse: message };
    }

    return { isAuthorized: true };
  };
}
