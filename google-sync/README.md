# Google sync for HM2 Log

The phone keeps the log. When you turn sync on, it sends new saves to a web app you deploy from your own Google account. That web app writes a Google Sheet and a Google Doc named HM2 Log - Trip Journal.

Nothing in this folder is deployed for you. The live app ships with the address and the token blank.

## Put the script in your Google account

1. Open [script.google.com](https://script.google.com) while signed in to the Google account that should own the Sheet and the Doc.
2. Click New project.
3. Replace the empty `Code.gs` with the `Code.gs` from this folder. Paste it over the sample `myFunction`.
4. Click the gear (Project settings). Under Script properties, add a property named `HM2_TOKEN`. Set the value to a long password you make up. Do not put that password in this git repo, in a screenshot, or in a message.
5. Click Deploy, then New deployment.
6. Click the gear next to Select type and choose Web app.
7. Execute as: Me.
8. Who has access: Anyone. In the deploy box this is the choice that lets the phone reach the script with the link. The phone still has to send the token. A wrong token is refused.
9. Click Deploy. Allow the requested access to spreadsheets and documents. That access is for the account you are signed in as.
10. Copy the web app URL. It ends in `/exec`.

The first time the phone connects, the script creates the Sheet and the Doc and remembers their ids. Later syncs update the same files. A row with the same id is replaced, not added again. An arrived trip is written into the Doc under a heading for the boat. Sending that trip again updates that section.

## On the phone

More, then Google sync.

Paste the `/exec` URL and the token. Tap Save connection, then Test connection. When it works, the screen offers Open my Sheet and Open my Doc.

Turn on Send new saves automatically if you want each save to go out when the phone has a signal. Sync now sends whatever is still waiting. If you are offline, the save stays on the phone and is sent later. Nothing waiting is deleted because a send failed.

Send the log on this phone queues the trips already stored on the phone, then you can tap Sync now.

The token and the web app URL stay on this phone. They are not part of the backup file.
