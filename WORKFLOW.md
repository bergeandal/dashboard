# Command Deck — what to do and when

A plain cheat-sheet so you can handle the routine stuff yourself. Run these in a
terminal opened in this folder (`C:\Users\Berge\Documents\Dashboard`).

There are **two separate things** that confuse people, so keep them straight:

| I want to…                         | Tool   | Command            |
|------------------------------------|--------|--------------------|
| Save my work history (to GitHub)   | git    | commit + push      |
| Make the live website change       | Fly    | `fly deploy`       |

They are independent. Pushing to GitHub does **not** update the website. Deploying
to Fly does **not** save to GitHub. Do both when you make a real change.

---

## 1. Save your work to GitHub

Do this whenever you've made changes worth keeping (end of a work session is fine).

```sh
git add -A                 # stage everything you changed
git commit -m "what I did" # snapshot it locally, with a short message
git push                   # send it up to GitHub
```

That's the whole loop. `add` = pick what to save, `commit` = save locally,
`push` = sync to GitHub. Nothing leaves your PC until `push`.

Check what you've changed before committing:
```sh
git status        # what's changed / staged
```

> Screenshots (`image/`, `command-deck/src/image/`) and `notes.md` are set to be
> ignored, so `git add -A` is safe — it won't sweep those in.

---

## 2. Put changes live (deploy to Fly)

```sh
fly deploy
```

**Important rules:**

- **Deploy uses the files on your disk, _not_ git.** You don't have to commit
  before deploying — but committing + pushing first is the tidy habit so GitHub
  matches what's live.
- **Only ever ONE machine may run.** The app stores data in a SQLite file on a
  single Fly volume. A second machine = split data = events mysteriously vanish.
  Check with `fly status` — you should see exactly **one** machine.
- If `fly deploy` prints scary `unauthorized` / `401` errors at the end but the
  site actually updated, the deploy probably succeeded and only the final
  check failed. Confirm with the health checks below; if `fly auth whoami` fails,
  run `fly auth login` and deploy again.

---

## 3. Quick checks

```sh
fly status                 # one machine? which version is live?
fly logs                   # live app logs (Ctrl-C to stop)
fly auth whoami            # are you logged in to Fly?
```

Is the live site up and the login gate on?
```sh
curl -s -o NUL -w "%{http_code}\n" https://command-deck-berge.fly.dev/api/health
# 200 = up
curl -s -o NUL -w "%{http_code}\n" "https://command-deck-berge.fly.dev/api/data"
# 401 = login gate is working
```

---

## 4. Secrets (passwords, API keys)

- **Never commit secrets.** The `.env` file is git-ignored on purpose.
- Live secrets live on Fly, not in git. Set or change one with:
  ```sh
  fly secrets set DECK_PASSCODE=your-new-passcode
  ```
  (Setting a secret restarts the app.)
- **The login passcode** is the `DECK_PASSCODE` secret. Changing it logs every
  device out (they'll need to re-enter the new one). That's also your
  "kick everyone out" button if a device is lost.

---

## 5. Typical session, start to finish

```sh
# ...make your changes / edits...
git status                      # sanity-check what changed
git add -A
git commit -m "short summary"
git push                        # GitHub now matches your work
fly deploy                      # website now shows the change
fly status                      # confirm: exactly one machine, new version
```

That's it. Commit+push to remember it, deploy to ship it, keep one machine.
