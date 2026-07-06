import { test as base, expect } from "@playwright/test";
import {
  createTempUser,
  deleteTempUser,
  seedSettings,
  applyAuth,
  type TempUser,
} from "./helpers";

// `account` fixture: a fresh throwaway user (lbs), signed into the test's
// browser context, deleted afterwards. Gives each test an isolated identity so
// they never collide on shared server state.
export const test = base.extend<{ account: TempUser }>({
  account: async ({ context }, use) => {
    const user = await createTempUser();
    await seedSettings(user.id, "lbs");
    await applyAuth(context, user.email, user.password);
    await use(user);
    await deleteTempUser(user.id);
  },
});

export { expect };
