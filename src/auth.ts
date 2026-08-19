import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
} from "@azure/msal-browser";

const E2E_TOKEN_KEY = "quizatz:e2e-access-token";

export interface OrganizerIdentity {
  accessToken: string;
  displayName: string;
}

let clientPromise: Promise<PublicClientApplication> | undefined;

function authConfig() {
  const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID;
  const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID;
  const scope = import.meta.env.VITE_ENTRA_API_SCOPE;
  if (!clientId || !tenantId || !scope) {
    throw new Error("Microsoft sign-in has not been configured for this deployment.");
  }
  return { clientId, tenantId, scope };
}

function getClient(): Promise<PublicClientApplication> {
  if (!clientPromise) {
    const { clientId, tenantId } = authConfig();
    clientPromise = (async () => {
      const client = new PublicClientApplication({
        auth: {
          clientId,
          authority: `https://login.microsoftonline.com/${tenantId}`,
          redirectUri: `${window.location.origin}${import.meta.env.BASE_URL}`,
        },
        cache: { cacheLocation: "sessionStorage" },
      });
      await client.initialize();
      return client;
    })();
  }
  return clientPromise;
}

async function acquireToken(client: PublicClientApplication, account: AccountInfo, scope: string) {
  try {
    return await client.acquireTokenSilent({ account, scopes: [scope] });
  } catch (error) {
    if (!(error instanceof InteractionRequiredAuthError)) throw error;
    return client.acquireTokenPopup({ account, scopes: [scope] });
  }
}

export async function signInOrganizer(): Promise<OrganizerIdentity> {
  const e2eToken = sessionStorage.getItem(E2E_TOKEN_KEY);
  if (e2eToken) return { accessToken: e2eToken, displayName: "Test organizer" };

  const { scope } = authConfig();
  const client = await getClient();
  const existingAccount = client.getActiveAccount() ?? client.getAllAccounts()[0];
  const account = existingAccount ?? (await client.loginPopup({ scopes: [scope] })).account;
  if (!account) throw new Error("Microsoft sign-in did not return an account.");
  client.setActiveAccount(account);

  const token = await acquireToken(client, account, scope);
  return {
    accessToken: token.accessToken,
    displayName: account.name ?? account.username,
  };
}
