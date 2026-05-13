# DWYP Deploy Cheat Sheet

**Open this when you have push anxiety. It's fine. Read the right section.**

---

## TL;DR — One Line Each

- **Push to staging:** `clasp push` → done. Staging is auto-live on `/dev`.
- **Push to production:** `clasp push` → Apps Script → Manage deployments → pencil → New version → Deploy.

---

## How Staging Works (The Quick Mental Model)

You have **two doors** into the same code:

| Door | URL ends in | Code served | Sheet touched |
|---|---|---|---|
| **Staging** | `/dev` | Latest pushed (always) | Staging sheet |
| **Production** | `/exec` | Whatever version you last deployed | Production sheet |

The code is the same in both. The routing logic (`isStaging()` + `getMasterSheetId()` in `fairy_circle.js`) decides which sheet gets touched based on which URL the user hit.

**JT only ever uses production.** She has the `/exec` URL bookmarked. She will never accidentally see staging.

**You use both.** Staging for testing, production for the real release.

---

## 🟡 Push to Staging (Testing New Stuff)

**When:** You've made changes in VS Code and want to see them live without affecting JT.

### Steps

```
cd C:\Projects\DWYP
clasp push
```

That's it. **Staging is live immediately** on the `/dev` URL.

### Verify

Open the `/dev` URL in your browser. Your changes should be visible.

```
https://script.google.com/a/macros/wiseonewithin.com/s/AKfycbwHRxyQ22Zi0TFwT3av5jf30MiPhxBtV9tjb4hMxm0/dev
```

### What you can break

Anything. Staging is your sandbox. Worst case: hard refresh. Worst worst case: revert the commit, push again.

### What you CAN'T break

Production. JT's data. JT's workflow. JT's URL still points at the last versioned production deployment, which is unchanged.

---

## 🔴 Push to Production (Shipping for JT)

**When:** You've tested in staging, it works, you're ready to ship.

### Steps

**1. Push the code (same as staging):**

```
cd C:\Projects\DWYP
clasp push
```

This puts the code in the script project. It does **not** automatically update production. Production is still serving its last-deployed version.

**2. Create a new version of the production deployment:**

- Open the Apps Script editor: https://script.google.com/d/1NnTVOE0nkv_QYmekt0-gKnPAhygRV2ItXXuzNmEGTVimQyeeJPluCc2G/edit
- Top right: **Deploy** → **Manage deployments**
- Find the **production** deployment (not Studio Staging — if it's still around)
- Click the **pencil icon** (edit) on the production deployment
- **Version dropdown** → **New version**
- Optional: add a description like "Studio caption fix"
- Click **Deploy**

**3. Verify**

Open the production URL in a fresh tab:

```
https://script.google.com/macros/s/AKfycbzCed5Fmv9TNDf6ivQUcmhgUWWOyEVK4P3sxS8_KMQx7YOY6JeY7r-dh8jEw5DpecrI/exec
```

Confirm:
- Loads cleanly
- Your changes are visible
- Nothing JT depends on is obviously broken

JT's bookmark = same URL = no change for her. She just sees the new behavior.

### What if I just push without versioning?

`clasp push` alone updates the script. Production keeps serving its old version until you do step 2. So if you forget step 2, you've quietly pushed code that nobody is using yet. Not dangerous. Just incomplete.

### What if I version-deploy bad code?

You can roll back. Manage deployments → pencil → Version dropdown → pick a previous version → Deploy. That instantly reverts production to that older version. Code in git is unaffected.

---

## 🟢 Common Workflows

### "I want to test a small Studio change"

1. Make changes in VS Code
2. `clasp push`
3. Hit the `/dev` URL → see changes in staging
4. Iterate

No production deploy step. JT sees nothing.

### "Staging looks good, ship it"

1. (You're already pushed because you were testing)
2. Apps Script → Manage deployments → production → pencil → New version → Deploy
3. Test the production URL

### "I need to rollback production right now"

1. Apps Script → Manage deployments → production → pencil
2. Version dropdown → pick the previous version
3. Deploy

Done in 30 seconds. JT gets the old behavior back instantly.

### "I made a tiny change and want to push only to production without testing in staging"

Don't. That's how bugs reach JT. Push, test on `/dev`, then version production.

If you're absolutely sure (it's a one-character config tweak in Governance_Config, for example), the path is the same as full production: `clasp push` → version-bump production. Staging will also get it on `/dev`. No harm.

---

## 🛑 When NOT to Push

- **During a live recording or active JT session** — even though staging is isolated, save deploys for non-active hours
- **Just before walking away from your desk** — if something breaks, you want to be there
- **When you've been editing code in the Apps Script web editor** — that desyncs from your local repo. Resolve the desync first (pull editor changes back to local, or overwrite editor with local). Mixing them creates phantom bugs.

---

## 🧯 Emergency: I Pushed Bad Code to Production

Stay calm. Fix order:

**1. Rollback in Apps Script (fastest, restores JT's experience):**

- Manage deployments → production → pencil
- Version dropdown → previous version
- Deploy

JT is back to working state.

**2. Fix the code in VS Code:**

```
git log                   # find the bad commit
git revert <commit-hash>  # creates a clean revert commit
clasp push                # pushes the revert
```

**3. Re-version production with the fix:**

- Manage deployments → production → pencil → New version → Deploy

---

## URLs You Need

| What | URL |
|---|---|
| Apps Script editor | https://script.google.com/d/1NnTVOE0nkv_QYmekt0-gKnPAhygRV2ItXXuzNmEGTVimQyeeJPluCc2G/edit |
| Staging URL (`/dev`) | https://script.google.com/a/macros/wiseonewithin.com/s/AKfycbwHRxyQ22Zi0TFwT3av5jf30MiPhxBtV9tjb4hMxm0/dev |
| Production URL (`/exec`) | https://script.google.com/macros/s/AKfycbzCed5Fmv9TNDf6ivQUcmhgUWWOyEVK4P3sxS8_KMQx7YOY6JeY7r-dh8jEw5DpecrI/exec |
| Production Master Sheet | https://docs.google.com/spreadsheets/d/1p5ahHe4hgG6sHN4u13UyvEJWg5IwCkAfADjeqxwlTnw/edit |
| Staging Master Sheet | https://docs.google.com/spreadsheets/d/13bXMjxEf_L-BFH69OtUGOU6ywxt6BTat1kO9ik46Swk/edit |

---

## The One Rule

**`clasp push` = staging is live.**
**Pencil → New version → Deploy = production is live.**

If you only do step 1, JT sees nothing. If you do step 2, JT sees the change. That's the whole control.

You can't accidentally ship to production without doing step 2 deliberately. The system protects you from yourself.

You're fine. Push it.
