# HM2 Log v5

The log lives on the phone, in this browser. IndexedDB database `hm2log-v5` holds the saved trips, notes, fuel, and tickets. If IndexedDB cannot be used, the same snapshot is kept in local storage under the key `hm2log-v5`. Drafts that are not saved yet sit in local storage under `hm2log-v5-drafts`.

While the phone is offline, a save still lands in that store. The header says “No signal. Saved on this phone.” When the signal returns, the header goes back to “Saved on this phone.”

## Sample demo for Google sync

Google sync is **off** for everyone. The live app has no sync address and does not connect to a Google account.

More → Google sync → **Turn on sample demo** draws a pretend spreadsheet and a pretend trip journal on this phone only. The endpoint line always reads `demo endpoint`. There is no token, no shared link, and no request to Google. Turning the sample demo off deletes the pretend outbox.

Saves made after the sample demo is on wait in an outbox on this phone (`hm2log-v5-demo-outbox` in local storage). The screen shows a count such as `3 waiting`. **Sync now** marks those items synced and fills the sample Sheet tabs and the sample Trip Journal. The count then reads `All synced`. None of that data leaves the phone.

This repository does not deploy a Google Apps Script, and it does not ask anyone to open a script to the public.

One sample trip lands in the Trips tab like this:

| What you see in the app | Saved field | Sheet column |
| --- | --- | --- |
| Trip name | title | Title |
| Trip ID | tripCode | Trip ID |
| Boat | boatId | Boat |
| Status | status | Status |
| Departure | fromId | Departure |
| Destination | toId | Destination |
| Crew | peopleIds | Crew |
| Hour meter | meter | Hour meter |
| Your guess | eta.captainEta | Your guess |
| App's guess | eta.appEta | App guess |
| ETA result | eta.message | ETA result |
| Conditions | weather.text | Conditions |
| Best moment | bestMoment.text | Best moment |
| Starfish | rating.stars | Starfish |
| Departed | departedAt | Departed |
| Arrived | arrivedAt | Arrived |

A note’s text is `notes` on the Notes & Journal tab. A fuel fill’s quantity, unit, cost, and currency are `quantity`, `units`, `cost`, and `currency` on the Boat Activities tab. A ticket’s title and detail are `title` and `detail` on the Maintenance Tickets tab.
