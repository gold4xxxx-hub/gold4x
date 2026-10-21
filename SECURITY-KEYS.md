# The API keys in this repository

`.env.local` used to be committed to this repository, and this repository is
public. That means the Ankr key and the BscScan key inside it have been
readable by anyone on the internet since they were pushed:

```
https://raw.githubusercontent.com/gold4xxxx-hub/gold4x/main/.env.local
```

Removing the file from the repository does not un-publish them: they are in
the git history and they are in every clone. So the keys have to be
**rotated**. This page is the order to do it in.

Do these in order. Step 4 breaks the live site if you do it before step 3.

---

## 1. Get a new Ankr key

1. Open https://ankr.com/app and sign in.
2. Go to **API Keys** and create a new key.
3. Copy it. It is a long string, about 64 characters.
4. Leave the old key alone for now, the build may still need it. Delete it
   after the next successful deploy.

## 2. Get a new BscScan key

1. Open https://etherscan.io/apis and sign in.
2. Copy your API key. The free plan is enough for a key; see the note at the
   bottom of this page about what it can and cannot reach.
3. The old key stays valid until you delete it in that same page.

## 3. Put the new keys in the two places that need them

### 3a. GitHub, so the scheduled jobs can use them

1. Open https://github.com/gold4xxxx-hub/gold4x/settings/secrets/actions
2. Click **New repository secret**.
3. Name it `ANKR_API_KEY`, paste the new Ankr key, click **Add secret**.
4. Do the same again for `BSCSCAN_API_KEY` with the new BscScan key.

Both scheduled jobs read the Ankr key from here. You can check they work
afterwards: open the **Actions** tab, pick **Refresh the join dates**, click
**Run workflow**. The job should finish green and say how many users it has.

### 3b. Netlify, so the live site can use them

1. Open the Netlify admin page for this site.
2. Go to **Site configuration** → **Environment variables**.
3. Add `ANKR_API_KEY` with the new Ankr key.
4. Add `BSCSCAN_API_KEY` with the new BscScan key.
5. Click **Save**.

Netlify applies environment variable changes to the next deploy, so make sure
you deploy after this (pushing to `main` does it).

### 3c. Your own machine

Open `.env.local` in the project and replace the two values with the new
ones. The file stays on your machine, it just is not tracked any more.

---

## 4. Stop tracking the file

From the project folder:

```bash
git rm --cached .env.local
git commit -m "Stop tracking .env.local"
git push
```

The file stays on your machine. It is now ignored by git, so it can never be
committed by accident again.

---

## 5. Delete the old keys

Once the site is deployed with the new keys and the dashboard shows the
joined dates still working:

1. Delete the old Ankr key in the Ankr dashboard.
2. Delete the old BscScan key in the Etherscan dashboard.

That is what actually closes the hole. Until then the old keys are still
usable by anyone who read them.

---

## What breaks if you skip a step

| If you do this | What happens |
|---|---|
| Untrack `.env.local` before adding the secrets | The scheduled jobs and the KYC pages lose the key. `scripts/buildAuditIndex.mjs` now reads the environment first, so it still works **if** the GitHub secret is set. The live site keeps working **if** the Netlify variable is set. Do both, then untrack. |
| Delete the old keys before deploying the new ones | The scheduled jobs start failing, and the KYC pages lose their RPC. Wait for a green deploy first. |
| Only rotate, never untrack | The new key is fine but the old key is still published. Not enough on its own. |

---

## Note about BscScan and BSC

The old `https://api.bscscan.com/api` endpoint no longer serves API
responses. It answers with a 308 redirect to the Etherscan documentation
page, which is why `/api/kyc/approved-users/` currently returns a 502.

The replacement is `https://api.etherscan.io/v2/api?chainid=56`, but the
free Etherscan plan does not cover BSC:

```
Free API access is not supported for this chain.
```

So a rotated BscScan key does **not** bring that page back on the free plan.
Two ways forward:

- Give `/api/kyc/approved-users/route.ts` the same treatment that
  `/api/kyc/pending-users/route.ts` already has: scan the contract logs
  over the Ankr archive RPC instead of asking BscScan. No key needed, and it
  works today.
- Or pay for an Etherscan plan that includes BSC and move the route to the
  V2 endpoint.

The join dates do not depend on any of this. They read the chain over RPC.
