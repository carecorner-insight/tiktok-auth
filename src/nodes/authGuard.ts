import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { UNAUTHORIZED_MESSAGE } from '../config/questionnaire';
import { authEnabled } from '../lib/pivotFlags';
import type { Platform } from '../types/state';

interface IWhitelistService {
  isAuthorized(platform: Platform, userId: string): Promise<boolean>;
}

export function makeAuthGuard(whitelistService: IWhitelistService) {
  return async function authGuard(state: CareyBotState): Promise<NodeResult> {
    // ⚠️  LOAD-TEST ONLY — never set BYPASS_AUTH=true in production.
    // When enabled, the whitelist check is skipped entirely so load tests
    // can run without pre-populating SharePoint with test user IDs.
    if (process.env.BYPASS_AUTH === 'true') {
      console.warn('[auth] BYPASS_AUTH is enabled — whitelist check skipped');
      return { isAuthorized: true };
    }

    // Growing We build runs OPEN ACCESS (F2): no SharePoint approval, no
    // registration step. Distinct from BYPASS_AUTH, which is a load-test escape
    // hatch — this is a deliberate product configuration. The whitelist stack
    // stays in the codebase and remains ON for the NUS study bot.
    if (!authEnabled()) {
      return { isAuthorized: true };
    }

    const authorized = await whitelistService.isAuthorized(state.platform, state.userId);
    if (!authorized) {
      const registrationUrl = process.env.REGISTRATION_URL ?? '';
      const message = UNAUTHORIZED_MESSAGE.replace('{REGISTRATION_URL}', registrationUrl);
      return { isAuthorized: false, pendingResponse: message };
    }
    return { isAuthorized: true };
  };
}
