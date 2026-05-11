import type { CareyBotState } from '@/types/state';
import type { NodeResult } from '@/types/nodes';
import type { WhitelistService } from '@/services/whitelistService';
import { UNAUTHORIZED_MESSAGE } from '@/config/questionnaire';

export function makeAuthGuard(whitelistService: WhitelistService) {
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
