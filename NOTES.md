DWYP Dev Notes

## Daily Sync Commands
After saving changes in Apps Script, run these in order:

clasp pull        ← pulls latest from Apps Script to local files
git add .         ← stages all changed files
git commit -m ""  ← put a short description between the quotes
git push          ← sends to GitHub

## Push Local Changes to Apps Script
After editing files locally, run these in order:

git add .
git commit -m ""  ← put a short description between the quotes
git push
clasp push        ← pushes local files up to Apps Script

## Troubleshooting

**clasp won't run — "running scripts is disabled"**
PowerShell is blocking npm-installed scripts. Fix (one-time, no admin needed):
```
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

**clasp push fails — invalid_grant / reauth error**
Your Google auth token has expired. Fix:
```
clasp login
```
A browser window will open — sign in with Google, then retry clasp push.

## Useful Checks
clasp -v          ← confirm clasp is installed
node -v           ← confirm Node is installed
git status        ← see what's changed since last commit
git log --oneline ← see commit history